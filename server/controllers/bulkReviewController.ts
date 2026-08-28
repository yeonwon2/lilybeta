import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { queryOne, transaction } from '../db/database.js';

class ReviewStaleError extends Error {}

// Additive shortcut: accept only the exact pending revisions the Admin confirmed.
export async function acceptPendingEdits(req: Request, res: Response) {
  const { id: bookId, assignmentId, index } = req.params;
  const chapterIndex = Number(index);
  const selected = req.body?.edits;
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 1 || !Array.isArray(selected) || selected.length < 1 || selected.length > 200 || new Set(selected.map(e => e?.id)).size !== selected.length || selected.some(e => typeof e?.id !== 'string' || e.id.length > 200 || !Number.isSafeInteger(e.version) || e.version < 1 || !Number.isSafeInteger(e.revisionNumber) || e.revisionNumber < 1)) {
    res.status(400).json({ error: 'Cần 1–200 chỉnh sửa và phiên bản hợp lệ.' }); return;
  }
  const assignment = await queryOne('SELECT id FROM beta_assignments WHERE id = ? AND book_id = ?', assignmentId, bookId);
  if (!assignment) { res.status(404).json({ error: 'Phân công không thuộc truyện này.' }); return; }
  try {
    await transaction(async tx => {
      // Short write lock: concurrent individual reviews cannot slip between the pending
      // check and insert. Existing manual behavior is unchanged after this transaction.
      if (tx.provider === 'postgres') await tx.exec('LOCK TABLE beta_edit_reviews IN SHARE ROW EXCLUSIVE MODE');
      const chapter = await tx.queryOne<any>('SELECT id FROM beta_chapters WHERE book_id = ? AND chapter_index = ?', bookId, chapterIndex);
      const complete = await tx.queryOne<any>('SELECT status FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?', assignmentId, chapterIndex);
      const approved = await tx.queryOne<any>('SELECT status FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?', assignmentId, chapterIndex);
      if (!chapter || complete?.status !== 'COMPLETED' || approved?.status === 'APPROVED') throw new ReviewStaleError('Chương chưa được Beta hoàn thành hoặc đã phê duyệt. Tải lại danh sách.');
      const ids = selected.map(e => e.id);
      const edits = await tx.queryAll<any>(`SELECT e.id, e.version, e.chapter_id, e.status FROM beta_edits e WHERE e.assignment_id = ? AND e.book_id = ? AND e.chapter_id = ? AND e.id IN (${ids.map(() => '?').join(',')})${tx.provider === 'postgres' ? ' FOR UPDATE' : ''}`, assignmentId, bookId, chapter.id, ...ids);
      const revisions = await tx.queryAll<any>(`SELECT edit_id, MAX(revision_number) AS version FROM beta_edit_revisions WHERE edit_id IN (${ids.map(() => '?').join(',')}) GROUP BY edit_id`, ...ids);
      const reviews = await tx.queryAll<any>(`SELECT edit_id, reviewed_revision_number FROM beta_edit_reviews WHERE edit_id IN (${ids.map(() => '?').join(',')})`, ...ids);
      for (const chosen of selected) {
        const edit = edits.find(e => e.id === chosen.id);
        const revision = revisions.find(r => r.edit_id === chosen.id);
        if (!edit || edit.status !== 'ACTIVE' || edit.version !== chosen.version || revision?.version !== chosen.revisionNumber || chosen.version !== chosen.revisionNumber || reviews.some(r => r.edit_id === chosen.id && r.reviewed_revision_number === chosen.revisionNumber)) throw new ReviewStaleError('Đề xuất đã thay đổi hoặc đã được xử lý. Tải lại để tránh duyệt nhầm phiên bản.');
      }
      const now = new Date().toISOString();
      // One insert instead of one network request/refresh for every individual edit.
      const params = selected.flatMap(e => [randomUUID(), e.id, assignmentId, chapter.id, req.user!.id, 'ACCEPTED', null, e.revisionNumber, e.version, now, now]);
      await tx.run(`INSERT INTO beta_edit_reviews (id, edit_id, assignment_id, chapter_id, reviewer_id, decision, comment, reviewed_revision_number, reviewed_edit_version, created_at, updated_at) VALUES ${selected.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')}`, ...params);
      await tx.run('INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', randomUUID(), req.user!.id, 'EDITS_BULK_REVIEWED', bookId, chapter.id, JSON.stringify({ assignmentId, chapterIndex, decision: 'ACCEPTED', edits: selected }), now);
    });
    res.json({ success: true, acceptedCount: selected.length });
  } catch (error: any) {
    if (error instanceof ReviewStaleError) { res.status(409).json({ error: error.message, code: 'REVIEW_STALE' }); return; }
    throw error;
  }
}
