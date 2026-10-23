/**
 * End-to-end check of every API endpoint, against a running server.
 *   npm run dev        (terminal 1)
 *   npm run test:api   (terminal 2)
 * Creates temporary accounts, walks the user-app and recruiter-app flows,
 * then deletes everything it created so only the seed data remains.
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Application } from '../src/models/Application.js';
import { Conversation, Message } from '../src/models/Chat.js';
import { Company } from '../src/models/Company.js';
import { Contract } from '../src/models/Contract.js';
import { Interview } from '../src/models/Interview.js';
import { Job } from '../src/models/Job.js';
import { Notification, Otp, Review, Saved } from '../src/models/Misc.js';
import { Project } from '../src/models/Project.js';
import { Proposal } from '../src/models/Proposal.js';
import { User } from '../src/models/User.js';
import { Transaction, Wallet } from '../src/models/Wallet.js';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 5080}/api/v1`;
let passed = 0;
let failed = 0;
const failures: string[] = [];

type Json = { success?: boolean; data?: any; message?: string };

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, json, data: json.data };
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m — ${(e as Error).message}`);
  }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ok = (r: { status: number; json: Json }, status = 200) =>
  expect(r.status === status, `expected ${status}, got ${r.status}: ${r.json.message ?? JSON.stringify(r.json).slice(0, 160)}`);

async function main() {
  console.log(`Testing ${BASE}\n`);
  const stamp = Date.now();
  const seekerEmail = `test.seeker.${stamp}@example.com`;
  const recruiterEmail = `test.recruiter.${stamp}@example.com`;
  const phone = `+91 9${String(stamp).slice(-4)}0 ${String(stamp).slice(-9, -4)}`;
  let seeker = '';
  let recruiter = '';
  let seekerId = '';
  const ids: Record<string, string> = {};

  console.log('Health');
  await check('GET /health → db connected', async () => {
    const r = await call('GET', '/health');
    ok(r);
    expect(r.json && (r.json as any).db === 'connected', 'db not connected');
  });

  console.log('\nAuth (both apps)');
  await check('POST /auth/register (user app)', async () => {
    const r = await call('POST', '/auth/register', { app: 'seeker', name: 'Test Seeker', email: seekerEmail, password: 'secret12', phone });
    ok(r, 201);
    seeker = r.data.token;
    seekerId = r.data.user.id;
    expect(r.data.user.app === 'seeker' && !r.data.user.passwordHash, 'bad user payload');
  });
  await check('POST /auth/register (recruiter app, creates company)', async () => {
    const r = await call('POST', '/auth/register', { app: 'recruiter', name: 'Test Recruiter', email: recruiterEmail, password: 'secret12', company: 'Test Co' });
    ok(r, 201);
    recruiter = r.data.token;
    expect(r.data.user.company?.name === 'Test Co', 'company missing');
  });
  await check('POST /auth/register duplicate email → 409', async () => {
    ok(await call('POST', '/auth/register', { app: 'seeker', name: 'Dup', email: seekerEmail, password: 'secret12' }), 409);
  });
  await check('POST /auth/register invalid email → 400', async () => {
    ok(await call('POST', '/auth/register', { app: 'seeker', name: 'Bad', email: 'nope', password: 'secret12' }), 400);
  });
  await check('POST /auth/login', async () => {
    const r = await call('POST', '/auth/login', { app: 'seeker', email: seekerEmail, password: 'secret12' });
    ok(r);
    expect(r.data.token, 'no token');
  });
  await check('POST /auth/login wrong password → 401', async () => {
    ok(await call('POST', '/auth/login', { app: 'seeker', email: seekerEmail, password: 'wrong123' }), 401);
  });
  await check('POST /auth/login in the other app → 403', async () => {
    ok(await call('POST', '/auth/login', { app: 'recruiter', email: seekerEmail, password: 'secret12' }), 403);
  });
  await check('GET /auth/me without token → 401', async () => ok(await call('GET', '/auth/me'), 401));
  await check('GET /auth/me', async () => {
    const r = await call('GET', '/auth/me', undefined, seeker);
    ok(r);
    expect(r.data.email === seekerEmail, 'wrong user');
  });
  await check('PATCH /auth/me (role, headline, skills)', async () => {
    const r = await call('PATCH', '/auth/me', { role: 'freelancer', headline: 'Flutter Dev', skills: ['Flutter', 'Dart'], location: 'Noida', hourlyRate: 700 }, seeker);
    ok(r);
    expect(r.data.role === 'freelancer' && r.data.skills.length === 2, 'not updated');
  });
  await check('PATCH /auth/me (recruiter account type & designation)', async () => {
    const r = await call('PATCH', '/auth/me', { accountType: 'both', designation: 'Founder' }, recruiter);
    ok(r);
    expect(r.data.designation === 'Founder', 'not updated');
  });
  let otp = '';
  await check('POST /auth/otp/send (login by phone)', async () => {
    const r = await call('POST', '/auth/otp/send', { target: phone, purpose: 'login' });
    ok(r);
    otp = r.data.devOtp;
    expect(/^\d{4}$/.test(otp), 'no dev OTP');
  });
  await check('POST /auth/otp/verify wrong code → 400', async () => {
    ok(await call('POST', '/auth/otp/verify', { target: phone, purpose: 'login', code: otp === '0000' ? '1111' : '0000' }), 400);
  });
  await check('POST /auth/otp/verify (login)', async () => {
    const r = await call('POST', '/auth/otp/verify', { target: phone, purpose: 'login', code: otp, app: 'seeker' });
    ok(r);
    expect(r.data.token, 'no token');
  });
  let resetToken = '';
  await check('POST /auth/otp/send + verify (password reset)', async () => {
    const s = await call('POST', '/auth/otp/send', { target: seekerEmail, purpose: 'reset' });
    ok(s);
    const v = await call('POST', '/auth/otp/verify', { target: seekerEmail, purpose: 'reset', code: s.data.devOtp });
    ok(v);
    resetToken = v.data.resetToken;
  });
  await check('POST /auth/reset-password then login with new password', async () => {
    ok(await call('POST', '/auth/reset-password', { resetToken, password: 'newpass12' }));
    ok(await call('POST', '/auth/login', { app: 'seeker', email: seekerEmail, password: 'newpass12' }));
  });
  await check('PATCH /auth/password', async () => {
    ok(await call('PATCH', '/auth/password', { currentPassword: 'newpass12', newPassword: 'secret12' }, seeker));
    ok(await call('PATCH', '/auth/password', { currentPassword: 'wrongone', newPassword: 'secret99' }, seeker), 400);
  });
  await check('POST /auth/otp/send unknown account → 404', async () => {
    ok(await call('POST', '/auth/otp/send', { target: 'nobody@example.com', purpose: 'login' }), 404);
  });

  console.log('\nProfile & settings (user app)');
  await check('POST /profile/documents', async () => {
    const r = await call('POST', '/profile/documents', { name: 'Test_Resume.pdf', kind: 'Resume / CV', size: '200 KB' }, seeker);
    ok(r, 201);
    ids.doc = r.data.documents[0].id;
  });
  await check('PATCH /profile/documents/:id/primary', async () => {
    const r = await call('PATCH', `/profile/documents/${ids.doc}/primary`, {}, seeker);
    ok(r);
    expect(r.data.documents[0].isPrimaryResume, 'not primary');
  });
  await check('POST + DELETE /profile/certificates', async () => {
    const r = await call('POST', '/profile/certificates', { title: 'Dart Basics', issuer: 'Google', date: 'Oct 2026' }, seeker);
    ok(r, 201);
    const d = await call('DELETE', `/profile/certificates/${r.data.certificates[0].id}`, undefined, seeker);
    ok(d);
    expect(d.data.certificates.length === 0, 'not removed');
  });
  await check('POST + DELETE /profile/portfolio', async () => {
    const r = await call('POST', '/profile/portfolio', { title: 'Test App', category: 'Mobile', tags: ['Flutter'] }, seeker);
    ok(r, 201);
    ok(await call('DELETE', `/profile/portfolio/${r.data.portfolio[0].id}`, undefined, seeker));
  });
  await check('DELETE /profile/documents/:id unknown → 404', async () => {
    ok(await call('DELETE', '/profile/documents/64b000000000000000000000', undefined, seeker), 404);
  });
  await check('GET + PATCH /settings', async () => {
    ok(await call('GET', '/settings', undefined, seeker));
    const r = await call('PATCH', '/settings', { language: 'Hindi', jobAlerts: false }, seeker);
    ok(r);
    expect(r.data.language === 'Hindi' && r.data.jobAlerts === false, 'not saved');
  });
  await check('GET /profile/stats', async () => {
    const r = await call('GET', '/profile/stats', undefined, seeker);
    ok(r);
    expect(typeof r.data.applied === 'number', 'bad stats');
  });

  console.log('\nCompany & team (recruiter app)');
  await check('GET + PATCH /company (GSTIN + website verifies)', async () => {
    ok(await call('GET', '/company', undefined, recruiter));
    const r = await call('PATCH', '/company', { industry: 'Fintech', website: 'test.co', gstin: '09AAAAA0000A1Z5', about: 'We test things.' }, recruiter);
    ok(r);
    expect(r.data.isVerified, 'not verified');
  });
  await check('POST / PATCH / DELETE /company/members', async () => {
    const a = await call('POST', '/company/members', { email: 'mate@example.com', role: 'Recruiter' }, recruiter);
    ok(a, 201);
    const m = a.data.members.find((x: any) => x.email === 'mate@example.com');
    ok(await call('POST', '/company/members', { email: 'mate@example.com', role: 'Viewer' }, recruiter), 409);
    ok(await call('PATCH', `/company/members/${m.id}`, { role: 'Viewer' }, recruiter));
    ok(await call('DELETE', `/company/members/${m.id}`, undefined, recruiter));
  });
  await check('Recruiter routes reject user-app tokens → 403', async () => {
    ok(await call('GET', '/recruiter/jobs', undefined, seeker), 403);
  });

  console.log('\nJob posts (recruiter app)');
  await check('POST /recruiter/jobs (publishing uses a credit)', async () => {
    const before = (await call('GET', '/wallet', undefined, recruiter)).data.jobCredits;
    const r = await call(
      'POST',
      '/recruiter/jobs',
      { title: 'Test Flutter Engineer', category: 'Engineering', type: 'Full-time', workMode: 'Remote', location: 'Remote', salaryMin: 6, salaryMax: 10, skills: ['Flutter', 'Dart'], description: 'Test job description long enough.', status: 'active' },
      recruiter,
    );
    ok(r, 201);
    ids.job = r.data.id;
    const after = (await call('GET', '/wallet', undefined, recruiter)).data.jobCredits;
    expect(after === before - 1, `credits ${before} → ${after}`);
  });
  await check('POST /recruiter/jobs salaryMax < salaryMin → 400', async () => {
    ok(await call('POST', '/recruiter/jobs', { title: 'Bad', type: 'Full-time', workMode: 'Remote', salaryMin: 9, salaryMax: 2 }, recruiter), 400);
  });
  await check('GET /recruiter/jobs', async () => {
    const r = await call('GET', '/recruiter/jobs', undefined, recruiter);
    ok(r);
    expect(r.data.some((j: any) => j.id === ids.job), 'job missing');
  });
  await check('PATCH /recruiter/jobs/:id', async () => {
    const r = await call('PATCH', `/recruiter/jobs/${ids.job}`, { isUrgent: true, openings: 3 }, recruiter);
    ok(r);
    expect(r.data.isUrgent && r.data.openings === 3, 'not updated');
  });
  await check('PATCH /recruiter/jobs/:id/status (pause, re-open)', async () => {
    ok(await call('PATCH', `/recruiter/jobs/${ids.job}/status`, { status: 'paused' }, recruiter));
    const r = await call('PATCH', `/recruiter/jobs/${ids.job}/status`, { status: 'active' }, recruiter);
    ok(r);
    expect(r.data.status === 'active', 'not active');
  });
  await check('POST /recruiter/jobs/:id/duplicate → draft, then DELETE', async () => {
    const r = await call('POST', `/recruiter/jobs/${ids.job}/duplicate`, {}, recruiter);
    ok(r, 201);
    expect(r.data.status === 'draft', 'not draft');
    ok(await call('DELETE', `/recruiter/jobs/${r.data.id}`, undefined, recruiter));
  });

  console.log('\nJobs & applications (user app)');
  await check('GET /jobs (public, filter, search)', async () => {
    const all = await call('GET', '/jobs');
    ok(all);
    expect(all.data.items.length >= 1 && all.data.total >= 1, 'no jobs');
    const remote = await call('GET', '/jobs?mode=Remote&q=Test%20Flutter', undefined, seeker);
    ok(remote);
    expect(remote.data.items.some((j: any) => j.id === ids.job), 'search miss');
  });
  await check('GET /jobs/:id (views++, match score)', async () => {
    const r = await call('GET', `/jobs/${ids.job}`, undefined, seeker);
    ok(r);
    expect(r.data.hasApplied === false && r.data.matchScore === 100 && r.data.company?.name === 'Test Co', 'bad detail');
  });
  await check('POST /jobs/:id/apply', async () => {
    const r = await call('POST', `/jobs/${ids.job}/apply`, { resumeName: 'Test_Resume.pdf', coverLetter: 'I am a great fit for this role because I build Flutter apps.', noticePeriod: '15 days' }, seeker);
    ok(r, 201);
    ids.application = r.data.id;
  });
  await check('POST /jobs/:id/apply twice → 409', async () => {
    ok(await call('POST', `/jobs/${ids.job}/apply`, { resumeName: 'x.pdf', coverLetter: 'Applying a second time should fail here.' }, seeker), 409);
  });
  await check('POST /jobs/:id/apply short cover letter → 400', async () => {
    ok(await call('POST', `/jobs/${ids.job}/apply`, { resumeName: 'x.pdf', coverLetter: 'too short' }, seeker), 400);
  });
  await check('GET /applications/mine', async () => {
    const r = await call('GET', '/applications/mine', undefined, seeker);
    ok(r);
    expect(r.data[0]?.job?.title === 'Test Flutter Engineer', 'missing');
  });
  await check('POST /saved/toggle + GET /saved?kind=job', async () => {
    const t = await call('POST', '/saved/toggle', { kind: 'job', ref: ids.job }, seeker);
    ok(t);
    expect(t.data.saved === true, 'not saved');
    const s = await call('GET', '/saved?kind=job', undefined, seeker);
    ok(s);
    expect(s.data.some((j: any) => j.id === ids.job), 'not listed');
  });

  console.log('\nApplicants, interviews & offers (recruiter app)');
  await check('GET /recruiter/applicants (+ filter by job)', async () => {
    const r = await call('GET', `/recruiter/applicants?job=${ids.job}`, undefined, recruiter);
    ok(r);
    expect(r.data.length === 1 && r.data[0].candidate.email === seekerEmail, 'applicant missing');
  });
  await check('GET /recruiter/applicants/:id', async () => ok(await call('GET', `/recruiter/applicants/${ids.application}`, undefined, recruiter)));
  await check('PATCH /recruiter/applicants/:id (shortlist + note) notifies the candidate', async () => {
    const r = await call('PATCH', `/recruiter/applicants/${ids.application}`, { status: 'shortlisted', note: 'Strong Flutter skills' }, recruiter);
    ok(r);
    const n = await call('GET', '/notifications', undefined, seeker);
    expect(n.data.items.some((x: any) => x.type === 'applicationStatus'), 'no notification');
  });
  await check('DELETE /applications/:id after shortlisting → 400', async () => {
    ok(await call('DELETE', `/applications/${ids.application}`, undefined, seeker), 400);
  });
  await check('POST /recruiter/interviews (moves to interview)', async () => {
    const r = await call(
      'POST',
      '/recruiter/interviews',
      { applicationId: ids.application, dateTime: new Date(Date.now() + 86400000).toISOString(), mode: 'video', round: 'Technical Round', interviewer: 'Test Recruiter', link: 'meet.google.com/test' },
      recruiter,
    );
    ok(r, 201);
    ids.interview = r.data.id;
    const a = await call('GET', `/recruiter/applicants/${ids.application}`, undefined, recruiter);
    expect(a.data.status === 'interview', 'status not interview');
  });
  await check('GET /recruiter/interviews + PATCH status', async () => {
    const l = await call('GET', '/recruiter/interviews', undefined, recruiter);
    ok(l);
    expect(l.data.some((i: any) => i.id === ids.interview), 'missing');
    const p = await call('PATCH', `/recruiter/interviews/${ids.interview}`, { status: 'completed' }, recruiter);
    ok(p);
    expect(p.data.status === 'completed', 'not completed');
  });
  await check('POST /recruiter/applicants/:id/offer', async () => {
    const r = await call('POST', `/recruiter/applicants/${ids.application}/offer`, { designation: 'Flutter Engineer', amount: 9, joiningDate: new Date(Date.now() + 30 * 86400000).toISOString() }, recruiter);
    ok(r);
    expect(r.data.status === 'offered' && r.data.note.startsWith('Offer:'), 'no offer');
  });
  await check('GET /recruiter/analytics?period=30', async () => {
    const r = await call('GET', '/recruiter/analytics?period=30', undefined, recruiter);
    ok(r);
    expect(r.data.series.length === 4 && r.data.funnel.length === 5 && r.data.applications >= 1, 'bad analytics');
  });

  console.log('\nTalent search (recruiter app)');
  await check('GET /talent (+ kind, search)', async () => {
    const r = await call('GET', '/talent?kind=freelancer&q=Flutter', undefined, recruiter);
    ok(r);
    expect(r.data.some((t: any) => t.id === seekerId), 'test freelancer missing');
  });
  await check('GET /talent/:id', async () => ok(await call('GET', `/talent/${seekerId}`, undefined, recruiter)));
  await check('POST /talent/:id/invite', async () => {
    ok(await call('POST', `/talent/${seekerId}/invite`, { jobId: ids.job }, recruiter));
    ok(await call('POST', `/talent/${seekerId}/invite`, {}, recruiter), 400);
  });
  await check('Saved talent toggle (kind=talent)', async () => {
    ok(await call('POST', '/saved/toggle', { kind: 'talent', ref: seekerId }, recruiter));
    const r = await call('GET', '/saved?kind=talent', undefined, recruiter);
    expect(r.data.some((t: any) => t.id === seekerId), 'not saved');
  });

  console.log('\nWallet & plans');
  await check('POST /wallet/add-money', async () => {
    const r = await call('POST', '/wallet/add-money', { amount: 50000, method: 'UPI' }, recruiter);
    ok(r);
    expect(r.data.balance >= 50000, 'no balance');
  });
  await check('POST /wallet/withdraw more than balance → 402', async () => {
    ok(await call('POST', '/wallet/withdraw', { amount: 99999999, method: 'Bank' }, recruiter), 402);
  });
  await check('POST /wallet/withdraw', async () => ok(await call('POST', '/wallet/withdraw', { amount: 1000, method: 'Bank' }, recruiter)));
  await check('GET /plans + POST /wallet/plans/buy (add-on)', async () => {
    const p = await call('GET', '/plans', undefined, recruiter);
    ok(p);
    expect(p.data.plans.length === 3, 'plans missing');
    const before = (await call('GET', '/wallet', undefined, recruiter)).data;
    const b = await call('POST', '/wallet/plans/buy', { plan: 'Single post', addOn: true }, recruiter);
    ok(b);
    expect(b.data.jobCredits === before.jobCredits + 1 && b.data.plan === before.plan, 'credits/plan wrong');
  });
  await check('POST /wallet/plans/buy from user app → 403', async () => {
    ok(await call('POST', '/wallet/plans/buy', { plan: 'Growth' }, seeker), 403);
  });

  console.log('\nFreelance: projects, proposals, hiring & contracts');
  await check('POST /client/projects', async () => {
    const r = await call(
      'POST',
      '/client/projects',
      { title: 'Test Mobile App Fixes', category: 'Mobile Development', description: 'Fix a few bugs in our test app.', skills: ['Flutter'], pricing: 'fixed', budgetMin: 10000, budgetMax: 20000 },
      recruiter,
    );
    ok(r, 201);
    ids.project = r.data.id;
  });
  await check('GET /client/projects + PATCH + status', async () => {
    const l = await call('GET', '/client/projects', undefined, recruiter);
    expect(l.data.some((p: any) => p.id === ids.project), 'missing');
    ok(await call('PATCH', `/client/projects/${ids.project}`, { duration: '2–4 weeks' }, recruiter));
    ok(await call('PATCH', `/client/projects/${ids.project}/status`, { status: 'closed' }, recruiter));
    ok(await call('PATCH', `/client/projects/${ids.project}/status`, { status: 'open' }, recruiter));
  });
  await check('GET /projects (public) + GET /projects/:id', async () => {
    const l = await call('GET', '/projects?q=Test%20Mobile', undefined, seeker);
    ok(l);
    expect(l.data.items.some((p: any) => p.id === ids.project), 'not listed');
    const d = await call('GET', `/projects/${ids.project}`, undefined, seeker);
    ok(d);
    expect(d.data.myProposal === null && d.data.client.name === 'Test Co', 'bad detail');
  });
  await check('POST /projects/:id/proposals (+ duplicate → 409)', async () => {
    const body = { pricing: 'fixed', amount: 15000, deliveryDays: 10, coverLetter: 'I have fixed bugs in many Flutter apps and can start today with a clear plan.' };
    const r = await call('POST', `/projects/${ids.project}/proposals`, body, seeker);
    ok(r, 201);
    ids.proposal = r.data.id;
    ok(await call('POST', `/projects/${ids.project}/proposals`, body, seeker), 409);
  });
  await check('GET /proposals/mine', async () => {
    const r = await call('GET', '/proposals/mine', undefined, seeker);
    expect(r.data.some((p: any) => p.id === ids.proposal), 'missing');
  });
  await check('GET /client/proposals + GET :id marks viewed + PATCH shortlist', async () => {
    const l = await call('GET', `/client/proposals?project=${ids.project}`, undefined, recruiter);
    expect(l.data.length === 1, 'missing');
    const v = await call('GET', `/client/proposals/${ids.proposal}`, undefined, recruiter);
    expect(v.data.status === 'viewed', 'not viewed');
    const s = await call('PATCH', `/client/proposals/${ids.proposal}`, { status: 'shortlisted' }, recruiter);
    expect(s.data.status === 'shortlisted', 'not shortlisted');
  });
  await check('POST /client/proposals/:id/hire (funds milestone 1)', async () => {
    const before = (await call('GET', '/wallet', undefined, recruiter)).data;
    const r = await call(
      'POST',
      `/client/proposals/${ids.proposal}/hire`,
      { milestones: [{ title: 'Bug fixes part 1', amount: 7500 }, { title: 'Bug fixes part 2', amount: 7500 }] },
      recruiter,
    );
    ok(r, 201);
    ids.contract = r.data.id;
    const after = (await call('GET', '/wallet', undefined, recruiter)).data;
    expect(r.data.milestones[0].status === 'funded' && after.balance === before.balance - 7725, `balance ${before.balance} → ${after.balance}`);
    ok(await call('POST', `/client/proposals/${ids.proposal}/hire`, { milestones: [{ title: 'Again', amount: 500 }] }, recruiter), 409);
  });
  await check('GET /contracts (both sides) + GET /contracts/:id', async () => {
    const f = await call('GET', '/contracts', undefined, seeker);
    expect(f.data.some((c: any) => c.id === ids.contract), 'freelancer missing');
    const c = await call('GET', '/contracts', undefined, recruiter);
    expect(c.data.some((x: any) => x.id === ids.contract), 'client missing');
    ok(await call('GET', `/contracts/${ids.contract}`, undefined, seeker));
  });
  await check('Freelancer submits → client requests revision → resubmit', async () => {
    ok(await call('POST', `/contracts/${ids.contract}/milestones/0/submit`, { note: 'Fixed 6 bugs, build attached.' }, seeker));
    ok(await call('POST', `/contracts/${ids.contract}/milestones/0/submit`, { note: 'Submitting twice.' }, seeker), 400);
    ok(await call('POST', `/contracts/${ids.contract}/milestones/0/revision`, { note: 'Login bug still there.' }, recruiter));
    ok(await call('POST', `/contracts/${ids.contract}/milestones/0/submit`, { note: 'Login bug fixed too.' }, seeker));
  });
  await check('Client release → freelancer paid minus 10% fee', async () => {
    const before = (await call('GET', '/wallet', undefined, seeker)).data.balance;
    const r = await call('POST', `/contracts/${ids.contract}/milestones/0/release`, {}, recruiter);
    ok(r);
    expect(r.data.milestones[0].status === 'released', 'not released');
    const after = (await call('GET', '/wallet', undefined, seeker)).data;
    expect(after.balance === before + 6750, `freelancer ${before} → ${after.balance}`);
    expect(after.totalEarnings >= 7500, 'earnings not counted');
  });
  await check('Freelancer cannot release their own milestone → 403', async () => {
    ok(await call('POST', `/contracts/${ids.contract}/milestones/1/release`, {}, seeker), 403);
  });
  await check('POST /contracts/:id/milestones + fund', async () => {
    const r = await call('POST', `/contracts/${ids.contract}/milestones`, { title: 'Extra screen', amount: 2000 }, recruiter);
    ok(r, 201);
    expect(r.data.milestones.length === 3, 'not added');
    const f = await call('POST', `/contracts/${ids.contract}/milestones/1/fund`, {}, recruiter);
    ok(f);
    expect(f.data.milestones[1].status === 'funded', 'not funded');
  });
  await check('POST /contracts/:id/end refunds escrow + creates review', async () => {
    const before = (await call('GET', '/wallet', undefined, recruiter)).data.balance;
    const r = await call('POST', `/contracts/${ids.contract}/end`, { rating: 5, review: 'Fast and careful work, thank you!' }, recruiter);
    ok(r);
    const after = (await call('GET', '/wallet', undefined, recruiter)).data.balance;
    expect(r.data.status === 'completed' && after === before + 7725, `refund ${before} → ${after}`);
    const rv = await call('GET', '/reviews/me', undefined, seeker);
    expect(rv.data.count === 1 && rv.data.average === 5, 'review missing');
  });
  await check('Withdraw a pending proposal (DELETE /proposals/:id)', async () => {
    const p2 = await call('POST', '/client/projects', { title: 'Test Second Project', category: 'Design', pricing: 'fixed', budgetMin: 5000, budgetMax: 8000 }, recruiter);
    ids.project2 = p2.data.id;
    const prop = await call('POST', `/projects/${ids.project2}/proposals`, { pricing: 'fixed', amount: 6000, deliveryDays: 5, coverLetter: 'Happy to design this for you with three concepts and quick revisions.' }, seeker);
    ok(prop, 201);
    ok(await call('DELETE', `/proposals/${prop.data.id}`, undefined, seeker));
  });
  await check('DELETE /client/projects/:id', async () => ok(await call('DELETE', `/client/projects/${ids.project2}`, undefined, recruiter)));

  console.log('\nChat');
  await check('POST /chats/start (idempotent)', async () => {
    const a = await call('POST', '/chats/start', { userId: seekerId, context: 'Test Flutter Engineer' }, recruiter);
    ok(a);
    const b = await call('POST', '/chats/start', { userId: seekerId }, recruiter);
    expect(a.data.id === b.data.id && a.data.other.name === 'Test Seeker', 'not idempotent');
    ids.chat = a.data.id;
  });
  await check('GET /chats/contacts', async () => {
    const r = await call('GET', '/chats/contacts', undefined, recruiter);
    expect(r.data.some((c: any) => c.id === seekerId), 'contact missing');
  });
  await check('POST /chats/:id/messages → unread for the other side', async () => {
    ok(await call('POST', `/chats/${ids.chat}/messages`, { text: 'Hello from the test!' }, recruiter), 201);
    const l = await call('GET', '/chats', undefined, seeker);
    expect(l.data.find((c: any) => c.id === ids.chat)?.unread === 1, 'unread not counted');
  });
  await check('GET /chats/:id/messages clears unread', async () => {
    const r = await call('GET', `/chats/${ids.chat}/messages`, undefined, seeker);
    ok(r);
    expect(r.data.messages.length === 1 && r.data.messages[0].isMe === false, 'bad messages');
    const l = await call('GET', '/chats', undefined, seeker);
    expect(l.data.find((c: any) => c.id === ids.chat)?.unread === 0, 'still unread');
  });
  await check('POST /chats/read-all', async () => ok(await call('POST', '/chats/read-all', {}, recruiter)));
  await check('GET /chats/:id/messages by a stranger → 404', async () => {
    const other = await call('POST', '/auth/login', { app: 'seeker', email: 'rohit@demo.subkamyaab.com', password: 'Demo@123' });
    ok(await call('GET', `/chats/${ids.chat}/messages`, undefined, other.data?.token), 404);
  });

  console.log('\nNotifications & reviews');
  await check('GET /notifications + PATCH :id/read + read-all', async () => {
    const l = await call('GET', '/notifications', undefined, seeker);
    ok(l);
    expect(l.data.unread > 0, 'no unread');
    ok(await call('PATCH', `/notifications/${l.data.items[0].id}/read`, {}, seeker));
    ok(await call('PATCH', '/notifications/read-all', {}, seeker));
    expect((await call('GET', '/notifications', undefined, seeker)).data.unread === 0, 'still unread');
  });
  await check('GET /reviews/me (recruiter, seeded account)', async () => {
    const login = await call('POST', '/auth/login', { app: 'recruiter', email: 'ananya@demo.subkamyaab.com', password: 'Demo@123' });
    ok(login);
    const r = await call('GET', '/reviews/me', undefined, login.data.token);
    ok(r);
    expect(r.data.breakdown.length === 5, 'bad breakdown');
  });

  console.log('\nSeed data is reachable with the demo logins');
  for (const [app, email] of [
    ['seeker', 'khushbu@demo.subkamyaab.com'],
    ['seeker', 'priya@demo.subkamyaab.com'],
    ['recruiter', 'ananya@demo.subkamyaab.com'],
    ['recruiter', 'rahul@demo.subkamyaab.com'],
  ]) {
    await check(`login ${email}`, async () => ok(await call('POST', '/auth/login', { app, email, password: 'Demo@123' })));
  }

  console.log('\nCleanup');
  await check('DELETE /recruiter/jobs/:id', async () => ok(await call('DELETE', `/recruiter/jobs/${ids.job}`, undefined, recruiter)));
  await check('DELETE /auth/me (both test accounts)', async () => {
    ok(await call('DELETE', '/auth/me', undefined, seeker));
    ok(await call('DELETE', '/auth/me', undefined, recruiter));
    expect((await call('GET', '/auth/me', undefined, seeker)).status === 401, 'still logged in');
  });

  // Remove anything the API flows left behind that isn't owned by a user record.
  await connectDB();
  const testUsers = await User.find({ email: { $regex: `^test\\.(seeker|recruiter)\\.${stamp}@` } }).select('_id');
  const company = await Company.findOne({ name: 'Test Co', 'members.email': recruiterEmail });
  const projectIds = [ids.project, ids.project2].filter(Boolean);
  // Never pass an undefined filter: Mongoose drops it and deletes everything.
  const userIds = testUsers.map((u) => u._id);
  const jobs = await Job.find({ company: company?._id ?? '000000000000000000000000' }).select('_id');
  const jobIds = [...jobs.map((j) => String(j._id)), ids.job].filter(Boolean);
  const apps = await Application.find({ job: { $in: jobIds } }).select('_id');
  const contracts = await Contract.find({ project: { $in: projectIds } }).select('_id');
  await Promise.all([
    Contract.deleteMany({ _id: { $in: contracts.map((c) => c._id) } }),
    Review.deleteMany({ contract: { $in: contracts.map((c) => c._id) } }),
    Proposal.deleteMany({ project: { $in: projectIds } }),
    Project.deleteMany({ _id: { $in: projectIds } }),
    Interview.deleteMany({ application: { $in: apps.map((a) => a._id) } }),
    Application.deleteMany({ _id: { $in: apps.map((a) => a._id) } }),
    Job.deleteMany({ _id: { $in: jobIds } }),
    Notification.deleteMany({ user: { $in: userIds } }),
    Saved.deleteMany({ $or: [{ user: { $in: userIds } }, { ref: { $in: [...jobIds, seekerId].filter(Boolean) } }] }),
    Otp.deleteMany({ target: { $in: [seekerEmail, phone.toLowerCase()] } }),
    company ? Company.deleteOne({ _id: company._id }) : Promise.resolve(),
  ]);
  const conv = ids.chat ? await Conversation.findById(ids.chat) : null;
  if (conv) {
    await Message.deleteMany({ conversation: conv._id });
    await conv.deleteOne();
  }
  await Promise.all([
    Transaction.deleteMany({ user: { $in: userIds } }),
    Wallet.deleteMany({ user: { $in: userIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await disconnectDB();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failed:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
