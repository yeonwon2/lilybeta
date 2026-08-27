import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export const requireEditorSync: RequestHandler = (req, res, next) => {
  const secret = process.env.EDITOR_SYNC_SECRET;
  if (!secret || secret.length < 32 || !process.env.EDITOR_SYNC_ADMIN_ID) {
    res.status(503).json({ error: 'Editor Sync chưa được cấu hình', code: 'EDITOR_SYNC_DISABLED' });
    return;
  }
  const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!supplied || !timingSafeEqual(digest(secret), digest(supplied))) {
    res.status(401).json({ error: 'Integration token không hợp lệ', code: 'INVALID_INTEGRATION_TOKEN' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
};
