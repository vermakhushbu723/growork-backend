import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

const walletSchema = withJson(new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, default: 0, min: 0 },
    /** Client: money funded into milestones and not yet released. */
    escrow: { type: Number, default: 0, min: 0 },
    /** Recruiter hiring plan and remaining job-post credits. */
    plan: { type: String, default: 'Starter' },
    jobCredits: { type: Number, default: 2, min: 0 },
  },
  { timestamps: true },
));

export const Wallet = model('Wallet', walletSchema);

/** Icon keys the apps map to icons. */
export const TX_KINDS = ['payout', 'fee', 'escrowFund', 'escrowRelease', 'escrowRefund', 'withdrawal', 'topup', 'plan'] as const;

const transactionSchema = withJson(new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    isCredit: { type: Boolean, required: true },
    kind: { type: String, enum: TX_KINDS, required: true },
  },
  { timestamps: true },
));

transactionSchema.index({ user: 1, createdAt: -1 });

export const Transaction = model('Transaction', transactionSchema);
