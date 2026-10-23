import { Router } from 'express';
import { z } from 'zod';
import { requireRecruiter } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Company, MEMBER_ROLES } from '../models/Company.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use('/company', requireRecruiter);

async function myCompany(companyId?: string) {
  const c = await Company.findById(companyId);
  if (!c) throw new ApiError(404, 'Company not found.');
  return c;
}

router.get(
  '/company',
  asyncHandler(async (req, res) => res.json({ success: true, data: (await myCompany(req.user!.company)).toJSON() })),
);

router.patch(
  '/company',
  validate(
    z
      .object({
        name: z.string().trim().min(2),
        industry: z.string().trim(),
        size: z.string().trim(),
        website: z.string().trim(),
        location: z.string().trim(),
        about: z.string().trim(),
        founded: z.string().trim(),
        gstin: z.string().trim(),
        logoUrl: z.string().trim(),
      })
      .partial(),
  ),
  asyncHandler(async (req, res) => {
    const c = await myCompany(req.user!.company);
    Object.assign(c, req.body);
    // A GSTIN plus a website is enough to mark the page verified in this version.
    if (c.gstin && c.website) c.isVerified = true;
    await c.save();
    res.json({ success: true, data: c.toJSON() });
  }),
);

router.post(
  '/company/members',
  validate(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(MEMBER_ROLES), name: z.string().trim().optional() })),
  asyncHandler(async (req, res) => {
    const c = await myCompany(req.user!.company);
    if (c.members.some((m) => m.email === req.body.email)) throw new ApiError(409, 'This person is already on your team.');
    c.members.push({ name: req.body.name || req.body.email.split('@')[0], email: req.body.email, role: req.body.role, pending: true });
    await c.save();
    res.status(201).json({ success: true, data: c.toJSON() });
  }),
);

router.patch(
  '/company/members/:memberId',
  validate(z.object({ role: z.enum(MEMBER_ROLES) })),
  asyncHandler(async (req, res) => {
    const c = await myCompany(req.user!.company);
    const m = c.members.id(req.params.memberId);
    if (!m) throw new ApiError(404, 'Member not found.');
    m.role = req.body.role;
    await c.save();
    res.json({ success: true, data: c.toJSON() });
  }),
);

router.delete(
  '/company/members/:memberId',
  asyncHandler(async (req, res) => {
    const c = await myCompany(req.user!.company);
    const m = c.members.id(req.params.memberId);
    if (!m) throw new ApiError(404, 'Member not found.');
    if (String(m.user) === String(c.owner)) throw new ApiError(400, 'The company owner can’t be removed.');
    m.deleteOne();
    await c.save();
    res.json({ success: true, data: c.toJSON() });
  }),
);

export default router;
