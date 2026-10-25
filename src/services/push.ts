import { existsSync, readFileSync } from 'node:fs';
import type { App } from 'firebase-admin/app';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

/**
 * Push notifications through Firebase Cloud Messaging. Does nothing until
 * FIREBASE_SERVICE_ACCOUNT is set, so the API runs fine without Firebase.
 */
let app: App | null | undefined;

async function firebase() {
  if (app !== undefined) return app;
  const raw = env.firebaseServiceAccount.trim();
  if (!raw) return (app = null);
  try {
    const json = raw.startsWith('{') ? raw : existsSync(raw) ? readFileSync(raw, 'utf8') : '';
    if (!json) throw new Error(`file not found: ${raw}`);
    const { initializeApp, cert } = await import('firebase-admin/app');
    app = initializeApp({ credential: cert(JSON.parse(json)) }, 'push');
  } catch (err) {
    console.error('Push disabled - bad FIREBASE_SERVICE_ACCOUNT:', (err as Error).message);
    app = null;
  }
  return app;
}

export const pushEnabled = async () => !!(await firebase());

export interface PushMessage {
  title: string;
  body: string;
  /** String key/values the app reads when the notification is tapped. */
  data?: Record<string, string>;
  /** Incoming call: data-only, high priority, so the app can ring. */
  call?: boolean;
}

/** Sends to all of the user's devices; drops tokens FCM says are dead. */
export async function sendPush(userId: unknown, msg: PushMessage) {
  const fb = await firebase();
  if (!fb) return;
  const user = await User.findById(userId).select('+fcmTokens settings.pushNotifications');
  const tokens = user?.fcmTokens ?? [];
  if (!tokens.length || (!msg.call && user?.settings?.pushNotifications === false)) return;
  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const data = { ...(msg.data ?? {}), title: msg.title, body: msg.body };
    const res = await getMessaging(fb).sendEachForMulticast(
      msg.call
        ? { tokens, data, android: { priority: 'high', ttl: 45_000 }, apns: { headers: { 'apns-priority': '10' } } }
        : {
            tokens,
            data,
            notification: { title: msg.title, body: msg.body },
            android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
          },
    );
    const dead = res.responses
      .map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code ?? '') ? tokens[i] : null))
      .filter((t): t is string => !!t);
    if (dead.length) await User.updateOne({ _id: userId }, { $pull: { fcmTokens: { $in: dead } } });
  } catch (err) {
    console.error('Push failed:', (err as Error).message);
  }
}
