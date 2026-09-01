import { acceptPendingEdits } from './controllers/bulkReviewController.js';
import { updateAdminAccount } from './controllers/accountController.js';
import { listExportChapters, exportApprovedBatch } from './exports/exportApproved.js';
import { editorRouter } from './integrations/editorRouter.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { requireAuth, requireAdmin, requireBookAccess } from './middleware/auth.js';
import * as authController from './controllers/authController.js';
import * as adminController from './controllers/adminController.js';
import * as bookController from './controllers/bookController.js';
import * as editController from './controllers/editController.js';
import * as reviewController from './controllers/reviewController.js';
import { isDbAlive, getDatabaseProvider } from './db/database.js';
import { config } from './config.js';

export const createApp = () => {
  const app = express();

  // Strict CORS configuration
  const origin = config.corsOrigin;
  app.use(cors({
    origin: origin === '*' ? '*' : origin,
    credentials: true,
  }));

  app.use('/api/integrations/editor', editorRouter());

  // 50mb limit for large parsed book drafts
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Health check endpoints (root and /api paths)
  const healthHandler = (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'LilyBeta Backend',
      time: new Date().toISOString(),
    });
  };

  const dbHealthHandler = async (_req: Request, res: Response) => {
    try {
      const alive = await isDbAlive();
      res.status(alive ? 200 : 503).json({
        status: alive ? 'ok' : 'degraded',
        database: alive ? 'connected' : 'disconnected',
        provider: getDatabaseProvider(),
        time: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'error',
        database: 'disconnected',
        provider: getDatabaseProvider(),
        time: new Date().toISOString(),
      });
    }
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);
  app.get('/health/db', dbHealthHandler);
  app.get('/api/health/db', dbHealthHandler);

  // Auth routes
  app.post('/api/auth/login', asyncHandler(authController.login));
  app.get('/api/auth/me', requireAuth, asyncHandler(authController.me));
  app.post('/api/auth/logout', asyncHandler(authController.logout));

  // Admin routes
  app.patch('/api/admin/account', requireAuth, requireAdmin, asyncHandler(updateAdminAccount));
  app.get('/api/admin/beta-readers', requireAuth, requireAdmin, asyncHandler(adminController.listBetaReaders));
  app.post('/api/admin/beta-readers', requireAuth, requireAdmin, asyncHandler(adminController.createBetaReader));
  app.patch('/api/admin/beta-readers/:id/status', requireAuth, requireAdmin, asyncHandler(adminController.toggleBetaReaderStatus));
  app.get('/api/admin/books', requireAuth, requireAdmin, asyncHandler(adminController.listBooks));
  app.post('/api/admin/books', requireAuth, requireAdmin, asyncHandler(adminController.saveParsedBook));
  app.delete('/api/admin/books/:id', requireAuth, requireAdmin, asyncHandler(adminController.deleteBook));
  app.post('/api/admin/books/:id/assign', requireAuth, requireAdmin, asyncHandler(adminController.assignBook));
  app.delete('/api/admin/books/:id/assign/:userId', requireAuth, requireAdmin, asyncHandler(adminController.revokeAssignment));
  app.get('/api/admin/logs', requireAuth, requireAdmin, asyncHandler(adminController.getActivityLogs));
  app.get('/api/admin/books/:id/edits', requireAuth, requireAdmin, asyncHandler(editController.listAdminBookEdits));

  app.get('/api/admin/books/:id/approved-export/chapters', requireAuth, requireAdmin, asyncHandler(listExportChapters));
  app.post('/api/admin/books/:id/approved-export/export', requireAuth, requireAdmin, asyncHandler(exportApprovedBatch));

  // Phase 5: Book Derived Readiness Endpoint
  app.get('/api/admin/books/:id/readiness', requireAuth, requireAdmin, asyncHandler(adminController.getBookReadiness));

  // Phase 4: Admin Review & Chapter Approval routes
  app.get('/api/admin/books/:id/review', requireAuth, requireAdmin, asyncHandler(reviewController.getBookReviewOverview));
  app.patch('/api/admin/books/:id/chapters/:index/title', requireAuth, requireAdmin, asyncHandler(reviewController.updateChapterTitle));
  app.get('/api/admin/books/:id/assignments/:assignmentId/chapters/:index/review', requireAuth, requireAdmin, asyncHandler(reviewController.getChapterReviewDetail));
  app.post('/api/admin/books/:id/assignments/:assignmentId/chapters/:index/accept-pending', requireAuth, requireAdmin, asyncHandler(acceptPendingEdits));
  app.post('/api/admin/edits/:editId/reviews', requireAuth, requireAdmin, asyncHandler(reviewController.createEditReview));
  app.post('/api/admin/books/:id/assignments/:assignmentId/chapters/:index/approve', requireAuth, requireAdmin, asyncHandler(reviewController.approveChapter));
  app.post('/api/admin/books/:id/assignments/:assignmentId/chapters/:index/reopen', requireAuth, requireAdmin, asyncHandler(reviewController.reopenChapter));
  app.patch('/api/admin/notes/:noteId/resolve', requireAuth, requireAdmin, asyncHandler(reviewController.resolveNote));

  // Books / Reader routes (Secured against IDOR)
  app.get('/api/books', requireAuth, asyncHandler(bookController.listBooks));
  app.get('/api/books/:id', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.getBook));
  app.get('/api/books/:id/workflow', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.getChapterWorkflow));
  app.get('/api/books/:id/chapters', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.getChapterList));
  app.get('/api/books/:id/chapters/:index/meta', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.getChapterMeta));
  app.get('/api/books/:id/chapters/:index', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.getChapter));
  app.get('/api/books/:id/chapters/:index/approved', requireAuth, asyncHandler(requireBookAccess), asyncHandler(reviewController.getApprovedChapterVersion));
  app.post('/api/books/:id/chapters/:index/complete', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.completeChapter));
  app.get('/api/books/:id/progress', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.getProgress));
  app.post('/api/books/:id/progress', requireAuth, asyncHandler(requireBookAccess), asyncHandler(bookController.saveProgress));

  // Phase 3: Inline Edits & Multi-Revision routes
  app.get('/api/books/:id/chapters/:index/edits', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.listChapterEdits));
  app.post('/api/books/:id/chapters/:index/edits', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.createEdit));
  app.patch('/api/books/:id/chapters/:index/edits/:editId', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.updateEdit));
  app.delete('/api/books/:id/chapters/:index/edits/:editId', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.deleteEdit));
  app.get('/api/books/:id/chapters/:index/edits/:editId/revisions', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.getEditRevisions));

  // Phase 3: Paragraph Selection Notes routes
  app.get('/api/books/:id/chapters/:index/notes', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.listChapterNotes));
  app.post('/api/books/:id/chapters/:index/notes', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.createNote));
  app.delete('/api/books/:id/chapters/:index/notes/:noteId', requireAuth, asyncHandler(requireBookAccess), asyncHandler(editController.deleteNote));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API không tồn tại', code: 'NOT_FOUND' });
  });

  // Centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return _next(err);
    console.error('[LilyBeta Uncaught Error]', err);
    const status = err.status || 500;
    const message = config.nodeEnv === 'production' && status === 500
      ? 'Internal server error'
      : (err.message || 'Lỗi hệ thống');
    res.status(status).json({ error: message, code: err.code });
  });

  return app;
};
