import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';
import { PRICING } from './Project.js';

/** Client funds → freelancer submits → client releases (or asks for a revision). */
export const MILESTONE_STATUSES = ['notFunded', 'funded', 'submitted', 'revision', 'released'] as const;

const milestoneSchema = withJson(new Schema(
  {
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 1 },
    dueIn: { type: String, default: 'Due in 7 days' },
    status: { type: String, enum: MILESTONE_STATUSES, default: 'notFunded' },
    /** Freelancer's delivery note, or the client's revision request. */
    note: { type: String, default: '' },
  },
  { timestamps: false },
));

const contractSchema = withJson(new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    proposal: { type: Schema.Types.ObjectId, ref: 'Proposal' },
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    freelancer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    pricing: { type: String, enum: PRICING, default: 'fixed' },
    milestones: { type: [milestoneSchema], default: [] },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    rating: Number,
    review: String,
  },
  { timestamps: true },
));

export const Contract = model('Contract', contractSchema);
