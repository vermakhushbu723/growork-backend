import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

export const INTERVIEW_MODES = ['video', 'phone', 'inPerson'] as const;
export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;

const interviewSchema = withJson(new Schema(
  {
    application: { type: Schema.Types.ObjectId, ref: 'Application', required: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobTitle: { type: String, required: true },
    dateTime: { type: Date, required: true },
    mode: { type: String, enum: INTERVIEW_MODES, default: 'video' },
    round: { type: String, default: 'Technical Round' },
    durationMins: { type: Number, default: 45 },
    interviewer: { type: String, default: '' },
    /** Meeting link, phone number or office address depending on mode. */
    link: { type: String, default: '' },
    message: { type: String, default: '' },
    status: { type: String, enum: INTERVIEW_STATUSES, default: 'scheduled' },
  },
  { timestamps: true },
));

export const Interview = model('Interview', interviewSchema);
