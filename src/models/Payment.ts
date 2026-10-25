import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

/** created → paid (wallet credited once) or failed. */
export const PAYMENT_STATUSES = ['created', 'paid', 'failed'] as const;

/** A Razorpay order to add money to the wallet. */
const paymentSchema = withJson(new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Rupees. */
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },
    orderId: { type: String, required: true, unique: true },
    paymentId: { type: String, default: '' },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created' },
    error: { type: String, default: '' },
    paidAt: Date,
  },
  { timestamps: true },
));

paymentSchema.index({ user: 1, createdAt: -1 });

export const Payment = model('Payment', paymentSchema);
