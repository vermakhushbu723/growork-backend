import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/http.js';

/** Validates and replaces req.body with the parsed (trimmed, coerced) result. */
export const validate = (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const first = result.error.issues[0];
    return next(new ApiError(400, `${first.path.join('.') || 'body'}: ${first.message}`, result.error.flatten().fieldErrors));
  }
  req.body = result.data;
  next();
};
