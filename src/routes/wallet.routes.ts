import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Contract } from '../models/Contract.js';
import { Transaction } from '../models/Wallet.js';
import { credit, debit, notify, walletOf } from '../services/core.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use(['/wallet', '/plans'], requireAuth);

export const PLANS = [
  { name: 'Starter', price: 0, jobCredits: 2, popular: false, features: ['2 job posts per month', 'Unlimited freelance projects', 'Basic applicant filters'] },
  { name: 'Growth', price: 2999, jobCredits: 15, popular: true, features: ['15 job posts per month', 'Urgent hiring badge', 'AI resume match scores', 'Talent search & invites'] },
  { name: 'Enterprise', price: 9999, jobCredits: 60, popular: false, features: ['60 job posts per month', 'Featured company page', 'Team accounts (up to 10)', 'Dedicated account manager'] },
];
const SINGLE_POST = { name: 'Single post', price: 499, jobCredits: 1 };

router.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const uid = req.user!.id;
    const w = await walletOf(uid);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [transactions, monthTx, allPayouts, contracts] = await Promise.all([
      Transaction.find({ user: uid }).sort({ createdAt: -1 }).limit(50),
      Transaction.find({ user: uid, createdAt: { $gte: monthStart } }),
      Transaction.find({ user: uid, kind: 'payout' }),
      // Freelancers see money clients have locked for them.
      req.user!.app === 'seeker' ? Contract.find({ freelancer: uid, status: 'active' }) : Promise.resolve([]),
    ]);
    const sum = (list: typeof monthTx, pred: (t: (typeof monthTx)[number]) => boolean) =>
      list.filter(pred).reduce((s, t) => s + t.amount, 0);
    const pendingEscrow = contracts.reduce(
      (s, c) => s + c.milestones.filter((m) => ['funded', 'submitted', 'revision'].includes(m.status)).reduce((x, m) => x + m.amount, 0),
      0,
    );
    res.json({
      success: true,
      data: {
        balance: w.balance,
        escrow: req.user!.app === 'seeker' ? pendingEscrow : w.escrow,
        plan: w.plan,
        jobCredits: w.jobCredits,
        totalEarnings: allPayouts.reduce((s, t) => s + t.amount, 0),
        earnedThisMonth: sum(monthTx, (t) => t.kind === 'payout'),
        spentThisMonth: sum(monthTx, (t) => !t.isCredit && ['escrowRelease', 'plan'].includes(t.kind)),
        transactions: transactions.map((t) => t.toJSON()),
      },
    });
  }),
);

const amountBody = z.object({ amount: z.number().int().min(100, 'Enter at least ₹100'), method: z.string().trim().min(2) });

router.post(
  '/wallet/add-money',
  validate(amountBody),
  asyncHandler(async (req, res) => {
    // A payment gateway would confirm the payment before this credit.
    const w = await credit(req.user!.id, req.body.amount, `Added money via ${req.body.method}`, 'topup');
    res.json({ success: true, data: { balance: w.balance } });
  }),
);

router.post(
  '/wallet/withdraw',
  validate(amountBody),
  asyncHandler(async (req, res) => {
    const w = await debit(req.user!.id, req.body.amount, `Withdrawal to ${req.body.method}`, 'withdrawal');
    res.json({ success: true, data: { balance: w.balance } });
  }),
);

router.get('/plans', (_req, res) => res.json({ success: true, data: { plans: PLANS, addOn: SINGLE_POST } }));

router.post(
  '/wallet/plans/buy',
  validate(z.object({ plan: z.string().trim(), addOn: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    if (req.user!.app !== 'recruiter') throw new ApiError(403, 'Plans are for recruiter accounts.');
    const plan = req.body.addOn ? SINGLE_POST : PLANS.find((p) => p.name === req.body.plan);
    if (!plan) throw new ApiError(404, 'Plan not found.');
    if (plan.price > 0) await debit(req.user!.id, plan.price, req.body.addOn ? `${plan.name} purchased` : `${plan.name} plan purchased`, 'plan');
    const w = await walletOf(req.user!.id);
    if (!req.body.addOn) w.plan = plan.name;
    w.jobCredits += plan.jobCredits;
    await w.save();
    await notify(req.user!.id, 'plan', 'Plan Updated', `${plan.name} active · ${w.jobCredits} job credits available.`);
    res.json({ success: true, data: { plan: w.plan, jobCredits: w.jobCredits, balance: w.balance } });
  }),
);

export default router;
