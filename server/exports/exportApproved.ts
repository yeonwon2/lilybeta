import type { Request, Response } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { buildApprovedChapter } from '../../src/beta-review/approvedVersion.js';

const fail = (message: string) => { throw new Error(message); };
export function approvedText(row: any): string {
  if (row.status !== 'APPROVED') fail('Chương chưa được Admin duyệt hoặc đã mở lại.');
  if (!row.approved_at || !Number.isFinite(Date.parse(row.approved_at)) || !Number.isFinite(Date.parse(row.updated_at)) || Date.parse(row.updated_at) > Date.parse(row.approved_at)) fail('Nguồn chương đã thay đổi sau khi duyệt; cần duyệt lại.');
  const paragraphs = typeof row.paragraphs === 'string' ? JSON.parse(row.paragraphs) : row.paragraphs;
  const snapshot = typeof row.approved_edits_snapshot === 'string' ? JSON.parse(row.approved_edits_snapshot) : row.approved_edits_snapshot;
  if (!Array.isArray(paragraphs) || paragraphs.some(p => typeof p !== 'string') || !Array.isArray(snapshot)) fail('Snapshot hoặc nguồn chương không hợp lệ.');
  const seen = new Set();
  for (const edit of snapshot) {
    if (!edit || typeof edit.editId !== 'string' || seen.has(edit.editId) || !Number.isSafeInteger(edit.paragraphIndex) || edit.paragraphIndex < 0 || edit.paragraphIndex >= paragraphs.length || !Number.isSafeInteger(edit.startOffset) || !Number.isSafeInteger(edit.endOffset) || edit.startOffset < 0 || edit.endOffset < edit.startOffset || edit.endOffset > paragraphs[edit.paragraphIndex].length || typeof edit.afterText !== 'string' || !Number.isSafeInteger(edit.revisionNumber) || edit.revisionNumber < 1) fail('Snapshot có anchor không hợp lệ; không xuất bản đoán.');
    seen.add(edit.editId);
    if (snapshot.some((other: any) => other !== edit && other.paragraphIndex === edit.paragraphIndex && other.startOffset === edit.startOffset)) fail('Snapshot có anchor trùng; cần duyệt lại.');
  }
  if (!Number.isSafeInteger(row.review_snapshot_version) || row.review_snapshot_version < 1) fail('Thiếu phiên snapshot.');
  const content = buildApprovedChapter(paragraphs, snapshot).map(p => p.text).join('\n\n');
  if (!content.trim() || content.includes('\u0000') || Buffer.byteLength(content) > 1_000_000 || Buffer.byteLength(JSON.stringify(content)) > 3_500_000) fail('Chương trống hoặc lớn hơn giới hạn 1 MB.');
  return content;
}

export async function listExportChapters(req: Request, res: Response) {
  const assignmentId = String(req.query.assignmentId || '');
  if (!assignmentId) { res.status(400).json({ error: 'Chọn một Beta Reader/assignment cụ thể.' }); return; }
  const assignment = await queryOne('SELECT id FROM beta_assignments WHERE id = ? AND book_id = ?', assignmentId, req.params.id);
  if (!assignment) { res.status(404).json({ error: 'Không tìm thấy assignment của truyện.' }); return; }
  // Metadata only: no manuscript bodies or live edit rows are loaded for selection.
  const chapters = await queryAll(`SELECT c.id, c.chapter_index AS "chapterNumber", c.title, r.id AS "reviewId", r.status, r.review_snapshot_version AS "snapshotVersion", r.approved_at AS "approvedAt", c.updated_at AS "sourceUpdatedAt" FROM beta_chapters c LEFT JOIN beta_chapter_reviews r ON r.chapter_id = c.id AND r.assignment_id = ? WHERE c.book_id = ? ORDER BY c.chapter_index`, assignmentId, req.params.id);
  res.setHeader('Cache-Control', 'no-store'); res.json({ chapters });
}

export async function exportApprovedBatch(req: Request, res: Response) {
  const { assignmentId, chapters } = req.body || {};
  if (typeof assignmentId !== 'string' || !Array.isArray(chapters) || chapters.length < 1 || chapters.length > 1 || new Set(chapters.map(c => c?.id)).size !== chapters.length || chapters.some(c => typeof c?.id !== 'string' || c.id.length > 200 || !Number.isSafeInteger(c.snapshotVersion))) {
    res.status(400).json({ error: 'Mỗi lượt xuất cần 1 ID chương và phiên duyệt đã chọn.' }); return;
  }
  const book = await queryOne<any>('SELECT id, title, author FROM beta_books WHERE id = ?', req.params.id);
  const assignment = await queryOne('SELECT id FROM beta_assignments WHERE id = ? AND book_id = ?', assignmentId, req.params.id);
  if (!book || !assignment) { res.status(404).json({ error: 'Truyện/assignment không hợp lệ.' }); return; }
  const ids = chapters.map(c => c.id);
  const rows = await queryAll<any>(`SELECT c.id, c.chapter_index, c.title, c.paragraphs, c.updated_at, r.id AS review_id, r.status, r.approved_at, r.review_snapshot_version, r.approved_edits_snapshot FROM beta_chapters c JOIN beta_chapter_reviews r ON r.chapter_id = c.id AND r.assignment_id = ? WHERE c.book_id = ? AND c.id IN (${ids.map(() => '?').join(',')})`, assignmentId, book.id, ...ids);
  const results = chapters.map(selected => {
    const row = rows.find(r => r.id === selected.id);
    try {
      if (!row || row.review_snapshot_version !== selected.snapshotVersion) fail('Phiên duyệt thay đổi hoặc không tồn tại. Tải lại danh sách.');
      const content = approvedText(row);
      return { sourceChapterId: row.id, chapterNumber: row.chapter_index, title: row.title, approvedReviewId: row.review_id, approvedSnapshotVersion: row.review_snapshot_version, approvedAt: new Date(row.approved_at).toISOString(), content };
    } catch (error: any) { return { sourceChapterId: selected.id, error: error instanceof SyntaxError ? 'Snapshot không đọc được.' : error.message }; }
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ book: { sourceBookId: book.id, title: book.title, author: book.author || '' }, sourceAssignmentId: assignmentId, chapters: results });
}
