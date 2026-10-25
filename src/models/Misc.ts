import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

/**
 * In-app notification. `type` decides where the app opens it
 * (each app maps the type to one of its own screens) and `ref` is the
 * related document id.
 */
export const NOTIFICATION_TYPES = [
  'jobMatch',
  'applicationReceived',
  'applicationStatus',
  'interviewScheduled',
  'offerReceived',
  'proposalReceived',
  'proposalStatus',
  'hired',
  'milestoneFunded',
  'milestoneSubmitted',
  'milestoneReleased',
  'revisionRequested',
  'contractEnded',
  'message',
  'payment',
  'invite',
  'plan',
  'call',
] as const;

const notificationSchema = withJson(new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    ref: { type: String, default: '' },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
));

notificationSchema.index({ user: 1, createdAt: -1 });

export const Notification = model('Notification', notificationSchema);

const reviewSchema = withJson(new Schema(
  {
    reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    /** "Freelance Project", "Job Application", "Freelancer"… */
    context: { type: String, default: '' },
    contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  },
  { timestamps: true },
));

export const Review = model('Review', reviewSchema);

export const SAVED_KINDS = ['job', 'project', 'talent'] as const;

const savedSchema = withJson(new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: SAVED_KINDS, required: true },
    ref: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
));

savedSchema.index({ user: 1, kind: 1, ref: 1 }, { unique: true });

export const Saved = model('Saved', savedSchema);

const otpSchema = withJson(new Schema(
  {
    /** Email or phone the code was sent to. */
    target: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, enum: ['login', 'reset'], required: true },
    code: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
));

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = model('Otp', otpSchema);
