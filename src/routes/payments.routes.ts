import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { credit, notify, walletOf } from '../services/core.js';
import { checkoutSignatureValid, createOrder, razorpayReady, webhookSignatureValid } from '../services/razorpay.js';
import { ApiError, asyncHandler } from '../utils/http.js';

/**
 * Adding money to the wallet through Razorpay:
 * 1. `POST /payments/order` → the app opens Razorpay Checkout with it;
 * 2. `POST /payments/verify` with Checkout's result → wallet credited;
 * 3. `POST /payments/webhook` (from Razorpay) credits it too, in case the
 *    app closed before step 2. The wallet is credited exactly once.
 */
const router = Router();

const notReady = () => new ApiError(503, 'Online payments aren’t set up yet. Please try again later.');

/** Credits the wallet the first time an order is confirmed paid. */
async function fulfil(orderId: string, paymentId: string) {
  const payment = await Payment.findOneAndUpdate(
    { orderId, status: { $ne: 'paid' } },
    { status: 'paid', paymentId, paidAt: new Date(), error: '' },
    { new: true },
  );
  if (!payment) return null; // already credited (or unknown order)
  const w = await credit(payment.user, payment.amount, 'Added money via Razorpay', 'topup');
  await notify(payment.user, 'payment', 'Money Added', `₹${payment.amount.toLocaleString('en-IN')} added to your wallet.`, payment._id);
  return w;
}

router.get(
  '/payments/config',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: { enabled: razorpayReady(), keyId: razorpayReady() ? env.razorpayKeyId : '' } });
  }),
);

router.post(
  '/payments/order',
  requireAuth,
  validate(z.object({ amount: z.number().int().min(100, 'Enter at least ₹100').max(500000, 'You can add up to ₹5,00,000 at a time') })),
  asyncHandler(async (req, res) => {
    if (!razorpayReady()) throw notReady();
    const me = await User.findById(req.user!.id).select('name email phone');
    const receipt = `w_${req.user!.id.slice(-8)}_${Date.now()}`;
    const order = await createOrder(req.body.amount, receipt, { userId: req.user!.id, purpose: 'wallet_topup' });
    await Payment.create({ user: req.user!.id, amount: req.body.amount, orderId: order.id });
    res.status(201).json({
      success: true,
      data: {
        keyId: env.razorpayKeyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        name: 'Subkamyaab',
        description: 'Add money to wallet',
        prefill: { name: me?.name ?? '', email: me?.email ?? '', contact: me?.phone ?? '' },
      },
    });
  }),
);

router.post(
  '/payments/verify',
  requireAuth,
  validate(z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    if (!razorpayReady()) throw notReady();
    const { orderId, paymentId, signature } = req.body;
    const payment = await Payment.findOne({ orderId, user: req.user!.id });
    if (!payment) throw new ApiError(404, 'Payment not found.');
    if (!checkoutSignatureValid(orderId, paymentId, signature)) throw new ApiError(400, 'Payment could not be verified.');
    await fulfil(orderId, paymentId);
    const w = await walletOf(req.user!.id);
    res.json({ success: true, data: { balance: w.balance, amount: payment.amount } });
  }),
);

/** Checkout was closed or failed (for the record; nothing is charged). */
router.post(
  '/payments/failed',
  requireAuth,
  validate(z.object({ orderId: z.string().min(1), reason: z.string().trim().max(300).default('') })),
  asyncHandler(async (req, res) => {
    await Payment.updateOne({ orderId: req.body.orderId, user: req.user!.id, status: 'created' }, { status: 'failed', error: req.body.reason });
    res.json({ success: true });
  }),
);

/** Razorpay → us. Mounted with a raw body parser in app.ts (signature is over the raw bytes). */
router.post(
  '/payments/webhook',
  asyncHandler(async (req, res) => {
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !webhookSignatureValid(raw, String(req.headers['x-razorpay-signature'] ?? ''))) {
      throw new ApiError(400, 'Invalid signature.');
    }
    const event = JSON.parse(raw.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string; error_description?: string } } };
    };
    const p = event.payload?.payment?.entity;
    if (p?.order_id) {
      if (event.event === 'payment.captured' || event.event === 'order.paid') {
        await fulfil(p.order_id, p.id);
      } else if (event.event === 'payment.failed') {
        await Payment.updateOne({ orderId: p.order_id, status: 'created' }, { status: 'failed', error: p.error_description ?? '' });
      }
    }
    res.json({ success: true });
  }),
);

export default router;
