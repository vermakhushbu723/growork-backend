/**
 * Live call check against a real phone:
 *   npx tsx scripts/call-test.ts <caller email> <callee email> [voice]
 * Logs in as the caller, rings the callee, waits up to 45 s for them to
 * answer on the phone, then shows who is in the LiveKit room and hangs up.
 */
import 'dotenv/config';
import { RoomServiceClient } from 'livekit-server-sdk';

const BASE = process.env.API_URL ?? 'https://api.subkamyaab.achivora.com/api/v1';
const [callerEmail, calleeEmail, mode] = process.argv.slice(2);

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { data?: any; message?: string };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.message}`);
  return json.data;
}

const login = (email: string, app: string) => api('POST', '/auth/login', { app, email, password: 'Demo@123' });
const caller = await login(callerEmail, 'recruiter').catch(() => login(callerEmail, 'seeker'));
const callee = await login(calleeEmail, 'seeker').catch(() => login(calleeEmail, 'recruiter'));

const start = await api('POST', '/calls', { userId: callee.user.id, video: mode !== 'voice' }, caller.token);
const id = start.call.id;
console.log(`Ringing ${calleeEmail} (call ${id})… answer on the phone`);

let status = 'ringing';
for (let i = 0; i < 45 && status === 'ringing'; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  status = (await api('GET', `/calls/${id}`, undefined, caller.token)).status;
}
console.log(`Call status: ${status}`);

if (status === 'accepted') {
  const svc = new RoomServiceClient(
    (process.env.LIVEKIT_URL ?? '').replace(/^wss:/, 'https:'),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const people = await svc.listParticipants(start.call.room).catch(() => []);
    if (people.length) {
      for (const p of people) {
        console.log(`In room: ${p.name} — tracks: ${p.tracks.map((t) => `${t.source === 1 ? 'camera' : t.source === 2 ? 'mic' : t.source}${t.muted ? '(muted)' : ''}`).join(', ') || 'none'}`);
      }
      break;
    }
  }
  await new Promise((r) => setTimeout(r, Number(process.env.HOLD_MS ?? 4000)));
}
await api('POST', `/calls/${id}/end`, {}, caller.token);
console.log('Call ended from the caller side.');
