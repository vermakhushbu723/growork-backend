import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'interview', 'offered', 'hired', 'rejected'] as const;

const applicationSchema = withJson(new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    applicant: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resumeName: { type: String, default: 'Resume.pdf' },
    resumeUrl: { type: String, default: '' },
    coverLetter: { type: String, default: '' },
    noticePeriod: { type: String, default: 'Immediately' },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'applied' },
    /** 0–100: share of the job's skills the applicant has. */
    matchScore: { type: Number, default: 0 },
    /** Private recruiter note, or the offer summary once an offer is sent. */
    note: { type: String, default: '' },
    offer: {
      designation: String,
      amount: Number,
      joiningDate: Date,
      probation: String,
      message: String,
    },
  },
  { timestamps: true },
));

applicationSchema.index({ job: 1, applicant: 1 }, { unique: true });

export const Application = model('Application', applicationSchema);
