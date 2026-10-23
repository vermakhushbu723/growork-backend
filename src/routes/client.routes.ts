import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireRecruiter } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Contract } from '../models/Contract.js';
import { Project, PROJECT_STATUSES } from '../models/Project.js';
import { Proposal } from '../models/Proposal.js';
import { fundEscrow, notify } from '../services/core.js';
import * as dto from '../services/serialize.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use(requireRecruiter);

const projectBody = z.object({
  title: z.string().trim().min(2, 'Project title is required'),
  category: z.string().trim().min(2),
  description: z.string().trim().default(''),
  skills: z.array(z.string().trim().min(1)).default([]),
  pricing: z.enum(['fixed', 'hourly']),
  budgetMin: z.number().int().min(0),
  budgetMax: z.number().int().min(0),
  duration: z.string().trim().default('1–2 weeks'),
  level: z.string().trim().default('Intermediate'),
  visibility: z.enum(['Public', 'Invite only']).default('Public'),
  status: z.enum(PROJECT_STATUSES).default('open'),
  attachments: z.array(z.string().trim()).default([]),
});

const populateProject = [
  { path: 'client', populate: { path: 'company' } },
  { path: 'hiredFreelancer' },
];

async function projectsWithCounts(filter: Record<string, unknown>) {
  const items = await Project.find(filter).sort({ createdAt: -1 }).populate(populateProject);
  const counts = await Proposal.aggregate([
    { $match: { project: { $in: items.map((p) => p._id) } } },
    {
      $group: {
        _id: '$project',
        n: { $sum: 1 },
        fresh: { $sum: { $cond: [{ $in: ['$status', ['submitted', 'viewed']] }, 1, 0] } },
      },
    },
  ]);
  return items.map((p) => {
    const c = counts.find((x) => String(x._id) === String(p._id));
    return dto.project(p, { proposalsCount: c?.n ?? 0, newProposals: c?.fresh ?? 0 });
  });
}

router.get(
  '/projects',
  asyncHandler(async (req, res) => res.json({ success: true, data: await projectsWithCounts({ client: req.user!.id }) })),
);

router.post(
  '/projects',
  validate(projectBody),
  asyncHandler(async (req, res) => {
    if (req.body.budgetMax < req.body.budgetMin) throw new ApiError(400, 'budgetMax: Must be ≥ minimum');
    const p = await Project.create({
      ...req.body,
      client: req.user!.id,
      company: req.user!.company,
      publishedAt: req.body.status === 'open' ? new Date() : undefined,
    });
    res.status(201).json({ success: true, data: (await projectsWithCounts({ _id: p._id }))[0] });
  }),
);

async function ownProject(req: { params: { id?: string }; user?: { id: string } }) {
  const p = await Project.findOne({ _id: req.params.id, client: req.user!.id });
  if (!p) throw new ApiError(404, 'Project not found.');
  return p;
}

router.patch(
  '/projects/:id',
  validate(projectBody.partial()),
  asyncHandler(async (req, res) => {
    const p = await ownProject(req);
    if (p.status === 'draft' && req.body.status === 'open') p.publishedAt = new Date();
    Object.assign(p, req.body);
    await p.save();
    res.json({ success: true, data: (await projectsWithCounts({ _id: p._id }))[0] });
  }),
);

router.patch(
  '/projects/:id/status',
  validate(z.object({ status: z.enum(PROJECT_STATUSES) })),
  asyncHandler(async (req, res) => {
    const p = await ownProject(req);
    p.status = req.body.status;
    await p.save();
    res.json({ success: true, data: (await projectsWithCounts({ _id: p._id }))[0] });
  }),
);

router.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const p = await ownProject(req);
    if (p.status === 'inProgress') throw new ApiError(400, 'End the contract before deleting this project.');
    await Proposal.deleteMany({ project: p._id });
    await p.deleteOne();
    res.json({ success: true, message: 'Project deleted.' });
  }),
);

// ── Proposals received ─────────────────────────────────────────────────

router.get(
  '/proposals',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { client: req.user!.id };
    if (req.query.project) filter.project = req.query.project;
    const items = await Proposal.find(filter).sort({ createdAt: -1 }).populate('freelancer');
    res.json({ success: true, data: items.map(dto.proposal) });
  }),
);

/** Opening a proposal tells the freelancer it was viewed. */
router.get(
  '/proposals/:id',
  asyncHandler(async (req, res) => {
    const p = await Proposal.findOne({ _id: req.params.id, client: req.user!.id }).populate('freelancer');
    if (!p) throw new ApiError(404, 'Proposal not found.');
    if (p.status === 'submitted') {
      p.status = 'viewed';
      await p.save();
    }
    res.json({ success: true, data: dto.proposal(p) });
  }),
);

router.patch(
  '/proposals/:id',
  validate(z.object({ status: z.enum(['submitted', 'viewed', 'shortlisted', 'interview', 'declined']) })),
  asyncHandler(async (req, res) => {
    const p = await Proposal.findOne({ _id: req.params.id, client: req.user!.id }).populate('freelancer project');
    if (!p) throw new ApiError(404, 'Proposal not found.');
    if (p.status === 'hired') throw new ApiError(400, 'This freelancer is already hired.');
    p.status = req.body.status;
    await p.save();
    if (['shortlisted', 'declined'].includes(req.body.status)) {
      const project = p.project as unknown as { title: string };
      await notify(
        (p.freelancer as unknown as { _id: string })._id,
        'proposalStatus',
        req.body.status === 'shortlisted' ? 'Proposal Shortlisted' : 'Proposal Declined',
        req.body.status === 'shortlisted'
          ? `Your proposal for ${project.title} was shortlisted.`
          : `The client went with someone else for ${project.title}.`,
        p._id,
      );
    }
    res.json({ success: true, data: dto.proposal(p) });
  }),
);

/** Hire: create the contract and fund milestone 1 (+ fee) from the wallet. */
router.post(
  '/proposals/:id/hire',
  validate(
    z.object({
      milestones: z
        .array(
          z.object({
            title: z.string().trim().min(2),
            amount: z.number().int().min(100, 'Milestones must be at least ₹100'),
            dueIn: z.string().trim().default('Due in 7 days'),
          }),
        )
        .min(1, 'Add at least one milestone'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const p = await Proposal.findOne({ _id: req.params.id, client: req.user!.id });
    if (!p) throw new ApiError(404, 'Proposal not found.');
    const project = await Project.findById(p.project);
    if (!project) throw new ApiError(404, 'Project not found.');
    if (project.hiredFreelancer) throw new ApiError(409, 'You already hired someone for this project.');

    const first = req.body.milestones[0];
    await fundEscrow(req.user!.id, first.amount * (1 + env.clientFeeRate), `${project.title} · ${first.title}`);
    const contract = await Contract.create({
      project: project._id,
      proposal: p._id,
      client: req.user!.id,
      freelancer: p.freelancer,
      title: project.title,
      pricing: p.pricing,
      milestones: req.body.milestones.map((m: { title: string }, i: number) => ({ ...m, status: i === 0 ? 'funded' : 'notFunded' })),
    });
    p.status = 'hired';
    await p.save();
    project.status = 'inProgress';
    project.hiredFreelancer = p.freelancer;
    await project.save();
    await notify(p.freelancer, 'hired', 'You’re Hired!', `You were hired for ${project.title}. Milestone 1 is funded.`, contract._id);

    const full = await Contract.findById(contract._id).populate([{ path: 'client', populate: { path: 'company' } }, { path: 'freelancer' }]);
    res.status(201).json({ success: true, data: dto.contract(full) });
  }),
);

export default router;
