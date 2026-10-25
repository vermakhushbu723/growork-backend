import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { Call } from '../models/Call.js';
import { User } from '../models/User.js';
import { notify } from '../services/core.js';
import { sendPush } from '../services/push.js';
import { emitTo } from '../services/realtime.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const router = Router();
router.use(['/calls', '/devices'], requireAuth);

/** How long an unanswered call rings before it counts as missed. */
const RING_MS = 45_000;

const livekitReady = () => !!(env.livekitUrl && env.livekitApiKey && env.livekitApiSecret);

async function joinToken(room: string, user: { id: string; name: string }) {
  const at = new AccessToken(env.livekitApiKey, env.livekitApiSecret, { identity: user.id, name: user.name, ttl: '2h' });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

type Party = { _id: unknown; name: string; avatarUrl?: string; company?: { name?: string } };
const party = (u: Party) => ({ id: String(u._id), name: u.company?.name || u.name, avatarUrl: u.avatarUrl ?? '' });

async function callDto(c: InstanceType<typeof Call>, me: string) {
  await c.populate([
    { path: 'caller', select: 'name avatarUrl company', populate: { path: 'company', select: 'name' } },
    { path: 'callee', select: 'name avatarUrl company', populate: { path: 'company', select: 'name' } },
  ]);
  const caller = c.caller as unknown as Party;
  const callee = c.callee as unknown as Party;
  const outgoing = String(caller._id) === me;
  return {
    id: String(c._id),
    room: c.room,
    video: c.video,
    status: c.status,
    outgoing,
    caller: party(caller),
    callee: party(callee),
    other: party(outgoing ? callee : caller),
    createdAt: c.createdAt,
    answeredAt: c.answeredAt ?? null,
    endedAt: c.endedAt ?? null,
  };
}

/** Ids of both sides, whether or not the call has been populated. */
const sides = (c: InstanceType<typeof Call>) => {
  const idOf = (v: unknown) => String((v as { _id?: unknown })?._id ?? v);
  return { caller: idOf(c.caller), callee: idOf(c.callee) };
};

async function myCall(id: string, me: string) {
  const c = await Call.findOne({ _id: id, $or: [{ caller: me }, { callee: me }] });
  if (!c) throw new ApiError(404, 'Call not found.');
  return c;
}

/** A call still ringing after RING_MS is closed as missed. */
async function expireIfStale(c: InstanceType<typeof Call>) {
  if (c.status === 'ringing' && Date.now() - c.createdAt.getTime() > RING_MS) {
    c.status = 'missed';
    c.endedAt = new Date();
    await c.save();
  }
}

async function displayName(userId: string) {
  const u = await User.findById(userId).select('name company').populate('company', 'name');
  return (u?.company as unknown as { name?: string })?.name || u?.name || 'Someone';
}

/** Start a call: `{ userId, video }` → the call + a LiveKit token for the caller. */
router.post(
  '/calls',
  validate(z.object({ userId: z.string().min(1), video: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    if (!livekitReady()) throw new ApiError(503, 'Calling isn’t set up yet. Please try again later.');
    const me = req.user!;
    if (req.body.userId === me.id) throw new ApiError(400, 'You can’t call yourself.');
    const callee = await User.findById(req.body.userId).select('_id');
    if (!callee) throw new ApiError(404, 'User not found.');

    const call = new Call({ caller: me.id, callee: callee._id, video: req.body.video, room: 'pending' });
    call.room = `call-${call._id}`;
    await call.save();

    const forCallee = await callDto(call, String(callee._id));
    emitTo(callee._id, 'call:incoming', forCallee);
    void sendPush(callee._id, {
      call: true,
      title: `Incoming ${call.video ? 'video' : 'voice'} call`,
      body: forCallee.other.name,
      data: { type: 'call', callId: String(call._id), video: String(call.video), callerName: forCallee.other.name },
    });
    // Close it as missed if nobody answers.
    setTimeout(() => void ringTimeout(String(call._id)).catch(() => undefined), RING_MS + 1000).unref();

    res.status(201).json({
      success: true,
      data: { call: await callDto(call, me.id), token: await joinToken(call.room, me), url: env.livekitUrl },
    });
  }),
);

async function ringTimeout(id: string) {
  const c = await Call.findById(id);
  if (!c || c.status !== 'ringing') return;
  c.status = 'missed';
  c.endedAt = new Date();
  await c.save();
  emitTo(c.caller, 'call:ended', { id, status: 'missed' });
  emitTo(c.callee, 'call:ended', { id, status: 'missed' });
  const name = await displayName(String(c.caller));
  await notify(c.callee, 'call', 'Missed call', `You missed a ${c.video ? 'video' : 'voice'} call from ${name}.`, c._id);
}

router.get(
  '/calls',
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const items = await Call.find({ $or: [{ caller: me }, { callee: me }] }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data: await Promise.all(items.map((c) => callDto(c, me))) });
  }),
);

router.get(
  '/calls/:id',
  asyncHandler(async (req, res) => {
    const c = await myCall(String(req.params.id), req.user!.id);
    await expireIfStale(c);
    res.json({ success: true, data: await callDto(c, req.user!.id) });
  }),
);

/** Callee picks up → token to join the room. */
router.post(
  '/calls/:id/accept',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const c = await myCall(String(req.params.id), me.id);
    await expireIfStale(c);
    const { caller, callee } = sides(c);
    if (callee !== me.id) throw new ApiError(403, 'Only the person being called can answer.');
    if (c.status !== 'ringing') throw new ApiError(409, c.status === 'accepted' ? 'Call already answered.' : 'This call has ended.');
    if (!livekitReady()) throw new ApiError(503, 'Calling isn’t set up yet.');
    c.status = 'accepted';
    c.answeredAt = new Date();
    await c.save();
    emitTo(caller, 'call:accepted', { id: String(c._id) });
    // Stops ringing on the callee's other devices.
    emitTo(callee, 'call:answered', { id: String(c._id) });
    res.json({ success: true, data: { call: await callDto(c, me.id), token: await joinToken(c.room, me), url: env.livekitUrl } });
  }),
);

router.post(
  '/calls/:id/decline',
  asyncHandler(async (req, res) => {
    const me = req.user!.id;
    const c = await myCall(String(req.params.id), me);
    const { caller, callee } = sides(c);
    if (callee !== me) throw new ApiError(403, 'Only the person being called can decline.');
    if (c.status === 'ringing') {
      c.status = 'declined';
      c.endedAt = new Date();
      await c.save();
      emitTo(caller, 'call:declined', { id: String(c._id) });
      emitTo(callee, 'call:ended', { id: String(c._id), status: 'declined' });
    }
    res.json({ success: true, data: await callDto(c, me) });
  }),
);

/** Hang up (either side). Cancelling a ringing call leaves a missed-call notification. */
router.post(
  '/calls/:id/end',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const c = await myCall(String(req.params.id), me.id);
    const { caller, callee } = sides(c);
    if (c.status === 'ringing' || c.status === 'accepted') {
      const wasRinging = c.status === 'ringing';
      c.status = wasRinging ? 'cancelled' : 'ended';
      c.endedAt = new Date();
      await c.save();
      emitTo(caller, 'call:ended', { id: String(c._id), status: c.status });
      emitTo(callee, 'call:ended', { id: String(c._id), status: c.status });
      if (wasRinging && caller === me.id) {
        await notify(callee, 'call', 'Missed call', `You missed a ${c.video ? 'video' : 'voice'} call from ${await displayName(me.id)}.`, c._id);
      }
    }
    res.json({ success: true, data: await callDto(c, me.id) });
  }),
);

// ── Push devices ───────────────────────────────────────────────────────

/** Registers this phone's FCM token for the signed-in account. */
router.post(
  '/devices',
  validate(z.object({ token: z.string().trim().min(10).max(4096), platform: z.string().trim().default('android') })),
  asyncHandler(async (req, res) => {
    // A token belongs to one account at a time (the last one signed in on that phone).
    await User.updateMany({ fcmTokens: req.body.token, _id: { $ne: req.user!.id } }, { $pull: { fcmTokens: req.body.token } });
    await User.updateOne({ _id: req.user!.id }, { $addToSet: { fcmTokens: req.body.token } });
    // Keep the 10 most recent devices.
    const u = await User.findById(req.user!.id).select('+fcmTokens');
    if (u && u.fcmTokens.length > 10) {
      u.fcmTokens = u.fcmTokens.slice(-10);
      await u.save();
    }
    res.json({ success: true });
  }),
);

/** Called on logout so the phone stops getting this account's pushes. */
router.post(
  '/devices/remove',
  validate(z.object({ token: z.string().trim().min(10) })),
  asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.user!.id }, { $pull: { fcmTokens: req.body.token } });
    res.json({ success: true });
  }),
);

export default router;
