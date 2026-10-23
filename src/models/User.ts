import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { withJson } from './_options.js';

/** Which app the account belongs to. */
export const APPS = ['seeker', 'recruiter'] as const;
/** User-app roles. */
export const SEEKER_ROLES = ['jobSeeker', 'freelancer', 'student', 'employer'] as const;
/** Recruiter-app account types. */
export const ACCOUNT_TYPES = ['recruiter', 'client', 'both'] as const;

const documentSchema = withJson(new Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, default: 'Document' },
    size: { type: String, default: '—' },
    isPrimaryResume: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
));

const certificateSchema = withJson(new Schema(
  {
    title: { type: String, required: true, trim: true },
    issuer: { type: String, default: '' },
    date: { type: String, default: '' },
    verified: { type: Boolean, default: false },
  },
  { timestamps: false },
));

const portfolioSchema = withJson(new Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, default: 'Project' },
    tags: { type: [String], default: [] },
    link: { type: String, default: '' },
  },
  { timestamps: false },
));

const settingsSchema = withJson(new Schema(
  {
    language: { type: String, default: 'English' },
    pushNotifications: { type: Boolean, default: true },
    emailNotifications: { type: Boolean, default: true },
    jobAlerts: { type: Boolean, default: true },
    applicantAlerts: { type: Boolean, default: true },
    proposalAlerts: { type: Boolean, default: true },
    emailDigest: { type: Boolean, default: true },
    autoReply: { type: Boolean, default: false },
    publicProfile: { type: Boolean, default: true },
    showPhone: { type: Boolean, default: false },
    allowMessages: { type: Boolean, default: true },
    twoStep: { type: Boolean, default: false },
  },
  { _id: false },
));

const userSchema = withJson(new Schema(
  {
    app: { type: String, enum: APPS, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    passwordHash: { type: String, required: true, select: false },
    avatarUrl: { type: String, default: '' },

    // ── User app (job seeker / freelancer) ──
    role: { type: String, enum: SEEKER_ROLES, default: 'jobSeeker' },
    headline: { type: String, default: '' },
    location: { type: String, default: '' },
    bio: { type: String, default: '' },
    skills: { type: [String], default: [] },
    experience: { type: String, default: '' },
    education: { type: String, default: '' },
    currentCompany: { type: String, default: '' },
    expectedSalary: { type: String, default: '' },
    noticePeriod: { type: String, default: 'Immediately' },
    hourlyRate: { type: Number, default: 0 },
    available: { type: Boolean, default: true },
    rating: { type: Number, default: 0 },
    jobsDone: { type: Number, default: 0 },
    /** % of past freelance jobs completed successfully. */
    successRate: { type: Number, default: 0 },
    profileViews: { type: Number, default: 0 },
    documents: { type: [documentSchema], default: [] },
    certificates: { type: [certificateSchema], default: [] },
    portfolio: { type: [portfolioSchema], default: [] },

    // ── Recruiter app ──
    accountType: { type: String, enum: ACCOUNT_TYPES, default: 'both' },
    designation: { type: String, default: '' },
    company: { type: Schema.Types.ObjectId, ref: 'Company' },

    settings: { type: settingsSchema, default: () => ({}) },
  },
  { timestamps: true },
));


/** Share of profile fields filled in, 0–1. */
userSchema.virtual('profileCompletion').get(function (this: UserDoc) {
  const checks =
    this.app === 'seeker'
      ? [this.name, this.phone, this.headline, this.location, this.bio, this.skills.length, this.documents.length, this.certificates.length, this.portfolio.length, this.avatarUrl]
      : [this.name, this.phone, this.designation, this.company];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100) / 100;
});

export type UserFields = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserFields>;
export const User = model('User', userSchema);
