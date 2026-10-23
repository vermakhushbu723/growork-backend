import { Router } from 'express';
import { z } from 'zod';
import { requireRecruiter } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Job } from '../models/Job.js';
import { Project } from '../models/Project.js';
import { User } from '../models/User.js';
import { notify, searchRegex } from '../services/core.js';
import * as dto from '../services/serialize.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use('/talent', requireRecruiter);

/** Search public job-seeker and freelancer profiles. */
router.get(
  '/talent',
  asyncHandler(async (req, res) => {
    const { q, kind, available } = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { app: 'seeker', 'settings.publicProfile': { $ne: false } };
    if (kind === 'freelancer') filter.role = 'freelancer';
    if (kind === 'candidate') filter.role = { $ne: 'freelancer' };
    if (available === 'true') filter.available = true;
    const rx = searchRegex(q);
    if (rx) filter.$or = [{ name: rx }, { headline: rx }, { skills: rx }, { location: rx }];
    const users = await User.find(filter).sort({ rating: -1 }).limit(100);
    res.json({ success: true, data: users.map((u) => dto.talent(u)) });
  }),
);

router.get(
  '/talent/:id',
  asyncHandler(async (req, res) => {
    const u = await User.findOneAndUpdate({ _id: req.params.id, app: 'seeker' }, { $inc: { profileViews: 1 } }, { new: true });
    if (!u) throw new ApiError(404, 'Profile not found.');
    res.json({ success: true, data: dto.talent(u) });
  }),
);

/** Invite a profile to apply to a job or send a proposal on a project. */
router.post(
  '/talent/:id/invite',
  validate(z.object({ jobId: z.string().optional(), projectId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const u = await User.findOne({ _id: req.params.id, app: 'seeker' });
    if (!u) throw new ApiError(404, 'Profile not found.');
    if (req.body.jobId) {
      const job = await Job.findOne({ _id: req.body.jobId, company: req.user!.company, status: 'active' });
      if (!job) throw new ApiError(404, 'Job not found.');
      await notify(u._id, 'invite', 'You’re Invited to Apply', `${req.user!.name} invited you to apply for ${job.title}.`, job._id);
    } else if (req.body.projectId) {
      const p = await Project.findOne({ _id: req.body.projectId, client: req.user!.id, status: 'open' });
      if (!p) throw new ApiError(404, 'Project not found.');
      await notify(u._id, 'invite', 'Project Invitation', `${req.user!.name} invited you to send a proposal for ${p.title}.`, p._id);
    } else {
      throw new ApiError(400, 'Pick a job or project to invite to.');
    }
    res.json({ success: true, message: `Invitation sent to ${u.name}` });
  }),
);

export default router;
