import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import { requireAuth } from '../middlewares/auth.js';
import { ApiError, asyncHandler } from '../utils/http.js';

const dir = path.resolve(env.uploadDir);
mkdirSync(dir, { recursive: true });

/** Extension → MIME type we accept (resumes, documents, photos). */
const ALLOWED: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: dir,
    // Random, unguessable names: the files are served without a login so
    // recruiters can open a resume in any PDF viewer.
    filename: (_req, file, cb) => cb(null, `${randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Phones often send application/octet-stream, so the extension decides.
    const ok = ext in ALLOWED && (file.mimetype === 'application/octet-stream' || ALLOWED[ext].includes(file.mimetype));
    if (ok) cb(null, true);
    else cb(new ApiError(400, 'Only PDF, DOC, DOCX, JPG, PNG or WEBP files are allowed.'));
  },
});

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const router = Router();

/** `POST /uploads` (multipart, field `file`) → `{ url, name, size, mimeType }`. */
router.post(
  '/uploads',
  requireAuth,
  (req, res, next) =>
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(new ApiError(400, err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message));
      }
      next(err);
    }),
  asyncHandler(async (req, res) => {
    const f = req.file;
    if (!f) throw new ApiError(400, 'Choose a file to upload.');
    res.status(201).json({
      success: true,
      data: {
        url: `${req.protocol}://${req.get('host')}/api/v1/files/${f.filename}`,
        name: f.originalname,
        size: sizeLabel(f.size),
        mimeType: f.mimetype,
      },
    });
  }),
);

/** Uploaded files, opened inline (PDF viewer / browser). */
router.use(
  '/files',
  (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  },
  express.static(dir, { index: false, dotfiles: 'deny', maxAge: '7d' }),
);

export default router;
