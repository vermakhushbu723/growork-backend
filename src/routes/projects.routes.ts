import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { optionalAuth, requireAuth, requireSeeker } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Contract } from '../models/Contract.js';
import { Review, Saved } from '../models/Misc.js';
import { Project } from '../models/Project.js';
import { Proposal } from '../models/Proposal.js';
import { User } from '../models/User.js';
import { credit, debit, fundEscrow, notify, refundEscrow, releaseEscrow, searchRegex } from '../services/core.js';
import * as dto from '../services/serialize.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();

const clientPopulate = { path: 'client', populate: { path: 'company' } };

router.get(
  '/projects',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { q, category, budget, sort } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { status: 'open', visibility: 'Public' };
    if (category) filter.category = category;
    if (budget === 'low') filter.budgetMin = { $lt: 10000 };
    if (budget === 'mid') filter.budgetMin = { $gte: 10000, $lte: 25000 };
    if (budget === 'high') filter.budgetMin = { $gt: 25000 };
    const rx = searchRegex(q);
    if (rx) filter.$or = [{ title: rx }, { skills: rx }, { category: rx }];
    const order: Record<string, 1 | -1> = sort === 'budget' ? { budgetMax: -1 } : { createdAt: -1 };

    const items = await Project.find(filter).sort(order).limit(100).populate(clientPopulate);
    const counts = await Proposal.aggregate([
      { $match: { project: { $in: items.map((p) => p._id) } } },
      { $group: { _id: '$project', n: { $sum: 1 } } },
    ]);
    const countOf = new Map(counts.map((c) => [String(c._id), c.n as number]));
    const saved = req.user
      ? new Set((await Saved.find({ user: req.user.id, kind: 'project' }).select('ref')).map((s) => String(s.ref)))
      : new Set<string>();
    let data = items.map((p) =>
      dto.project(p, { proposalsCount: countOf.get(String(p._id)) ?? 0, isSaved: saved.has(String(p._id)) }),
    );
    if (sort === 'proposals') data = data.sort((a, b) => Number((a as Record<string, unknown>).proposalsCount) - Number((b as Record<string, unknown>).proposalsCount));
    res.json({ success: true, data: { items: data, total: data.length } });
  }),
);

router.get(
  '/projects/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const p = await Project.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true }).populate(clientPopulate);
    if (!p || p.status === 'draft') throw new ApiError(404, 'Project not found.');
    const proposalsCount = await Proposal.countDocuments({ project: p._id });
    let extra: Record<string, unknown> = { proposalsCount };
    if (req.user) {
      const [mine, saved] = await Promise.all([
        Proposal.findOne({ project: p._id, freelancer: req.user.id }),
        Saved.exists({ user: req.user.id, kind: 'project', ref: p._id }),
      ]);
      extra = { ...extra, myProposal: mine ? dto.proposal(mine) : null, isSaved: !!saved };
    }
    res.json({ success: true, data: dto.project(p, extra) });
  }),
);

router.post(
  '/projects/:id/proposals',
  requireSeeker,
  validate(
    z.object({
      pricing: z.enum(['fixed', 'hourly']),
      amount: z.number().int().positive('Enter an amount'),
      deliveryDays: z.number().int().min(1).max(365),
      coverLetter: z.string().trim().min(50, 'Write at least 50 characters'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const project = await Project.findById(req.params.id);
    if (!project || project.status !== 'open') throw new ApiError(400, 'This project is not accepting proposals.');
    if (req.body.pricing === 'fixed' && req.body.amount < 500) throw new ApiError(400, 'Minimum bid is ₹500');
    if (await Proposal.exists({ project: project._id, freelancer: req.user!.id })) {
      throw new ApiError(409, 'You already sent a proposal for this project.');
    }
    const proposal = await Proposal.create({ ...req.body, project: project._id, client: project.client, freelancer: req.user!.id });
    await notify(
      project.client,
      'proposalReceived',
      'New Proposal',
      `${req.user!.name} sent a proposal of ₹${req.body.amount.toLocaleString('en-IN')} for ${project.title}.`,
      proposal._id,
    );
    res.status(201).json({ success: true, data: dto.proposal(await proposal.populate('freelancer')) });
  }),
);

router.get(
  '/proposals/mine',
  requireSeeker,
  asyncHandler(async (req, res) => {
    const items = await Proposal.find({ freelancer: req.user!.id })
      .sort({ createdAt: -1 })
      .populate({ path: 'project', populate: clientPopulate });
    res.json({ success: true, data: items.filter((p) => p.project).map(dto.proposal) });
  }),
);

router.delete(
  '/proposals/:id',
  requireSeeker,
  asyncHandler(async (req, res) => {
    const p = await Proposal.findOne({ _id: req.params.id, freelancer: req.user!.id });
    if (!p) throw new ApiError(404, 'Proposal not found.');
    if (p.status === 'hired') throw new ApiError(400, 'You were hired for this project — it can’t be withdrawn.');
    await p.deleteOne();
    res.json({ success: true, message: 'Proposal withdrawn.' });
  }),
);

// ── Contracts (both sides) ─────────────────────────────────────────────

const contractPopulate = [clientPopulate, { path: 'freelancer' }];

/** Contracts where the caller is the freelancer (user app) or client (recruiter app). */
router.get(
  '/contracts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filter = req.user!.app === 'seeker' ? { freelancer: req.user!.id } : { client: req.user!.id };
    const items = await Contract.find(filter).sort({ createdAt: -1 }).populate(contractPopulate);
    res.json({ success: true, data: items.map(dto.contract) });
  }),
);

async function loadContract(id: string, userId: string, side?: 'client' | 'freelancer') {
  const c = await Contract.findById(id);
  if (!c) throw new ApiError(404, 'Contract not found.');
  const isClient = String(c.client) === userId;
  const isFreelancer = String(c.freelancer) === userId;
  if (!(isClient || isFreelancer) || (side === 'client' && !isClient) || (side === 'freelancer' && !isFreelancer)) {
    throw new ApiError(403, 'You are not part of this contract.');
  }
  return c;
}

async function contractResponse(id: unknown) {
  return dto.contract(await Contract.findById(id).populate(contractPopulate));
}

function milestoneAt(c: Awaited<ReturnType<typeof loadContract>>, index: string) {
  const m = c.milestones[Number(index)];
  if (!m) throw new ApiError(404, 'Milestone not found.');
  return m;
}

router.get(
  '/contracts/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id);
    res.json({ success: true, data: await contractResponse(c._id) });
  }),
);

/** Freelancer hands in the work for one milestone. */
router.post(
  '/contracts/:id/milestones/:index/submit',
  requireAuth,
  validate(z.object({ note: z.string().trim().min(5, 'Describe what you delivered') })),
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id, 'freelancer');
    if (c.status !== 'active') throw new ApiError(400, 'This contract has ended.');
    const m = milestoneAt(c, String(req.params.index));
    if (!['funded', 'revision'].includes(m.status)) throw new ApiError(400, 'This milestone is not open for submission.');
    m.status = 'submitted';
    m.note = req.body.note;
    await c.save();
    await notify(c.client, 'milestoneSubmitted', 'Milestone Submitted', `${req.user!.name} submitted "${m.title}" for your review.`, c._id);
    res.json({ success: true, data: await contractResponse(c._id) });
  }),
);

/** Client moves the milestone amount (+ marketplace fee) into escrow. */
router.post(
  '/contracts/:id/milestones/:index/fund',
  requireAuth,
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id, 'client');
    if (c.status !== 'active') throw new ApiError(400, 'This contract has ended.');
    const m = milestoneAt(c, String(req.params.index));
    if (m.status !== 'notFunded') throw new ApiError(400, 'This milestone is already funded.');
    await fundEscrow(c.client, m.amount * (1 + env.clientFeeRate), `${c.title} · ${m.title}`);
    m.status = 'funded';
    await c.save();
    await notify(c.freelancer, 'milestoneFunded', 'Milestone Funded', `"${m.title}" is funded — you can start working.`, c._id);
    res.json({ success: true, data: await contractResponse(c._id) });
  }),
);

/** Client approves the work: escrow is released and the freelancer is paid. */
router.post(
  '/contracts/:id/milestones/:index/release',
  requireAuth,
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id, 'client');
    const m = milestoneAt(c, String(req.params.index));
    if (m.status !== 'submitted') throw new ApiError(400, 'Only submitted work can be approved.');
    await releaseEscrow(c.client, m.amount * (1 + env.clientFeeRate), `${c.title} · ${m.title}`);
    // Freelancer gets the full amount, then the platform fee is taken from it.
    const fee = Math.round(m.amount * env.freelancerFeeRate);
    await credit(c.freelancer, m.amount, `Freelance payout - ${m.title}`, 'payout');
    await debit(c.freelancer, fee, `Platform fee - ${m.title}`, 'fee');
    m.status = 'released';
    m.dueIn = 'Completed';
    await c.save();
    await notify(c.freelancer, 'milestoneReleased', 'Payment Received', `₹${(m.amount - fee).toLocaleString('en-IN')} for "${m.title}" was released to your wallet.`, c._id);
    res.json({ success: true, data: await contractResponse(c._id) });
  }),
);

router.post(
  '/contracts/:id/milestones/:index/revision',
  requireAuth,
  validate(z.object({ note: z.string().trim().min(5, 'Say what should change') })),
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id, 'client');
    const m = milestoneAt(c, String(req.params.index));
    if (m.status !== 'submitted') throw new ApiError(400, 'Only submitted work can be sent back.');
    m.status = 'revision';
    m.note = req.body.note;
    await c.save();
    await notify(c.freelancer, 'revisionRequested', 'Changes Requested', `The client asked for changes on "${m.title}".`, c._id);
    res.json({ success: true, data: await contractResponse(c._id) });
  }),
);

router.post(
  '/contracts/:id/milestones',
  requireAuth,
  validate(
    z.object({
      title: z.string().trim().min(2),
      amount: z.number().int().min(100, 'Minimum ₹100'),
      dueIn: z.string().trim().default('Due in 14 days'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id, 'client');
    if (c.status !== 'active') throw new ApiError(400, 'This contract has ended.');
    c.milestones.push(req.body);
    await c.save();
    res.status(201).json({ success: true, data: await contractResponse(c._id) });
  }),
);

/** Ends the contract with a review; unspent escrow goes back to the client. */
router.post(
  '/contracts/:id/end',
  requireAuth,
  validate(z.object({ rating: z.number().min(1).max(5), review: z.string().trim().min(10, 'Write at least 10 characters') })),
  asyncHandler(async (req, res) => {
    const c = await loadContract(String(req.params.id), req.user!.id, 'client');
    if (c.status !== 'active') throw new ApiError(400, 'This contract has already ended.');
    const unreleased = c.milestones
      .filter((m) => ['funded', 'submitted', 'revision'].includes(m.status))
      .reduce((s, m) => s + m.amount, 0);
    await refundEscrow(c.client, unreleased * (1 + env.clientFeeRate), c.title);
    c.status = 'completed';
    c.rating = req.body.rating;
    c.review = req.body.review;
    await c.save();
    await Project.updateOne({ _id: c.project }, { status: 'completed' });
    await Review.create({
      reviewer: c.client,
      reviewee: c.freelancer,
      rating: req.body.rating,
      comment: req.body.review,
      context: 'Freelance Project',
      contract: c._id,
    });
    // Keep the freelancer's public rating and job count current.
    const reviews = await Review.find({ reviewee: c.freelancer }).select('rating');
    await User.updateOne(
      { _id: c.freelancer },
      {
        rating: Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10,
        $inc: { jobsDone: 1 },
      },
    );
    await notify(c.freelancer, 'contractEnded', 'Contract Completed', `${c.title} is complete. You received a ${req.body.rating}★ review.`, c._id);
    res.json({ success: true, data: await contractResponse(c._id) });
  }),
);

export default router;
