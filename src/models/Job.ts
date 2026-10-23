import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

export const JOB_TYPES = ['Full-time', 'Part-time', 'Internship', 'Contract'] as const;
export const WORK_MODES = ['On-site', 'Remote', 'Hybrid'] as const;
export const JOB_STATUSES = ['active', 'paused', 'draft', 'closed'] as const;

const jobSchema = withJson(new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, default: 'Engineering' },
    type: { type: String, enum: JOB_TYPES, default: 'Full-time' },
    workMode: { type: String, enum: WORK_MODES, default: 'On-site' },
    location: { type: String, default: '' },
    /** Lakhs per year for jobs, thousands per month for internships. */
    salaryMin: { type: Number, default: 0 },
    salaryMax: { type: Number, default: 0 },
    experience: { type: String, default: '1–3 yrs' },
    level: { type: String, default: 'Junior Level' },
    openings: { type: Number, default: 1, min: 1 },
    skills: { type: [String], default: [] },
    description: { type: String, default: '' },
    responsibilities: { type: [String], default: [] },
    perks: { type: [String], default: [] },
    status: { type: String, enum: JOB_STATUSES, default: 'active' },
    deadline: { type: Date },
    views: { type: Number, default: 0 },
    isUrgent: { type: Boolean, default: false },
    duration: { type: String },
    publishedAt: { type: Date },
  },
  { timestamps: true },
));

jobSchema.index({ status: 1, createdAt: -1 });

export const Job = model('Job', jobSchema);
