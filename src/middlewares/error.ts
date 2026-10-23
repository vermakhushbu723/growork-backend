import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ApiError } from '../utils/http.js';

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ success: false, message: err.message, details: err.details });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ success: false, message: Object.values(err.errors)[0]?.message ?? 'Invalid data' });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ success: false, message: `Invalid ${err.path}` });
  }
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    const field = Object.keys((err as { keyValue?: object }).keyValue ?? {})[0] ?? 'field';
    return res.status(409).json({ success: false, message: `That ${field} already exists.` });
  }
  console.error(err);
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
}
