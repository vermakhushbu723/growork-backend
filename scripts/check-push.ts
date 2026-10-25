/**
 * Checks push setup: the Firebase key works, and which accounts have phones
 * registered. `npx tsx scripts/check-push.ts <email>` also sends that account
 * a test notification.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { sendPush } from '../src/services/push.js';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const app = initializeApp({ credential: cert(JSON.parse(raw.startsWith('{') ? raw : readFileSync(raw, 'utf8'))) }, 'check');
try {
  // A dry run to a fake token: "invalid token" means the key itself is accepted.
  await getMessaging(app).send({ token: 'not-a-real-token', notification: { title: 't' } }, true);
} catch (e) {
  const code = (e as { code?: string }).code ?? '';
  console.log(/credential|auth|permission/i.test(code) ? `Firebase key REJECTED: ${code}` : `Firebase key OK (${code})`);
}
await connectDB();
const users = await User.find({ fcmTokens: { $exists: true, $ne: [] } }).select('+fcmTokens email app');
for (const u of users) console.log(`registered: ${u.email} (${u.app}) devices=${u.fcmTokens.length}`);
if (!users.length) console.log('No phone has registered for push yet.');
const email = process.argv[2];
if (email) {
  const u = await User.findOne({ email });
  if (u) {
    await sendPush(u._id, { title: 'Subkamyaab test', body: 'Push notifications are working 🎉', data: { type: 'jobMatch' } });
    console.log(`Test push sent to ${email}`);
  }
}
await disconnectDB();
