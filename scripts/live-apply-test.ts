/**
 * Live "new applicant" check on a real recruiter phone:
 *   npx tsx scripts/live-apply-test.ts apply <company name>   → a temporary
 *       candidate applies to that company's newest active job
 *   npx tsx scripts/live-apply-test.ts cleanup               → removes the
 *       application, the candidate and the notification it caused
 */
import 'dotenv/config';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Notification } from '../src/models/Misc.js';

const BASE = process.env.API_URL ?? 'https://api.subkamyaab.achivora.com/api/v1';
const STATE = '.live-apply-test.json';
const [step, company] = process.argv.slice(2);

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

if (step === 'apply') {
  const jobs = (await api('GET', '/jobs?limit=100')).items as any[];
  const job = jobs.find((j) => j.company?.name === company);
  if (!job) throw new Error(`No active job from ${company}`);
  const email = `live.test.${Date.now()}@example.com`;
  const reg = await api('POST', '/auth/register', { app: 'seeker', name: 'Live Test Candidate', email, password: 'secret12' });
  await api('PATCH', '/auth/me', { headline: 'Test applicant (auto-deleted)', location: 'Noida', skills: ['Flutter', 'Dart'] }, reg.token);
  const a = await api('POST', `/jobs/${job.id}/apply`, { resumeName: 'Test.pdf', coverLetter: 'Automated live-update test application — will be deleted in a minute.' }, reg.token);
  writeFileSync(STATE, JSON.stringify({ token: reg.token, applicationId: a.id }));
  console.log(`Applied to "${job.title}" (${company}) as ${email}`);
} else if (step === 'cleanup') {
  const s = JSON.parse(readFileSync(STATE, 'utf8')) as { token: string; applicationId: string };
  await api('DELETE', `/applications/${s.applicationId}`, undefined, s.token).catch((e) => console.log(e.message));
  await api('DELETE', '/auth/me', undefined, s.token);
  await connectDB();
  const r = await Notification.deleteMany({ ref: s.applicationId });
  await disconnectDB();
  rmSync(STATE);
  console.log(`Cleaned up: application, test account, ${r.deletedCount} notification(s)`);
}
