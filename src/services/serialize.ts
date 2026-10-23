/* Shapes documents into the JSON both apps consume. Inputs are populated
 * Mongoose documents (or lean objects); anything missing falls back safely. */

type AnyDoc = Record<string, any> | null | undefined;

const id = (d: AnyDoc) => (d ? String(d._id ?? d.id ?? d) : null);

export function companyLite(c: AnyDoc) {
  if (!c || typeof c !== 'object' || !('name' in c)) return null;
  return {
    id: id(c),
    name: c.name,
    industry: c.industry ?? '',
    size: c.size ?? '',
    location: c.location ?? '',
    website: c.website ?? '',
    logoUrl: c.logoUrl ?? '',
    isVerified: !!c.isVerified,
  };
}

/** Public profile of a job seeker / freelancer. */
export function talent(u: AnyDoc, opts: { contact?: boolean } = {}) {
  if (!u || typeof u !== 'object' || !('name' in u)) return null;
  const isFreelancer = u.role === 'freelancer';
  return {
    id: id(u),
    name: u.name,
    headline: u.headline ?? '',
    role: u.role ?? 'jobSeeker',
    kind: isFreelancer ? 'freelancer' : 'candidate',
    location: u.location ?? '',
    experience: u.experience ?? '',
    education: u.education ?? '',
    skills: u.skills ?? [],
    about: u.bio ?? '',
    rate: isFreelancer ? `₹${(u.hourlyRate ?? 0).toLocaleString('en-IN')} /hr` : u.expectedSalary || '—',
    hourlyRate: u.hourlyRate ?? 0,
    expectedSalary: u.expectedSalary ?? '',
    noticePeriod: u.noticePeriod ?? '',
    currentCompany: u.currentCompany ?? '',
    rating: u.rating ?? 0,
    jobsDone: u.jobsDone ?? 0,
    successRate: u.successRate ?? 0,
    available: u.available ?? true,
    avatarUrl: u.avatarUrl ?? '',
    portfolio: (u.portfolio ?? []).map((p: AnyDoc) => p?.title),
    ...(opts.contact || u.settings?.showPhone ? { phone: u.phone ?? '' } : {}),
    ...(opts.contact ? { email: u.email ?? '' } : {}),
  };
}

export function job(j: AnyDoc, extra: Record<string, unknown> = {}) {
  if (!j) return null;
  return {
    id: id(j),
    title: j.title,
    category: j.category,
    type: j.type,
    workMode: j.workMode,
    location: j.location,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    experience: j.experience,
    level: j.level,
    openings: j.openings,
    skills: j.skills ?? [],
    description: j.description ?? '',
    responsibilities: j.responsibilities ?? [],
    perks: j.perks ?? [],
    status: j.status,
    deadline: j.deadline ?? null,
    views: j.views ?? 0,
    isUrgent: !!j.isUrgent,
    duration: j.duration ?? null,
    createdAt: j.createdAt,
    publishedAt: j.publishedAt ?? j.createdAt,
    company: companyLite(j.company),
    ...extra,
  };
}

/** An application as the recruiter sees it. */
export function applicant(a: AnyDoc) {
  if (!a) return null;
  return {
    id: id(a),
    status: a.status,
    matchScore: a.matchScore ?? 0,
    coverLetter: a.coverLetter ?? '',
    resumeName: a.resumeName ?? '',
    noticePeriod: a.noticePeriod ?? '',
    note: a.note ?? '',
    offer: a.offer?.amount ? a.offer : null,
    appliedAt: a.createdAt,
    jobId: id(a.job),
    jobTitle: a.job?.title ?? '',
    candidate: talent(a.applicant, { contact: true }),
  };
}

/** An application as the job seeker sees it. */
export function myApplication(a: AnyDoc) {
  if (!a) return null;
  return {
    id: id(a),
    status: a.status,
    appliedAt: a.createdAt,
    updatedAt: a.updatedAt,
    resumeName: a.resumeName,
    offer: a.offer?.amount ? a.offer : null,
    job: job(a.job),
  };
}

export function interview(i: AnyDoc) {
  if (!i) return null;
  return {
    id: id(i),
    applicationId: id(i.application),
    candidateId: id(i.candidate),
    candidateName: i.candidate?.name ?? '',
    jobTitle: i.jobTitle,
    dateTime: i.dateTime,
    mode: i.mode,
    round: i.round,
    durationMins: i.durationMins,
    interviewer: i.interviewer,
    link: i.link,
    message: i.message ?? '',
    status: i.status,
  };
}

export function clientLite(u: AnyDoc) {
  if (!u || typeof u !== 'object' || !('name' in u)) return null;
  const company = companyLite(u.company);
  return {
    id: id(u),
    name: company?.name ?? u.name,
    personName: u.name,
    rating: u.rating ?? 0,
    reviews: u.jobsDone ?? 0,
    isVerified: company?.isVerified ?? false,
  };
}

export function project(p: AnyDoc, extra: Record<string, unknown> = {}) {
  if (!p) return null;
  return {
    id: id(p),
    title: p.title,
    category: p.category,
    description: p.description ?? '',
    skills: p.skills ?? [],
    pricing: p.pricing,
    budgetMin: p.budgetMin,
    budgetMax: p.budgetMax,
    duration: p.duration,
    level: p.level,
    visibility: p.visibility,
    status: p.status,
    views: p.views ?? 0,
    attachments: p.attachments ?? [],
    createdAt: p.createdAt,
    publishedAt: p.publishedAt ?? p.createdAt,
    client: clientLite(p.client),
    hiredFreelancer: p.hiredFreelancer && typeof p.hiredFreelancer === 'object' && 'name' in p.hiredFreelancer
      ? { id: id(p.hiredFreelancer), name: p.hiredFreelancer.name }
      : null,
    ...extra,
  };
}

export function proposal(p: AnyDoc) {
  if (!p) return null;
  return {
    id: id(p),
    status: p.status,
    pricing: p.pricing,
    amount: p.amount,
    deliveryDays: p.deliveryDays,
    coverLetter: p.coverLetter,
    createdAt: p.createdAt,
    projectId: id(p.project),
    project: p.project && typeof p.project === 'object' && 'title' in p.project ? project(p.project) : null,
    freelancer: talent(p.freelancer),
  };
}

export function contract(c: AnyDoc) {
  if (!c) return null;
  const milestones = (c.milestones ?? []).map((m: AnyDoc) => ({
    id: id(m),
    title: m!.title,
    amount: m!.amount,
    dueIn: m!.dueIn,
    status: m!.status,
    note: m!.note ?? '',
  }));
  const sum = (pred: (s: string) => boolean) =>
    milestones.filter((m: { status: string }) => pred(m.status)).reduce((s: number, m: { amount: number }) => s + m.amount, 0);
  return {
    id: id(c),
    title: c.title,
    pricing: c.pricing,
    status: c.status,
    rating: c.rating ?? null,
    review: c.review ?? null,
    startedOn: c.createdAt,
    projectId: id(c.project),
    client: clientLite(c.client),
    freelancer: c.freelancer && 'name' in c.freelancer ? { id: id(c.freelancer), name: c.freelancer.name } : null,
    milestones,
    total: sum(() => true),
    released: sum((s) => s === 'released'),
    inEscrow: sum((s) => s === 'funded' || s === 'submitted' || s === 'revision'),
  };
}
