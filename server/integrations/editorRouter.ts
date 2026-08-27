import express from 'express';
import { requireEditorSync } from './editorAuth.js';
import { parseSyncInput } from './editorContract.js';
import { syncEditorBook, getEditorSyncState } from './editorSync.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function editorRouter() {
  const router = express.Router();
  // Authenticate before parsing potentially large requests; existing 50 MB upload is untouched.
  router.use(requireEditorSync, express.json({ limit: '2mb' }));
  router.post('/sync', asyncHandler(async (req, res) => {
    const result = await syncEditorBook(parseSyncInput(req.body));
    // Per-chapter business conflicts do not undo other successes; callers inspect every result.
    res.status(200).json(result);
  }));
  router.get('/books/:editorBookId', asyncHandler(async (req, res) => {
    res.json(await getEditorSyncState(String(req.params.editorBookId)));
  }));
  router.use((_req, res) => { res.status(404).json({ error: 'Integration endpoint không tồn tại' }); });
  return router;
}
