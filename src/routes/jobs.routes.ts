import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireSeeker } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Application } from '../models/Application.js';
import { Job } from '../models/Job.js';
import { Saved } from '../models/Misc.js';
import { User } from '../models/User.js';
import { notify, searchRegex, skillMatch } from '../services/core.js';
import * as dto from '../services/serialize.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();

/** Public job board: active posts only. */
router.get(
  '/jobs',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { q, type, mode, urgent, sort, limit } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { status: 'active' };
    if (type) filter.type = type;
    if (mode) filter.workMode = mode;
    if (urgent === 'true') filter.isUrgent = true;
    const rx = searchRegex(q);
    if (rx) filter.$or = [{ title: rx }, { skills: rx }, { category: rx }, { location: rx }];

    const order: Record<string, 1 | -1> =
      sort === 'salary' ? { salaryMax: -1 } : sort === 'urgent' ? { isUrgent: -1, createdAt: -1 } : { createdAt: -1 };
    const [items, total] = await Promise.all([
      Job.find(filter)
        .sort(order)
        .limit(Math.min(Number(limit) || 50, 100))
        .populate('company'),
      Job.countDocuments({ status: 'active' }),
    ]);

    const saved = req.user
      ? new Set((await Saved.find({ user: req.user.id, kind: 'job' }).select('ref')).map((s) => String(s.ref)))
      : new Set<string>();
    res.json({
      success: true,
      data: { items: items.map((j) => dto.job(j, { isSaved: saved.has(String(j._id)) })), total },
    });
  }),
);

router.get(
  '/jobs/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const job = await Job.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true }).populate('company');
    if (!job || job.status === 'draft') throw new ApiError(404, 'Job not found.');
    const applicantsCount = await Application.countDocuments({ job: job._id });
    let extra: Record<string, unknown> = { applicantsCount };
    if (req.user) {
      const [mine, saved, me] = await Promise.all([
        Application.findOne({ job: job._id, applicant: req.user.id }).select('status'),
        Saved.exists({ user: req.user.id, kind: 'job', ref: job._id }),
        User.findById(req.user.id).select('skills'),
      ]);
      extra = {
        ...extra,
        hasApplied: !!mine,
        applicationStatus: mine?.status ?? null,
        isSaved: !!saved,
        matchScore: skillMatch(me?.skills ?? [], job.skills),
      };
    }
    res.json({ success: true, data: dto.job(job, extra) });
  }),
);

router.post(
  '/jobs/:id/apply',
  requireSeeker,
  validate(
    z.object({
      resumeName: z.string().trim().min(1, 'Pick a resume'),
      coverLetter: z.string().trim().min(20, 'Write at least 20 characters'),
      noticePeriod: z.string().trim().default('Immediately'),
    }),
  ),
  asyncHandler(async (req, res) => {
    const job = await Job.findById(req.params.id);
    if (!job || job.status !== 'active') throw new ApiError(400, 'This job is no longer accepting applications.');
    if (await Application.exists({ job: job._id, applicant: req.user!.id })) {
      throw new ApiError(409, 'You have already applied to this job.');
    }
    const me = await User.findById(req.user!.id).select('skills name');
    const application = await Application.create({
      job: job._id,
      company: job.company,
      applicant: req.user!.id,
      ...req.body,
      matchScore: skillMatch(me?.skills ?? [], job.skills),
    });
    await notify(
      job.postedBy,
      'applicationReceived',
      'New Applicant',
      `${me?.name ?? 'A candidate'} applied for ${job.title} · ${application.matchScore}% match.`,
      application._id,
    );
    res.status(201).json({ success: true, data: { id: String(application._id), status: application.status } });
  }),
);

router.get(
  '/applications/mine',
  requireSeeker,
  asyncHandler(async (req, res) => {
    const items = await Application.find({ applicant: req.user!.id })
      .sort({ createdAt: -1 })
      .populate({ path: 'job', populate: { path: 'company' } });
    res.json({ success: true, data: items.filter((a) => a.job).map(dto.myApplication) });
  }),
);

/** Withdraw an application that hasn't moved past "applied". */
router.delete(
  '/applications/:id',
  requireSeeker,
  asyncHandler(async (req, res) => {
    const a = await Application.findOne({ _id: req.params.id, applicant: req.user!.id });
    if (!a) throw new ApiError(404, 'Application not found.');
    if (a.status !== 'applied') throw new ApiError(400, 'This application is already being processed.');
    await a.deleteOne();
    res.json({ success: true, message: 'Application withdrawn.' });
  }),
);

export default router;
