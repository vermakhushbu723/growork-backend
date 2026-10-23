/**
 * Resets the database to a small demo dataset (2–3 records per collection).
 *   npm run seed
 * Demo logins (password for all: Demo@123):
 *   User app      khushbu@demo.subkamyaab.com · priya@demo.subkamyaab.com · rohit@demo.subkamyaab.com
 *   Recruiter app ananya@demo.subkamyaab.com  · rahul@demo.subkamyaab.com
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { Application } from '../models/Application.js';
import { Conversation, Message } from '../models/Chat.js';
import { Company } from '../models/Company.js';
import { Contract } from '../models/Contract.js';
import { Interview } from '../models/Interview.js';
import { Job } from '../models/Job.js';
import { Notification, Otp, Review, Saved } from '../models/Misc.js';
import { Project } from '../models/Project.js';
import { Proposal } from '../models/Proposal.js';
import { User } from '../models/User.js';
import { Transaction, Wallet } from '../models/Wallet.js';

export const DEMO_PASSWORD = 'Demo@123';
const days = (n: number) => new Date(Date.now() + n * 86400000);

async function seed() {
  await connectDB();
  const models = [User, Company, Job, Application, Interview, Project, Proposal, Contract, Wallet, Transaction, Conversation, Message, Notification, Review, Saved, Otp];
  for (const m of models) await (m as unknown as mongoose.Model<unknown>).deleteMany({});

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ── Users ──
  const [khushbu, priya, rohit] = await User.create([
    {
      app: 'seeker',
      role: 'jobSeeker',
      name: 'Khushbu Verma',
      email: 'khushbu@demo.subkamyaab.com',
      phone: '+91 98765 43210',
      passwordHash,
      headline: 'Flutter Developer',
      location: 'Noida, India',
      bio: 'Flutter developer who loves building clean, fast mobile apps.',
      skills: ['Flutter', 'Dart', 'Firebase', 'Riverpod'],
      experience: '3 yrs',
      education: 'B.Tech, Computer Science',
      currentCompany: 'AppStudio',
      expectedSalary: '₹12 LPA',
      noticePeriod: '30 days',
      hourlyRate: 800,
      rating: 4.7,
      jobsDone: 28,
      successRate: 95,
      profileViews: 320,
      documents: [
        { name: 'Khushbu_Verma_Resume.pdf', kind: 'Resume / CV', size: '245 KB', isPrimaryResume: true },
        { name: 'Cover_Letter.pdf', kind: 'Cover letter', size: '120 KB' },
      ],
      certificates: [
        { title: 'Flutter Development Bootcamp', issuer: 'Udemy', date: 'Mar 2026', verified: true },
        { title: 'Firebase Fundamentals', issuer: 'Google', date: 'Jan 2026', verified: true },
      ],
      portfolio: [
        { title: 'FinPay Wallet App', category: 'Mobile App', tags: ['Flutter', 'Firebase'] },
        { title: 'FoodDash Delivery', category: 'Mobile App', tags: ['Flutter', 'Maps'] },
      ],
    },
    {
      app: 'seeker',
      role: 'freelancer',
      name: 'Priya Sharma',
      email: 'priya@demo.subkamyaab.com',
      phone: '+91 91234 56780',
      passwordHash,
      headline: 'Full-stack React Developer',
      location: 'Pune, India',
      bio: 'Top-rated freelancer building dashboards and SaaS front-ends.',
      skills: ['React', 'TypeScript', 'Figma', 'Charts'],
      experience: '5 yrs',
      education: 'B.Des, NID',
      hourlyRate: 900,
      rating: 4.9,
      jobsDone: 46,
      successRate: 98,
      portfolio: [{ title: 'Ops Dashboard', category: 'Web App', tags: ['React', 'Charts'] }],
      documents: [{ name: 'Priya_Portfolio.pdf', kind: 'Resume / CV', size: '1.1 MB', isPrimaryResume: true }],
    },
    {
      app: 'seeker',
      role: 'jobSeeker',
      name: 'Rohit Sharma',
      email: 'rohit@demo.subkamyaab.com',
      phone: '+91 99887 76655',
      passwordHash,
      headline: 'Mobile Engineer',
      location: 'Delhi, India',
      skills: ['Flutter', 'Kotlin', 'Bloc'],
      experience: '4 yrs',
      expectedSalary: '₹14 LPA',
      noticePeriod: '60 days',
      rating: 4.5,
      documents: [{ name: 'Rohit_Sharma_CV.pdf', kind: 'Resume / CV', size: '210 KB', isPrimaryResume: true }],
    },
  ]);

  const [ananya, rahul] = await User.create([
    { app: 'recruiter', accountType: 'both', name: 'Ananya Kapoor', email: 'ananya@demo.subkamyaab.com', phone: '+91 98111 22334', passwordHash, designation: 'HR Manager', rating: 4.8 },
    { app: 'recruiter', accountType: 'client', name: 'Rahul Khanna', email: 'rahul@demo.subkamyaab.com', phone: '+91 98222 33445', passwordHash, designation: 'Founder' },
  ]);

  const [techify, startupx] = await Company.create([
    {
      name: 'Techify Solutions',
      industry: 'Information Technology',
      size: '51-200 employees',
      website: 'www.techify.in',
      location: 'Noida, India',
      about: 'Techify Solutions builds web and mobile products for fast-growing startups and enterprises across India.',
      founded: '2016',
      gstin: '09AABCT1234F1Z5',
      isVerified: true,
      owner: ananya._id,
      members: [
        { name: 'Ananya Kapoor', email: ananya.email, role: 'Admin', pending: false, user: ananya._id },
        { name: 'Vivek Rao', email: 'vivek@techify.in', role: 'Recruiter', pending: true },
      ],
    },
    {
      name: 'StartupX',
      industry: 'Software Product',
      size: '11-50 employees',
      website: 'www.startupx.io',
      location: 'Bengaluru, India',
      about: 'StartupX builds tools for small businesses.',
      founded: '2021',
      owner: rahul._id,
      members: [{ name: 'Rahul Khanna', email: rahul.email, role: 'Admin', pending: false, user: rahul._id }],
    },
  ]);
  ananya.company = techify._id;
  rahul.company = startupx._id;
  await Promise.all([ananya.save(), rahul.save()]);

  // ── Jobs ──
  const [flutterJob, designJob, internJob] = await Job.create([
    {
      company: techify._id,
      postedBy: ananya._id,
      title: 'Flutter Developer',
      category: 'Engineering',
      type: 'Full-time',
      workMode: 'Hybrid',
      location: 'Noida, India',
      salaryMin: 8,
      salaryMax: 14,
      experience: '2–4 yrs',
      level: 'Mid Level',
      openings: 2,
      skills: ['Flutter', 'Dart', 'Riverpod', 'Firebase'],
      description: 'Build and ship cross-platform apps used by thousands of customers.',
      responsibilities: ['Build and ship features end to end', 'Write clean, tested code', 'Collaborate with design and QA'],
      perks: ['Health insurance', 'Flexible work hours'],
      deadline: days(30),
      views: 842,
      isUrgent: true,
      publishedAt: days(-3),
    },
    {
      company: techify._id,
      postedBy: ananya._id,
      title: 'UI/UX Designer',
      category: 'Design',
      type: 'Full-time',
      workMode: 'Remote',
      location: 'Remote',
      salaryMin: 6,
      salaryMax: 10,
      experience: '1–3 yrs',
      level: 'Junior Level',
      skills: ['Figma', 'Design Systems', 'Prototyping'],
      description: 'Craft delightful, accessible interfaces across web and mobile.',
      perks: ['Work from home'],
      deadline: days(20),
      views: 516,
      publishedAt: days(-7),
    },
    {
      company: startupx._id,
      postedBy: rahul._id,
      title: 'Marketing Intern',
      category: 'Marketing',
      type: 'Internship',
      workMode: 'On-site',
      location: 'Bengaluru, India',
      salaryMin: 12,
      salaryMax: 18,
      experience: '0–1 yrs',
      level: 'Fresher',
      skills: ['Social Media', 'Content', 'Canva'],
      description: 'Plan and run social campaigns and track performance.',
      perks: ['Certificate', 'PPO opportunity'],
      duration: '6 months',
      deadline: days(15),
      views: 290,
      publishedAt: days(-2),
    },
  ]);

  // ── Applications & interview ──
  const [, rohitApp, priyaApp] = await Application.create([
    { job: flutterJob._id, company: techify._id, applicant: khushbu._id, resumeName: 'Khushbu_Verma_Resume.pdf', coverLetter: 'I have shipped 4 Flutter apps to production and love owning features end to end.', noticePeriod: '30 days', matchScore: 100 },
    { job: flutterJob._id, company: techify._id, applicant: rohit._id, resumeName: 'Rohit_Sharma_CV.pdf', coverLetter: 'Mobile engineer with a native Android background, on Flutter for 2 years.', noticePeriod: '60 days', status: 'shortlisted', matchScore: 63 },
    { job: designJob._id, company: techify._id, applicant: priya._id, resumeName: 'Priya_Portfolio.pdf', coverLetter: 'I design calm, accessible interfaces and have shipped 3 design systems.', noticePeriod: '30 days', status: 'interview', matchScore: 67 },
  ]);
  await Interview.create({
    application: priyaApp._id,
    company: techify._id,
    candidate: priya._id,
    jobTitle: 'UI/UX Designer',
    dateTime: days(2),
    mode: 'video',
    round: 'Portfolio Review',
    interviewer: 'Ananya Kapoor',
    link: 'meet.google.com/abc-defg-hij',
  });

  // ── Projects, proposals, contract ──
  const [dashboard, logo, bugfix] = await Project.create([
    { client: ananya._id, company: techify._id, title: 'Build a React Admin Dashboard', category: 'Web Development', description: 'Responsive admin dashboard with charts, tables and role-based access.', skills: ['React', 'TypeScript', 'Charts'], pricing: 'fixed', budgetMin: 25000, budgetMax: 40000, duration: '2–4 weeks', level: 'Intermediate', status: 'inProgress', views: 312, hiredFreelancer: priya._id, publishedAt: days(-21) },
    { client: ananya._id, company: techify._id, title: 'Logo & Brand Identity Design', category: 'Design', description: 'A fresh, modern brand identity for our new product line.', skills: ['Logo Design', 'Branding', 'Figma'], pricing: 'fixed', budgetMin: 8000, budgetMax: 15000, duration: '1–2 weeks', level: 'Intermediate', views: 188, attachments: ['Brand_Brief.pdf'], publishedAt: days(-2) },
    { client: rahul._id, company: startupx._id, title: 'Flutter App Bug Fixes', category: 'Mobile Development', description: 'Fix UI bugs and improve start-up time of our Flutter app.', skills: ['Flutter', 'Firebase', 'Performance'], pricing: 'hourly', budgetMin: 600, budgetMax: 1000, duration: 'Less than 1 week', level: 'Expert', views: 240, publishedAt: days(-5) },
  ]);
  const [dashProposal] = await Proposal.create([
    { project: dashboard._id, client: ananya._id, freelancer: priya._id, pricing: 'fixed', amount: 35000, deliveryDays: 21, coverLetter: 'I have built 6 admin dashboards with React and Recharts. I will share a clickable prototype in 3 days.', status: 'hired' },
    { project: logo._id, client: ananya._id, freelancer: priya._id, pricing: 'fixed', amount: 12000, deliveryDays: 7, coverLetter: 'I will share 3 logo concepts in 3 days and unlimited revisions on the chosen one, plus a social media kit.', status: 'shortlisted' },
    { project: bugfix._id, client: rahul._id, freelancer: khushbu._id, pricing: 'hourly', amount: 800, deliveryDays: 5, coverLetter: 'I will profile the app first, share a list of fixes with estimates, then fix bugs in priority order.' },
  ]);
  const contract = await Contract.create({
    project: dashboard._id,
    proposal: dashProposal._id,
    client: ananya._id,
    freelancer: priya._id,
    title: dashboard.title,
    milestones: [
      { title: 'Layout, auth & navigation', amount: 10000, dueIn: 'Completed', status: 'released' },
      { title: 'Charts and data tables', amount: 15000, dueIn: 'Due in 2 days', status: 'submitted', note: 'Charts and tables are done. Preview: dashboard-staging.vercel.app' },
      { title: 'Role-based access & handover', amount: 10000, dueIn: 'Due in 12 days' },
    ],
  });

  // ── Wallets & transactions ──
  await Wallet.create([
    { user: ananya._id, balance: 85000, escrow: 15450, plan: 'Growth', jobCredits: 9 },
    { user: rahul._id, balance: 20000, plan: 'Starter', jobCredits: 1 },
    { user: khushbu._id, balance: 12450 },
    { user: priya._id, balance: 9000 },
    { user: rohit._id, balance: 0 },
  ]);
  await Transaction.create([
    { user: ananya._id, title: 'Added money via UPI', amount: 50000, isCredit: true, kind: 'topup' },
    { user: ananya._id, title: 'Escrow funded - Charts and data tables', amount: 15450, isCredit: false, kind: 'escrowFund' },
    { user: priya._id, title: 'Freelance payout - Layout, auth & navigation', amount: 10000, isCredit: true, kind: 'payout' },
    { user: priya._id, title: 'Platform fee - Layout, auth & navigation', amount: 1000, isCredit: false, kind: 'fee' },
    { user: khushbu._id, title: 'Added money via UPI', amount: 2000, isCredit: true, kind: 'topup' },
  ]);

  // ── Chats ──
  const [c1, c2] = await Conversation.create([
    { participants: [ananya._id, khushbu._id], context: 'Flutter Developer', lastMessage: 'Yes, any time after 2 PM works for me.', lastAt: days(-0.1), unread: { [String(ananya._id)]: 1 } },
    { participants: [ananya._id, priya._id], context: 'React Admin Dashboard', lastMessage: 'Milestone 2 is submitted — preview link is in the note.', lastAt: days(-1), unread: { [String(ananya._id)]: 1 } },
  ]);
  await Message.create([
    { conversation: c1._id, sender: ananya._id, text: 'Hi Khushbu! We liked your profile. Are you free for a quick call this week?' },
    { conversation: c1._id, sender: khushbu._id, text: 'Yes, any time after 2 PM works for me.' },
    { conversation: c2._id, sender: priya._id, text: 'Milestone 2 is submitted — preview link is in the note.' },
  ]);

  // ── Notifications, reviews, saved ──
  await Notification.create([
    { user: ananya._id, type: 'applicationReceived', title: 'New Applicant', message: 'Khushbu Verma applied for Flutter Developer · 100% match.', ref: String(flutterJob._id) },
    { user: ananya._id, type: 'milestoneSubmitted', title: 'Milestone Submitted', message: 'Priya Sharma submitted "Charts and data tables" for your review.', ref: String(contract._id) },
    { user: rohit._id, type: 'applicationStatus', title: 'Application Update', message: 'You have been shortlisted for Flutter Developer.', ref: String(rohitApp._id) },
    { user: khushbu._id, type: 'jobMatch', title: 'New Job Match', message: 'UI/UX Designer at Techify Solutions matches your profile.', ref: String(designJob._id), isRead: true },
    { user: priya._id, type: 'interviewScheduled', title: 'Interview Scheduled', message: 'Portfolio Review for UI/UX Designer in 2 days.', ref: String(priyaApp._id) },
  ]);
  await Review.create([
    { reviewer: ananya._id, reviewee: priya._id, rating: 5, comment: 'Delivered the first milestone ahead of schedule with clean code.', context: 'Freelance Project' },
    { reviewer: rahul._id, reviewee: khushbu._id, rating: 4.5, comment: 'Great communication and quick turnaround.', context: 'Freelance Project' },
    { reviewer: priya._id, reviewee: ananya._id, rating: 5, comment: 'Clear requirements and payments released on time.', context: 'Freelancer' },
  ]);
  await Saved.create([
    { user: khushbu._id, kind: 'job', ref: designJob._id },
    { user: khushbu._id, kind: 'project', ref: logo._id },
    { user: ananya._id, kind: 'talent', ref: priya._id },
  ]);

  const counts = await Promise.all(models.map(async (m) => `${m.modelName}: ${await (m as unknown as mongoose.Model<unknown>).countDocuments()}`));
  console.log('Seeded →', counts.join(', '));
}

seed()
  .then(disconnectDB)
  .catch(async (e) => {
    console.error(e);
    await disconnectDB();
    process.exit(1);
  });
