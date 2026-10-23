import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';
import { PRICING } from './Project.js';

/** Freelancer-facing lifecycle; the client app shows submitted+viewed as "New". */
export const PROPOSAL_STATUSES = ['submitted', 'viewed', 'shortlisted', 'interview', 'hired', 'declined'] as const;

const proposalSchema = withJson(new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pricing: { type: String, enum: PRICING, default: 'fixed' },
    /** Total bid for fixed price, rate per hour for hourly. */
    amount: { type: Number, required: true, min: 1 },
    deliveryDays: { type: Number, default: 7, min: 1 },
    coverLetter: { type: String, required: true },
    status: { type: String, enum: PROPOSAL_STATUSES, default: 'submitted' },
  },
  { timestamps: true },
));

proposalSchema.index({ project: 1, freelancer: 1 }, { unique: true });

export const Proposal = model('Proposal', proposalSchema);
