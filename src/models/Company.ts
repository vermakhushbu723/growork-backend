import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

export const MEMBER_ROLES = ['Admin', 'Recruiter', 'Hiring Manager', 'Viewer'] as const;

const memberSchema = withJson(new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: MEMBER_ROLES, default: 'Recruiter' },
    pending: { type: Boolean, default: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: false },
));

const companySchema = withJson(new Schema(
  {
    name: { type: String, required: true, trim: true },
    industry: { type: String, default: 'Information Technology' },
    size: { type: String, default: '1-10 employees' },
    website: { type: String, default: '' },
    location: { type: String, default: '' },
    about: { type: String, default: '' },
    founded: { type: String, default: '' },
    gstin: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    pageViews: { type: Number, default: 0 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true },
));

export const Company = model('Company', companySchema);
