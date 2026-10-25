import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middlewares/error.js';
import authRoutes from './routes/auth.routes.js';
import callsRoutes from './routes/calls.routes.js';
import clientRoutes from './routes/client.routes.js';
import companyRoutes from './routes/company.routes.js';
import jobsRoutes from './routes/jobs.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import profileRoutes from './routes/profile.routes.js';
import projectsRoutes from './routes/projects.routes.js';
import recruiterRoutes from './routes/recruiter.routes.js';
import socialRoutes from './routes/social.routes.js';
import talentRoutes from './routes/talent.routes.js';
import uploadsRoutes from './routes/uploads.routes.js';
import walletRoutes from './routes/wallet.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  // Mobile apps don't send an Origin header; allow all origins for the API.
  app.use(cors());
  // Razorpay signs the raw webhook body, so keep it as bytes there.
  app.use('/api/v1/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  const api = express.Router();
  api.get('/health', (_req, res) =>
    res.json({ success: true, status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }),
  );
  // Brute-force protection on login / OTP.
  api.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }), authRoutes);
  api.use('/recruiter', recruiterRoutes);
  api.use('/client', clientRoutes);
  api.use(jobsRoutes);
  api.use(projectsRoutes);
  api.use(talentRoutes);
  api.use(companyRoutes);
  api.use(walletRoutes);
  api.use(profileRoutes);
  api.use(socialRoutes);
  api.use(callsRoutes);
  api.use(paymentsRoutes);
  api.use(uploadsRoutes);

  app.use('/api/v1', api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
