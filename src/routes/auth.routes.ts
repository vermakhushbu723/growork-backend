import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth, signToken } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Application } from '../models/Application.js';
import { Conversation, Message } from '../models/Chat.js';
import { Company } from '../models/Company.js';
import { Notification, Otp, Saved } from '../models/Misc.js';
import { Proposal } from '../models/Proposal.js';
import { ACCOUNT_TYPES, SEEKER_ROLES, User } from '../models/User.js';
import { Transaction, Wallet } from '../models/Wallet.js';
import { walletOf } from '../services/core.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();

const app = z.enum(['seeker', 'recruiter']);
const email = z.string().trim().toLowerCase().email('Enter a valid email address');

/** The signed-in user, with the company for recruiters. */
export async function meDto(userId: string) {
  const user = await User.findById(userId).populate('company');
  if (!user) throw new ApiError(404, 'Account not found.');
  return user.toJSON();
}

async function session(user: { _id: unknown; app: string }) {
  return { token: signToken(user), user: await meDto(String(user._id)) };
}

router.post(
  '/register',
  validate(
    z.object({
      app,
      name: z.string().trim().min(2, 'Enter your full name'),
      email,
      password: z.string().min(6, 'Password must be at least 6 characters'),
      phone: z.string().trim().optional().default(''),
      company: z.string().trim().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { app, name, email, password, phone, company } = req.body;
    if (await User.exists({ email })) throw new ApiError(409, 'An account with this email already exists.');
    if (app === 'recruiter' && !company) throw new ApiError(400, 'company: Company name is required');
    const user = await User.create({
      app,
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      designation: app === 'recruiter' ? 'HR Manager' : '',
    });
    if (app === 'recruiter') {
      const c = await Company.create({
        name: company,
        owner: user._id,
        members: [{ name, email, role: 'Admin', pending: false, user: user._id }],
      });
      user.company = c._id;
      await user.save();
    }
    await walletOf(user._id);
    res.status(201).json({ success: true, data: await session(user) });
  }),
);

router.post(
  '/login',
  validate(z.object({ app, email, password: z.string().min(1, 'Password is required') })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      throw new ApiError(401, 'Incorrect email or password.');
    }
    if (user.app !== req.body.app) {
      throw new ApiError(
        403,
        user.app === 'recruiter'
          ? 'This is a recruiter account. Please use the Subkamyaab Recruiter app.'
          : 'This is a job seeker account. Please use the Subkamyaab app.',
      );
    }
    res.json({ success: true, data: await session(user) });
  }),
);

/** Finds an account by email or phone (digits only, last 10). */
async function findByTarget(target: string) {
  if (target.includes('@')) return User.findOne({ email: target.toLowerCase() });
  const digits = target.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  return User.findOne({ phone: { $regex: `${digits.slice(0, 5)}\\s?${digits.slice(5)}$` } });
}

router.post(
  '/otp/send',
  validate(z.object({ target: z.string().trim().min(5, 'Enter your phone or email'), purpose: z.enum(['login', 'reset']) })),
  asyncHandler(async (req, res) => {
    const user = await findByTarget(req.body.target);
    if (!user) throw new ApiError(404, 'No account found for this phone or email.');
    const code = String(randomInt(1000, 10000));
    await Otp.deleteMany({ target: req.body.target.toLowerCase(), purpose: req.body.purpose });
    await Otp.create({
      target: req.body.target,
      purpose: req.body.purpose,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    // SMS / email delivery would go here; dev mode hands the code back.
    res.json({ success: true, message: 'OTP sent', data: env.otpDevMode ? { devOtp: code } : {} });
  }),
);

router.post(
  '/otp/verify',
  validate(
    z.object({
      target: z.string().trim().min(5),
      purpose: z.enum(['login', 'reset']),
      code: z.string().trim().length(4, 'Enter the 4-digit code'),
      app: app.optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const otp = await Otp.findOne({ target: req.body.target.toLowerCase(), purpose: req.body.purpose });
    if (!otp || otp.expiresAt < new Date()) throw new ApiError(400, 'The code has expired. Please request a new one.');
    if (otp.attempts >= 5) throw new ApiError(429, 'Too many attempts. Please request a new code.');
    if (otp.code !== req.body.code) {
      otp.attempts += 1;
      await otp.save();
      throw new ApiError(400, 'Incorrect code.');
    }
    await otp.deleteOne();
    const user = await findByTarget(req.body.target);
    if (!user) throw new ApiError(404, 'Account not found.');
    if (req.body.purpose === 'reset') {
      const resetToken = jwt.sign({ sub: String(user._id), purpose: 'reset' }, env.jwtSecret, { expiresIn: '15m' });
      return res.json({ success: true, data: { resetToken } });
    }
    if (req.body.app && req.body.app !== user.app) throw new ApiError(403, 'This account belongs to the other app.');
    res.json({ success: true, data: await session(user) });
  }),
);

router.post(
  '/reset-password',
  validate(z.object({ resetToken: z.string().min(10), password: z.string().min(6, 'Password must be at least 6 characters') })),
  asyncHandler(async (req, res) => {
    let payload: { sub: string; purpose?: string };
    try {
      payload = jwt.verify(req.body.resetToken, env.jwtSecret) as typeof payload;
    } catch {
      throw new ApiError(400, 'Reset link expired. Please start again.');
    }
    if (payload.purpose !== 'reset') throw new ApiError(400, 'Invalid reset token.');
    await User.updateOne({ _id: payload.sub }, { passwordHash: await bcrypt.hash(req.body.password, 10) });
    res.json({ success: true, message: 'Password updated. Please log in.' });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => res.json({ success: true, data: await meDto(req.user!.id) })),
);

const profileFields = z
  .object({
    name: z.string().trim().min(2),
    email,
    phone: z.string().trim(),
    avatarUrl: z.string().trim(),
    role: z.enum(SEEKER_ROLES),
    headline: z.string().trim(),
    location: z.string().trim(),
    bio: z.string().trim(),
    skills: z.array(z.string().trim().min(1)).max(50),
    experience: z.string().trim(),
    education: z.string().trim(),
    college: z.string().trim(),
    course: z.string().trim(),
    graduationYear: z.string().trim(),
    currentCompany: z.string().trim(),
    expectedSalary: z.string().trim(),
    noticePeriod: z.string().trim(),
    hourlyRate: z.number().min(0),
    available: z.boolean(),
    accountType: z.enum(ACCOUNT_TYPES),
    designation: z.string().trim(),
  })
  .partial();

router.patch(
  '/me',
  requireAuth,
  validate(profileFields),
  asyncHandler(async (req, res) => {
    if (req.body.email && (await User.exists({ email: req.body.email, _id: { $ne: req.user!.id } }))) {
      throw new ApiError(409, 'That email is already used by another account.');
    }
    await User.updateOne({ _id: req.user!.id }, req.body, { runValidators: true });
    res.json({ success: true, data: await meDto(req.user!.id) });
  }),
);

router.patch(
  '/password',
  requireAuth,
  validate(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) })),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).select('+passwordHash');
    if (!user || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'Current password is incorrect.');
    }
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'Password changed.' });
  }),
);

router.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const uid = req.user!.id;
    const convs = await Conversation.find({ participants: uid }).select('_id');
    await Promise.all([
      Message.deleteMany({ conversation: { $in: convs.map((c) => c._id) } }),
      Conversation.deleteMany({ participants: uid }),
      Notification.deleteMany({ user: uid }),
      Saved.deleteMany({ user: uid }),
      Application.deleteMany({ applicant: uid }),
      Proposal.deleteMany({ freelancer: uid }),
      Transaction.deleteMany({ user: uid }),
      Wallet.deleteMany({ user: uid }),
    ]);
    await User.deleteOne({ _id: uid });
    res.json({ success: true, message: 'Account deleted.' });
  }),
);

export default router;
