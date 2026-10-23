import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

export const PRICING = ['fixed', 'hourly'] as const;
export const PROJECT_STATUSES = ['open', 'inProgress', 'completed', 'draft', 'closed'] as const;

const projectSchema = withJson(new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company' },
    title: { type: String, required: true, trim: true },
    category: { type: String, default: 'Web Development' },
    description: { type: String, default: '' },
    skills: { type: [String], default: [] },
    pricing: { type: String, enum: PRICING, default: 'fixed' },
    /** Whole-project budget for fixed price, rupees per hour for hourly. */
    budgetMin: { type: Number, default: 0 },
    budgetMax: { type: Number, default: 0 },
    duration: { type: String, default: '1–2 weeks' },
    level: { type: String, default: 'Intermediate' },
    visibility: { type: String, enum: ['Public', 'Invite only'], default: 'Public' },
    status: { type: String, enum: PROJECT_STATUSES, default: 'open' },
    views: { type: Number, default: 0 },
    attachments: { type: [String], default: [] },
    hiredFreelancer: { type: Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date },
  },
  { timestamps: true },
));

projectSchema.index({ status: 1, createdAt: -1 });

export const Project = model('Project', projectSchema);
