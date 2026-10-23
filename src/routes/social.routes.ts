import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Application } from '../models/Application.js';
import { Conversation, Message } from '../models/Chat.js';
import { Job } from '../models/Job.js';
import { Notification, Review, Saved, SAVED_KINDS } from '../models/Misc.js';
import { Project } from '../models/Project.js';
import { Proposal } from '../models/Proposal.js';
import { User } from '../models/User.js';
import { notify } from '../services/core.js';
import * as dto from '../services/serialize.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use(['/chats', '/notifications', '/saved', '/reviews'], requireAuth);

// ── Chat ───────────────────────────────────────────────────────────────

type Populated = { _id: Types.ObjectId; name: string; app: string; role?: string; accountType?: string; headline?: string; company?: { name?: string } };

function conversationDto(c: InstanceType<typeof Conversation>, me: string) {
  const others = (c.participants as unknown as Populated[]).filter((p) => String(p._id) !== me);
  const other = others[0];
  return {
    id: String(c._id),
    other: other
      ? {
          id: String(other._id),
          name: other.name,
          app: other.app,
          role: other.app === 'seeker' ? other.role : other.accountType,
          headline: other.headline ?? '',
          company: other.company?.name ?? '',
        }
      : null,
    context: c.context,
    lastMessage: c.lastMessage,
    lastAt: c.lastAt,
    unread: c.unread?.get(me) ?? 0,
  };
}

const populateParticipants = { path: 'participants', select: 'name app role accountType headline company', populate: { path: 'company', select: 'name' } };

router.get(
  '/chats',
  asyncHandler(async (req, res) => {
    const items = await Conversation.find({ participants: req.user!.id }).sort({ lastAt: -1 }).populate(populateParticipants);
    res.json({ success: true, data: items.map((c) => conversationDto(c, req.user!.id)) });
  }),
);

/** Finds or creates the 1:1 conversation with another user. */
router.post(
  '/chats/start',
  validate(z.object({ userId: z.string().min(1), context: z.string().trim().default('') })),
  asyncHandler(async (req, res) => {
    if (req.body.userId === req.user!.id) throw new ApiError(400, 'You can’t message yourself.');
    const other = await User.findById(req.body.userId).select('_id');
    if (!other) throw new ApiError(404, 'User not found.');
    let c = await Conversation.findOne({ participants: { $all: [req.user!.id, other._id], $size: 2 } });
    if (!c) c = await Conversation.create({ participants: [req.user!.id, other._id], context: req.body.context, lastMessage: '' });
    await c.populate(populateParticipants);
    res.json({ success: true, data: conversationDto(c, req.user!.id) });
  }),
);

/** People you can start a chat with: everyone you've done business with. */
router.get(
  '/chats/contacts',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    let ids: string[] = [];
    if (me.app === 'seeker') {
      const [apps, props] = await Promise.all([
        Application.find({ applicant: me.id }).populate('job', 'postedBy'),
        Proposal.find({ freelancer: me.id }).select('client'),
      ]);
      ids = [
        ...apps.map((a) => String((a.job as unknown as { postedBy?: Types.ObjectId })?.postedBy ?? '')),
        ...props.map((p) => String(p.client)),
      ];
    } else {
      const [apps, props] = await Promise.all([
        Application.find({ company: me.company }).select('applicant'),
        Proposal.find({ client: me.id }).select('freelancer'),
      ]);
      ids = [...apps.map((a) => String(a.applicant)), ...props.map((p) => String(p.freelancer))];
    }
    const unique = [...new Set(ids.filter(Boolean))];
    const users = await User.find({ _id: { $in: unique } }).populate('company', 'name');
    res.json({
      success: true,
      data: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        app: u.app,
        role: u.app === 'seeker' ? u.role : u.accountType,
        headline: u.headline,
        company: (u.company as unknown as { name?: string })?.name ?? '',
      })),
    });
  }),
);

async function myConversation(id: string, me: string) {
  const c = await Conversation.findOne({ _id: id, participants: me });
  if (!c) throw new ApiError(404, 'Conversation not found.');
  return c;
}

router.get(
  '/chats/:id/messages',
  asyncHandler(async (req, res) => {
    const c = await myConversation(String(req.params.id), req.user!.id);
    const messages = await Message.find({ conversation: c._id }).sort({ createdAt: 1 }).limit(500);
    c.unread.set(req.user!.id, 0);
    await c.save();
    await c.populate(populateParticipants);
    res.json({
      success: true,
      data: {
        conversation: conversationDto(c, req.user!.id),
        messages: messages.map((m) => ({ id: String(m._id), text: m.text, isMe: String(m.sender) === req.user!.id, createdAt: m.createdAt })),
      },
    });
  }),
);

router.post(
  '/chats/:id/messages',
  validate(z.object({ text: z.string().trim().min(1, 'Message is empty').max(4000) })),
  asyncHandler(async (req, res) => {
    const c = await myConversation(String(req.params.id), req.user!.id);
    const m = await Message.create({ conversation: c._id, sender: req.user!.id, text: req.body.text });
    c.lastMessage = req.body.text;
    c.lastAt = new Date();
    for (const p of c.participants) {
      const pid = String(p);
      if (pid !== req.user!.id) {
        c.unread.set(pid, (c.unread.get(pid) ?? 0) + 1);
        await notify(pid, 'message', 'New Message', `${req.user!.name}: ${req.body.text.slice(0, 80)}`, c._id);
      }
    }
    await c.save();
    res.status(201).json({ success: true, data: { id: String(m._id), text: m.text, isMe: true, createdAt: m.createdAt } });
  }),
);

router.post(
  '/chats/read-all',
  asyncHandler(async (req, res) => {
    await Conversation.updateMany({ participants: req.user!.id }, { $set: { [`unread.${req.user!.id}`]: 0 } });
    res.json({ success: true, message: 'All conversations marked as read' });
  }),
);

// ── Notifications ──────────────────────────────────────────────────────

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const [items, unread] = await Promise.all([
      Notification.find({ user: req.user!.id }).sort({ createdAt: -1 }).limit(100),
      Notification.countDocuments({ user: req.user!.id, isRead: false }),
    ]);
    res.json({ success: true, data: { items: items.map((n) => n.toJSON()), unread } });
  }),
);

router.patch(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ user: req.user!.id, isRead: false }, { isRead: true });
    res.json({ success: true, message: 'All notifications marked as read' });
  }),
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await Notification.updateOne({ _id: req.params.id, user: req.user!.id }, { isRead: true });
    res.json({ success: true });
  }),
);

// ── Saved items ────────────────────────────────────────────────────────

router.get(
  '/saved',
  asyncHandler(async (req, res) => {
    const kind = String(req.query.kind ?? 'job');
    if (!SAVED_KINDS.includes(kind as (typeof SAVED_KINDS)[number])) throw new ApiError(400, 'Unknown kind');
    const refs = (await Saved.find({ user: req.user!.id, kind }).sort({ createdAt: -1 })).map((s) => s.ref);
    let items: unknown[] = [];
    if (kind === 'job') {
      const jobs = await Job.find({ _id: { $in: refs } }).populate('company');
      items = jobs.map((j) => dto.job(j, { isSaved: true }));
    } else if (kind === 'project') {
      const projects = await Project.find({ _id: { $in: refs } }).populate({ path: 'client', populate: { path: 'company' } });
      items = projects.map((p) => dto.project(p, { isSaved: true }));
    } else {
      items = (await User.find({ _id: { $in: refs }, app: 'seeker' })).map((u) => dto.talent(u));
    }
    res.json({ success: true, data: items });
  }),
);

router.post(
  '/saved/toggle',
  validate(z.object({ kind: z.enum(SAVED_KINDS), ref: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const key = { user: req.user!.id, kind: req.body.kind, ref: req.body.ref };
    const existing = await Saved.findOne(key);
    if (existing) await existing.deleteOne();
    else await Saved.create(key);
    res.json({ success: true, data: { saved: !existing } });
  }),
);

// ── Reviews ────────────────────────────────────────────────────────────

router.get(
  '/reviews/me',
  asyncHandler(async (req, res) => {
    const items = await Review.find({ reviewee: req.user!.id })
      .sort({ createdAt: -1 })
      .populate({ path: 'reviewer', select: 'name company', populate: { path: 'company', select: 'name' } });
    const count = items.length;
    const average = count ? Math.round((items.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
    const breakdown = [5, 4, 3, 2, 1].map((star) => ({ star, count: items.filter((r) => Math.round(r.rating) === star).length }));
    res.json({
      success: true,
      data: {
        average,
        count,
        breakdown,
        items: items.map((r) => {
          const reviewer = r.reviewer as unknown as { name: string; company?: { name?: string } };
          return {
            id: String(r._id),
            name: reviewer?.company?.name || reviewer?.name || 'User',
            rating: r.rating,
            comment: r.comment,
            context: r.context,
            createdAt: r.createdAt,
          };
        }),
      },
    });
  }),
);

export default router;
