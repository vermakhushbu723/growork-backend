import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

/**
 * ringing → accepted → ended, or ringing → declined / missed / cancelled.
 * Media goes through LiveKit; this only tracks who called whom.
 */
export const CALL_STATUSES = ['ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended'] as const;

const callSchema = withJson(new Schema(
  {
    caller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    callee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** LiveKit room name. */
    room: { type: String, required: true },
    video: { type: Boolean, default: false },
    status: { type: String, enum: CALL_STATUSES, default: 'ringing' },
    answeredAt: Date,
    endedAt: Date,
  },
  { timestamps: true },
));

callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ callee: 1, createdAt: -1 });

export const Call = model('Call', callSchema);
