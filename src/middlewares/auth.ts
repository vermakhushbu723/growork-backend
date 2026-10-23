import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/http.js';

export interface AuthUser {
  id: string;
  app: 'seeker' | 'recruiter';
  name: string;
  email: string;
  /** Company id for recruiter accounts. */
  company?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const signToken = (u: { _id: unknown; app: string }) =>
  jwt.sign({ sub: String(u._id), app: u.app }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);

async function resolveUser(req: Request): Promise<AuthUser | undefined> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as { sub: string };
    const user = await User.findById(payload.sub).select('app name email company');
    if (!user) return undefined;
    return {
      id: String(user._id),
      app: user.app,
      name: user.name,
      email: user.email,
      company: user.company ? String(user.company) : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Attaches req.user if a valid token is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  next();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  if (!req.user) return next(new ApiError(401, 'Please log in to continue.'));
  next();
}

/** Recruiter-app accounts only; also guarantees a company exists. */
export async function requireRecruiter(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  if (!req.user) return next(new ApiError(401, 'Please log in to continue.'));
  if (req.user.app !== 'recruiter') return next(new ApiError(403, 'Recruiter account required.'));
  if (!req.user.company) return next(new ApiError(400, 'Set up your company first.'));
  next();
}

/** User-app (job seeker / freelancer) accounts only. */
export async function requireSeeker(req: Request, _res: Response, next: NextFunction) {
  req.user = await resolveUser(req);
  if (!req.user) return next(new ApiError(401, 'Please log in to continue.'));
  if (req.user.app !== 'seeker') return next(new ApiError(403, 'Job seeker account required.'));
  next();
}
