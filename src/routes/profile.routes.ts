import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Application } from '../models/Application.js';
import { Conversation } from '../models/Chat.js';
import { Saved } from '../models/Misc.js';
import { User } from '../models/User.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { meDto } from './auth.routes.js';

const router = Router();
router.use(['/profile', '/settings'], requireAuth);

router.get(
  '/profile/stats',
  asyncHandler(async (req, res) => {
    const uid = req.user!.id;
    const [applied, interviews, offers, saved, activeChats, user] = await Promise.all([
      Application.countDocuments({ applicant: uid }),
      Application.countDocuments({ applicant: uid, status: 'interview' }),
      Application.countDocuments({ applicant: uid, status: { $in: ['offered', 'hired'] } }),
      Saved.countDocuments({ user: uid, kind: { $in: ['job', 'project'] } }),
      Conversation.countDocuments({ participants: uid }),
      User.findById(uid).select('profileViews'),
    ]);
    res.json({
      success: true,
      data: { applied, interviews, offers, saved, activeChats, profileViews: user?.profileViews ?? 0 },
    });
  }),
);

/** CRUD for one embedded list on the user (documents, certificates, portfolio). */
function listRoutes<T extends z.ZodTypeAny>(path: string, field: 'documents' | 'certificates' | 'portfolio', schema: T) {
  router.post(
    `/profile/${path}`,
    validate(schema),
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user!.id);
      if (!user) throw new ApiError(404, 'Account not found.');
      (user[field] as unknown as { unshift: (v: unknown) => void }).unshift(req.body);
      await user.save();
      res.status(201).json({ success: true, data: await meDto(req.user!.id) });
    }),
  );
  router.delete(
    `/profile/${path}/:itemId`,
    asyncHandler(async (req, res) => {
      // (modifiedCount can't be used: timestamps always bump updatedAt.)
      if (!(await User.exists({ _id: req.user!.id, [`${field}._id`]: req.params.itemId }))) {
        throw new ApiError(404, 'Item not found.');
      }
      await User.updateOne({ _id: req.user!.id }, { $pull: { [field]: { _id: req.params.itemId } } });
      res.json({ success: true, data: await meDto(req.user!.id) });
    }),
  );
}

listRoutes(
  'documents',
  'documents',
  z.object({
    name: z.string().trim().min(1, 'File name is required'),
    kind: z.string().trim().default('Document'),
    size: z.string().trim().default('—'),
    url: z.string().trim().url('Upload the file first').or(z.literal('')).default(''),
    isPrimaryResume: z.boolean().default(false),
  }),
);
listRoutes(
  'certificates',
  'certificates',
  z.object({
    title: z.string().trim().min(2, 'Certificate title is required'),
    issuer: z.string().trim().default(''),
    date: z.string().trim().default(''),
  }),
);
listRoutes(
  'portfolio',
  'portfolio',
  z.object({
    title: z.string().trim().min(2, 'Project title is required'),
    category: z.string().trim().default('Project'),
    tags: z.array(z.string().trim()).default([]),
    link: z.string().trim().default(''),
  }),
);

/** Makes one document the primary resume (used by default when applying). */
router.patch(
  '/profile/documents/:itemId/primary',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw new ApiError(404, 'Account not found.');
    let found = false;
    for (const d of user.documents) {
      d.isPrimaryResume = String(d._id) === req.params.itemId;
      found ||= d.isPrimaryResume;
    }
    if (!found) throw new ApiError(404, 'Document not found.');
    await user.save();
    res.json({ success: true, data: await meDto(req.user!.id) });
  }),
);

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).select('settings');
    res.json({ success: true, data: user?.settings ?? {} });
  }),
);

router.patch(
  '/settings',
  validate(
    z
      .object({
        language: z.string().trim(),
        pushNotifications: z.boolean(),
        emailNotifications: z.boolean(),
        jobAlerts: z.boolean(),
        applicantAlerts: z.boolean(),
        proposalAlerts: z.boolean(),
        emailDigest: z.boolean(),
        autoReply: z.boolean(),
        publicProfile: z.boolean(),
        showPhone: z.boolean(),
        allowMessages: z.boolean(),
        twoStep: z.boolean(),
      })
      .partial(),
  ),
  asyncHandler(async (req, res) => {
    const set = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [`settings.${k}`, v]));
    await User.updateOne({ _id: req.user!.id }, { $set: set });
    const user = await User.findById(req.user!.id).select('settings');
    res.json({ success: true, data: user?.settings ?? {} });
  }),
);

export default router;
