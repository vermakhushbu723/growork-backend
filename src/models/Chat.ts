import { Schema, model } from 'mongoose';
import { withJson } from './_options.js';

const conversationSchema = withJson(new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    /** What the chat is about, shown under the name ("Flutter Developer"). */
    context: { type: String, default: '' },
    lastMessage: { type: String, default: '' },
    lastAt: { type: Date, default: Date.now },
    /** userId → unread count. */
    unread: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
));

conversationSchema.index({ participants: 1, lastAt: -1 });

export const Conversation = model('Conversation', conversationSchema);

const messageSchema = withJson(new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true },
));

messageSchema.index({ conversation: 1, createdAt: 1 });

export const Message = model('Message', messageSchema);
