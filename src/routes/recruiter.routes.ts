import { Router } from 'express';
import { z } from 'zod';
import { requireRecruiter } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Application, APPLICATION_STATUSES } from '../models/Application.js';
import { Interview, INTERVIEW_MODES, INTERVIEW_STATUSES } from '../models/Interview.js';
import { Job, JOB_STATUSES, JOB_TYPES, WORK_MODES } from '../models/Job.js';
import { walletOf, notify } from '../services/core.js';
import * as dto from '../services/serialize.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use(requireRecruiter);

const companyOf = (req: { user?: { company?: string } }) => req.user!.company!;

const jobBody = z.object({
  title: z.string().trim().min(2, 'Job title is required'),
  category: z.string().trim().default('Engineering'),
  type: z.enum(JOB_TYPES),
  workMode: z.enum(WORK_MODES),
  location: z.string().trim().default(''),
  salaryMin: z.number().min(0),
  salaryMax: z.number().min(0),
  experience: z.string().trim().default('1–3 yrs'),
  level: z.string().trim().default('Junior Level'),
  openings: z.number().int().min(1).default(1),
  skills: z.array(z.string().trim().min(1)).default([]),
  description: z.string().trim().default(''),
  responsibilities: z.array(z.string().trim()).default([]),
  perks: z.array(z.string().trim()).default([]),
  status: z.enum(JOB_STATUSES).default('active'),
  deadline: z.coerce.date().optional(),
  isUrgent: z.boolean().default(false),
  duration: z.string().trim().nullish(),
});

/** Uses one job credit when a post goes live for the first time. */
async function consumeCredit(userId: string) {
  const w = await walletOf(userId);
  if (w.jobCredits <= 0) throw new ApiError(402, 'No job credits left. Buy a plan to publish more jobs.');
  w.jobCredits -= 1;
  await w.save();
}

async function jobsWithCounts(filter: Record<string, unknown>) {
  const jobs = await Job.find(filter).sort({ createdAt: -1 }).populate('company');
  const counts = await Application.aggregate([
    { $match: { job: { $in: jobs.map((j) => j._id) } } },
    { $group: { _id: { job: '$job', status: '$status' }, n: { $sum: 1 } } },
  ]);
  return jobs.map((j) => {
    const byStatus: Record<string, number> = {};
    for (const c of counts) if (String(c._id.job) === String(j._id)) byStatus[c._id.status] = c.n;
    const applicantsCount = Object.values(byStatus).reduce((s, n) => s + n, 0);
    return dto.job(j, { applicantsCount, countsByStatus: byStatus });
  });
}

router.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await jobsWithCounts({ company: companyOf(req) }) });
  }),
);

router.post(
  '/jobs',
  validate(jobBody),
  asyncHandler(async (req, res) => {
    if (req.body.salaryMax < req.body.salaryMin) throw new ApiError(400, 'salaryMax: Must be ≥ minimum');
    if (req.body.status === 'active') await consumeCredit(req.user!.id);
    const job = await Job.create({
      ...req.body,
      company: companyOf(req),
      postedBy: req.user!.id,
      publishedAt: req.body.status === 'active' ? new Date() : undefined,
    });
    res.status(201).json({ success: true, data: (await jobsWithCounts({ _id: job._id }))[0] });
  }),
);

async function ownJob(req: { params: { id?: string }; user?: { company?: string } }) {
  const job = await Job.findOne({ _id: req.params.id, company: companyOf(req) });
  if (!job) throw new ApiError(404, 'Job post not found.');
  return job;
}

router.patch(
  '/jobs/:id',
  validate(jobBody.partial()),
  asyncHandler(async (req, res) => {
    const job = await ownJob(req);
    const goingLive = job.status === 'draft' && req.body.status === 'active';
    if (goingLive) await consumeCredit(req.user!.id);
    Object.assign(job, req.body);
    if (goingLive) job.publishedAt = new Date();
    await job.save();
    res.json({ success: true, data: (await jobsWithCounts({ _id: job._id }))[0] });
  }),
);

router.patch(
  '/jobs/:id/status',
  validate(z.object({ status: z.enum(JOB_STATUSES) })),
  asyncHandler(async (req, res) => {
    const job = await ownJob(req);
    if (job.status === 'draft' && req.body.status === 'active') {
      await consumeCredit(req.user!.id);
      job.publishedAt = new Date();
    }
    job.status = req.body.status;
    await job.save();
    res.json({ success: true, data: (await jobsWithCounts({ _id: job._id }))[0] });
  }),
);

router.post(
  '/jobs/:id/duplicate',
  asyncHandler(async (req, res) => {
    const job = await ownJob(req);
    const copy = job.toObject() as Record<string, unknown>;
    for (const k of ['_id', 'id', 'createdAt', 'updatedAt', 'publishedAt', 'views']) delete copy[k];
    const created = await Job.create({ ...copy, title: `${job.title} (Copy)`, status: 'draft', views: 0 });
    res.status(201).json({ success: true, data: (await jobsWithCounts({ _id: created._id }))[0] });
  }),
);

router.delete(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await ownJob(req);
    const apps = await Application.find({ job: job._id }).select('_id');
    await Interview.deleteMany({ application: { $in: apps.map((a) => a._id) } });
    await Application.deleteMany({ job: job._id });
    await job.deleteOne();
    res.json({ success: true, message: 'Job post deleted.' });
  }),
);

// ── Applicants ──────────────────────────────────────────────────────────

router.get(
  '/applicants',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { company: companyOf(req) };
    if (req.query.job) filter.job = req.query.job;
    if (req.query.status) filter.status = req.query.status;
    const items = await Application.find(filter).sort({ createdAt: -1 }).populate('job applicant');
    res.json({ success: true, data: items.map(dto.applicant) });
  }),
);

async function ownApplication(req: { params: { id?: string }; user?: { company?: string } }) {
  const a = await Application.findOne({ _id: req.params.id, company: companyOf(req) }).populate('job applicant');
  if (!a) throw new ApiError(404, 'Applicant not found.');
  return a;
}

router.get(
  '/applicants/:id',
  asyncHandler(async (req, res) => res.json({ success: true, data: dto.applicant(await ownApplication(req)) })),
);

const stageMessage: Record<string, string> = {
  shortlisted: 'You have been shortlisted',
  interview: 'You have been moved to the interview stage',
  offered: 'You received an offer',
  hired: 'Congratulations, you are hired',
  rejected: 'The company decided to move forward with other candidates',
  applied: 'Your application is back under review',
};

router.patch(
  '/applicants/:id',
  validate(z.object({ status: z.enum(APPLICATION_STATUSES).optional(), note: z.string().trim().optional() })),
  asyncHandler(async (req, res) => {
    const a = await ownApplication(req);
    const changed = req.body.status && req.body.status !== a.status;
    if (req.body.status) a.status = req.body.status;
    if (req.body.note !== undefined) a.note = req.body.note;
    await a.save();
    if (changed) {
      const job = a.job as unknown as { title: string };
      await notify(
        (a.applicant as unknown as { _id: string })._id,
        'applicationStatus',
        'Application Update',
        `${stageMessage[a.status]} for ${job.title}.`,
        a._id,
      );
    }
    res.json({ success: true, data: dto.applicant(a) });
  }),
);

router.post(
  '/applicants/:id/offer',
  validate(
    z.object({
      designation: z.string().trim().min(2),
      amount: z.number().positive('Enter the offered amount'),
      joiningDate: z.coerce.date(),
      probation: z.string().trim().default('3 months'),
      message: z.string().trim().default(''),
    }),
  ),
  asyncHandler(async (req, res) => {
    const a = await ownApplication(req);
    const job = a.job as unknown as { title: string; type: string };
    const pay = job.type === 'Internship' ? `₹${req.body.amount}K /month` : `₹${req.body.amount} LPA`;
    a.offer = req.body;
    a.status = 'offered';
    a.note = `Offer: ${pay} · Joining ${new Date(req.body.joiningDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    await a.save();
    await notify(
      (a.applicant as unknown as { _id: string })._id,
      'offerReceived',
      'Offer Received',
      `You received an offer for ${req.body.designation}: ${pay}.`,
      a._id,
    );
    res.json({ success: true, data: dto.applicant(a) });
  }),
);

// ── Interviews ─────────────────────────────────────────────────────────

router.get(
  '/interviews',
  asyncHandler(async (req, res) => {
    const items = await Interview.find({ company: companyOf(req) }).sort({ dateTime: 1 }).populate('candidate');
    res.json({ success: true, data: items.map(dto.interview) });
  }),
);

router.post(
  '/interviews',
  validate(
    z.object({
      applicationId: z.string().min(1),
      dateTime: z.coerce.date(),
      mode: z.enum(INTERVIEW_MODES),
      round: z.string().trim().min(2),
      durationMins: z.number().int().min(10).max(480).default(45),
      interviewer: z.string().trim().min(2, 'Interviewer is required'),
      link: z.string().trim().min(2, 'Add a link, phone or address'),
      message: z.string().trim().default(''),
    }),
  ),
  asyncHandler(async (req, res) => {
    const a = await Application.findOne({ _id: req.body.applicationId, company: companyOf(req) }).populate('job');
    if (!a) throw new ApiError(404, 'Applicant not found.');
    const job = a.job as unknown as { title: string };
    const { applicationId, ...rest } = req.body;
    const iv = await Interview.create({
      ...rest,
      application: applicationId,
      company: companyOf(req),
      candidate: a.applicant,
      jobTitle: job.title,
    });
    a.status = 'interview';
    await a.save();
    await notify(
      a.applicant,
      'interviewScheduled',
      'Interview Scheduled',
      `${req.body.round} for ${job.title} on ${new Date(req.body.dateTime).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`,
      a._id,
    );
    res.status(201).json({ success: true, data: dto.interview(await iv.populate('candidate')) });
  }),
);

router.patch(
  '/interviews/:id',
  validate(z.object({ status: z.enum(INTERVIEW_STATUSES) })),
  asyncHandler(async (req, res) => {
    const iv = await Interview.findOneAndUpdate(
      { _id: req.params.id, company: companyOf(req) },
      { status: req.body.status },
      { new: true },
    ).populate('candidate');
    if (!iv) throw new ApiError(404, 'Interview not found.');
    if (req.body.status === 'cancelled') {
      await notify(iv.candidate, 'interviewScheduled', 'Interview Cancelled', `${iv.round} for ${iv.jobTitle} was cancelled.`, iv.application);
    }
    res.json({ success: true, data: dto.interview(iv) });
  }),
);

// ── Analytics ──────────────────────────────────────────────────────────

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.period)) ? Number(req.query.period) : 7;
    const company = companyOf(req);
    const since = new Date(Date.now() - days * 86400000);
    const [jobs, apps] = await Promise.all([
      Job.find({ company }).select('title views status'),
      Application.find({ company }).select('status createdAt job'),
    ]);
    const recent = apps.filter((a) => a.createdAt >= since);

    // Applications per bucket: days for 7, weeks for 30, months for 90.
    const buckets: { label: string; count: number }[] = [];
    const n = days === 7 ? 7 : days === 30 ? 4 : 3;
    const size = days / n;
    for (let i = n - 1; i >= 0; i--) {
      const end = Date.now() - i * size * 86400000;
      const start = end - size * 86400000;
      const d = new Date(end - 1);
      buckets.push({
        label:
          days === 7
            ? d.toLocaleDateString('en-IN', { weekday: 'short' })
            : days === 30
              ? `Wk ${n - i}`
              : d.toLocaleDateString('en-IN', { month: 'short' }),
        count: recent.filter((a) => +a.createdAt >= start && +a.createdAt < end).length,
      });
    }
    const order = ['applied', 'shortlisted', 'interview', 'offered', 'hired'];
    const reached = (stage: string) =>
      apps.filter((a) => a.status !== 'rejected' && order.indexOf(a.status) >= order.indexOf(stage)).length;
    res.json({
      success: true,
      data: {
        period: days,
        views: jobs.reduce((s, j) => s + (j.views ?? 0), 0),
        applications: apps.length,
        hires: apps.filter((a) => a.status === 'hired').length,
        series: buckets,
        funnel: [
          { label: 'Applied', count: apps.filter((a) => a.status !== 'rejected').length },
          { label: 'Shortlisted', count: reached('shortlisted') },
          { label: 'Interview', count: reached('interview') },
          { label: 'Offered', count: reached('offered') },
          { label: 'Hired', count: reached('hired') },
        ],
        topJobs: jobs
          .filter((j) => j.views > 0)
          .sort((a, b) => b.views - a.views)
          .slice(0, 4)
          .map((j) => ({
            id: String(j._id),
            title: j.title,
            views: j.views,
            status: j.status,
            applicants: apps.filter((a) => String(a.job) === String(j._id)).length,
          })),
      },
    });
  }),
);

export default router;
