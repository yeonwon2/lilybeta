import { createHash, randomUUID } from 'node:crypto';
import { getAdapter } from '../db/database.js';
import type { DatabaseAdapter } from '../db/DatabaseAdapter.js';
import { ChapterService } from '../services/chapterService.js';
import { SyncError, type SyncInput } from './editorContract.js';

const source = () => process.env.EDITOR_SYNC_SOURCE || 'editor.lilyhub.top';
export interface ChapterSyncResult {
  editorChapterId: string;
  betaChapterId: string | null;
  betaChapterIndex: number | null;
  status: 'CREATED' | 'UPDATED' | 'OVERWRITTEN' | 'ALREADY_SYNCED' | 'SOURCE_CONFLICT' | 'STALE_SOURCE' | 'SOURCE_VERSION_CONFLICT';
  contentVersion?: number;
  contentHash?: string;
  sourceHash?: string;
  reason?: string;
}
let sqliteQueue: Promise<unknown> = Promise.resolve();
async function serializedSqlite<T>(operation: () => Promise<T>): Promise<T> {
  const result = sqliteQueue.then(operation, operation);
  sqliteQueue = result.catch(() => {});
  return result;
}

export async function syncEditorBook(input: SyncInput) {
  const adapter = getAdapter();
  const perform = async () => adapter.transaction(async tx => syncTransaction(tx, input));
  try {
    return await (adapter.provider === 'sqlite' ? serializedSqlite(perform) : perform());
  } catch (err: any) {
    if (err.code === '23505' || String(err.message).includes('UNIQUE constraint failed')) {
      throw new SyncError(409, 'SOURCE_IDENTITY_CONFLICT', 'ID nguồn đã được liên kết ở tác phẩm khác; không ghi đè mapping');
    }
    if (['55P03', '57014', '40P01'].includes(err.code)) throw new SyncError(503, 'SYNC_BUSY', 'Đồng bộ đang bận. Có thể thử lại batch này.');
    throw err;
  }
}

async function syncTransaction(tx: DatabaseAdapter, input: SyncInput) {
  const editorSource = source();
  if (tx.provider === 'postgres') {
    await tx.queryOne("SELECT set_config('lock_timeout', '5s', true)");
    await tx.queryOne("SELECT set_config('statement_timeout', '15s', true)");
    // Transaction-scoped, safe with Supabase transaction pooling. Serializes first sync too.
    const hash = createHash('sha256').update(JSON.stringify([editorSource, input.editorBookId])).digest();
    await tx.queryOne('SELECT pg_advisory_xact_lock(?, ?)', hash.readInt32BE(0), hash.readInt32BE(4));
  }
  const admin = await tx.queryOne<any>("SELECT id FROM profiles WHERE id = ? AND role = 'ADMIN' AND is_active = ?", process.env.EDITOR_SYNC_ADMIN_ID, true);
  if (!admin) throw new SyncError(503, 'EDITOR_SYNC_ADMIN_INVALID', 'Cần cấu hình một Admin LilyBeta đang hoạt động cho integration');
  const now = new Date().toISOString();
  let link = await tx.queryOne<any>('SELECT * FROM editor_book_links WHERE editor_source = ? AND editor_book_id = ?', editorSource, input.editorBookId);
  let createdBook = false;
  if (!link) {
    // Never attach by title or accept a client-supplied betaBookId. Manual books remain independent.
    const betaBookId = `book-${randomUUID()}`;
    await tx.run(`INSERT INTO beta_books (id, title, author, original_file_name, file_format, total_chapters, word_count, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'TXT', 0, 0, 'DRAFT', ?, ?, ?)`, betaBookId, input.book.title, input.book.author, 'editor-sync.txt', admin.id, now, now);
    link = { id: `ebl-${randomUUID()}`, beta_book_id: betaBookId, source_total_chapters: input.book.totalChapters ?? null };
    await tx.run(`INSERT INTO editor_book_links (id, editor_source, editor_book_id, beta_book_id, source_total_chapters, sync_state, last_synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PARTIAL', ?, ?, ?)`, link.id, editorSource, input.editorBookId, betaBookId, link.source_total_chapters, now, now, now);
    createdBook = true;
  }
  // Also blocks a concurrent assignment FK insert until this sync commits.
  const book = await tx.queryOne<any>(`SELECT id FROM beta_books WHERE id = ?${tx.provider === 'postgres' ? ' FOR UPDATE' : ''}`, link.beta_book_id);
  if (!book) throw new SyncError(409, 'SOURCE_BOOK_REMOVED', 'Truyện đích đã bị xóa');
  if (input.book.pronounRules !== undefined) {
    await tx.run('UPDATE beta_books SET pronoun_rules = ? WHERE id = ?', JSON.stringify(input.book.pronounRules), book.id);
  }
  if (input.book.contextualPronounRules !== undefined) {
    await tx.run('UPDATE beta_books SET contextual_pronoun_rules = ? WHERE id = ?', JSON.stringify(input.book.contextualPronounRules), book.id);
  }
  const mappings = await tx.queryAll<any>(`SELECT l.*, c.chapter_index, c.content_version, c.content_hash
    FROM editor_chapter_links l JOIN beta_chapters c ON c.id = l.beta_chapter_id WHERE l.book_link_id = ?`, link.id);
  const byId = new Map(mappings.map(m => [m.editor_chapter_id, m]));
  const assigned = await tx.queryOne('SELECT id FROM beta_assignments WHERE book_id = ? LIMIT 1', book.id);
  let nextIndex = Number((await tx.queryOne<any>('SELECT COALESCE(MAX(chapter_index), 0) AS max_index FROM beta_chapters WHERE book_id = ?', book.id))?.max_index) + 1;
  const results: ChapterSyncResult[] = [];
  for (const chapter of input.chapters) {
    const existing = byId.get(chapter.editorChapterId);
    if (!existing) {
      const other = await tx.queryOne('SELECT id FROM editor_chapter_links WHERE editor_source = ? AND editor_chapter_id = ?', editorSource, chapter.editorChapterId);
      if (other) throw new SyncError(409, 'SOURCE_IDENTITY_CONFLICT', 'Chương nguồn đã được liên kết với truyện khác');
      const id = `ch-${randomUUID()}`;
      const index = nextIndex++;
      const hash = ChapterService.computeContentHash(chapter.paragraphs);
      const words = chapter.paragraphs.reduce((sum, p) => sum + (p.trim() ? p.trim().split(/\s+/u).length : 0), 0);
      await tx.run(`INSERT INTO beta_chapters (id, book_id, chapter_index, title, paragraphs, word_count, content_version, content_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, id, book.id, index, chapter.title, JSON.stringify(chapter.paragraphs), words, hash, now, now);
      await tx.run(`INSERT INTO editor_chapter_links (id, book_link_id, editor_source, editor_chapter_id, beta_chapter_id, source_chapter_index, last_editor_version, last_editor_hash, last_editor_updated_at, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, `ecl-${randomUUID()}`, link.id, editorSource, chapter.editorChapterId, id, chapter.chapterIndex, chapter.sourceVersion ?? null, chapter.contentHash, chapter.updatedAt, now);
      results.push({ editorChapterId: chapter.editorChapterId, betaChapterId: id, betaChapterIndex: index, status: 'CREATED', contentVersion: 1, contentHash: hash, sourceHash: chapter.contentHash });
      continue;
    }
    const result: ChapterSyncResult = { editorChapterId: chapter.editorChapterId, betaChapterId: existing.beta_chapter_id, betaChapterIndex: existing.chapter_index, status: 'ALREADY_SYNCED', contentVersion: existing.content_version, contentHash: existing.content_hash, sourceHash: existing.last_editor_hash };
    const incomingTime = Date.parse(chapter.updatedAt);
    const savedTime = Date.parse(existing.last_editor_updated_at);
    if (incomingTime < savedTime) {
      results.push({ ...result, status: 'STALE_SOURCE', reason: 'Nguồn gửi cũ hơn phiên đã đồng bộ' });
      continue;
    }
    const sameContent = existing.last_editor_hash === chapter.contentHash;
    if (!sameContent && (incomingTime === savedTime || (chapter.sourceVersion !== undefined && chapter.sourceVersion === existing.last_editor_version))) {
      await tx.run("UPDATE editor_chapter_links SET last_sync_status = 'SOURCE_VERSION_CONFLICT' WHERE id = ?", existing.id);
      results.push({ ...result, status: 'SOURCE_VERSION_CONFLICT', reason: 'Cùng phiên nguồn nhưng khác nội dung' });
      continue;
    }
    if (!sameContent) {
      const work = await tx.queryOne(`SELECT 1 AS found WHERE
        EXISTS (SELECT 1 FROM beta_edits WHERE chapter_id = ?) OR
        EXISTS (SELECT 1 FROM beta_notes WHERE chapter_id = ?) OR
        EXISTS (SELECT 1 FROM beta_chapter_status WHERE book_id = ? AND chapter_index = ? AND status <> 'NOT_STARTED') OR
        EXISTS (SELECT 1 FROM beta_chapter_reviews WHERE chapter_id = ?)`, existing.beta_chapter_id, existing.beta_chapter_id, book.id, existing.chapter_index, existing.beta_chapter_id);
      // Deliberately conservative: existing clients can hold old cached text without a status row.
      // Freeze source after any assignment (even revoked), avoiding anchor races without changing old APIs.
      if ((work || assigned) && !input.overwriteExisting) {
        await tx.run("UPDATE editor_chapter_links SET last_sync_status = 'SOURCE_CONFLICT' WHERE id = ?", existing.id);
        results.push({ ...result, status: 'SOURCE_CONFLICT', reason: work ? 'BETA_WORK_EXISTS' : 'BOOK_ALREADY_ASSIGNED' });
        continue;
      }
      if (input.overwriteExisting) {
        // Paragraph offsets, approvals and cached progress refer to the old source body.
        // Reset only this chapter's Beta work so stale anchors can never be applied to new text.
        await tx.run('DELETE FROM beta_chapter_reviews WHERE chapter_id = ?', existing.beta_chapter_id);
        await tx.run('DELETE FROM beta_notes WHERE chapter_id = ?', existing.beta_chapter_id);
        await tx.run('DELETE FROM beta_edits WHERE chapter_id = ?', existing.beta_chapter_id);
        await tx.run(`UPDATE beta_chapter_status SET status = 'NOT_STARTED', started_at = NULL, ready_at = NULL, completed_at = NULL, last_scroll_percent = 0, last_scroll_offset = 0, updated_at = ? WHERE chapter_id = ?`, now, existing.beta_chapter_id);
        await tx.run("UPDATE beta_assignments SET status = 'ACTIVE' WHERE book_id = ? AND status = 'COMPLETED'", book.id);
      }
      const hash = ChapterService.computeContentHash(chapter.paragraphs);
      const words = chapter.paragraphs.reduce((sum, p) => sum + (p.trim() ? p.trim().split(/\s+/u).length : 0), 0);
      await tx.run(`UPDATE beta_chapters SET title = ?, paragraphs = ?, word_count = ?, content_version = content_version + 1, content_hash = ?, updated_at = ? WHERE id = ?`, chapter.title, JSON.stringify(chapter.paragraphs), words, hash, now, existing.beta_chapter_id);
      result.status = input.overwriteExisting ? 'OVERWRITTEN' : 'UPDATED';
      result.contentVersion = existing.content_version + 1;
      result.contentHash = hash;
      result.sourceHash = chapter.contentHash;
    }
    // Reordering updates source metadata only; Beta positions/anchors remain stable and dense.
    await tx.run(`UPDATE editor_chapter_links SET last_sync_status = 'SYNCED', source_chapter_index = ?, last_editor_version = ?, last_editor_hash = ?, last_editor_updated_at = ?, last_synced_at = ? WHERE id = ?`, chapter.chapterIndex, chapter.sourceVersion ?? null, chapter.contentHash, chapter.updatedAt, now, existing.id);
    results.push(result);
  }
  const totals = await tx.queryOne<any>('SELECT COUNT(*) AS count, COALESCE(SUM(word_count), 0) AS words FROM beta_chapters WHERE book_id = ?', book.id);
  const count = Number(totals.count);
  const total = Math.max(Number(link.source_total_chapters || 0), input.book.totalChapters || 0) || null;
  const conflict = await tx.queryOne("SELECT id FROM editor_chapter_links WHERE book_link_id = ? AND last_sync_status <> 'SYNCED' LIMIT 1", link.id);
  const state = conflict ? 'CONFLICT' : total !== null && count === total ? 'SYNCED' : 'PARTIAL';
  const changed = results.some(r => ['CREATED', 'UPDATED', 'OVERWRITTEN'].includes(r.status));
  if (changed) {
    await tx.run('UPDATE beta_books SET total_chapters = ?, word_count = ?, updated_at = ? WHERE id = ?', count, Number(totals.words), now, book.id);
    await tx.run(`UPDATE beta_assignment_progress SET completed_chapters_count = (SELECT COUNT(*) FROM beta_chapter_status s WHERE s.assignment_id = beta_assignment_progress.assignment_id AND s.status = 'COMPLETED'), overall_percentage = 100.0 * (SELECT COUNT(*) FROM beta_chapter_status s WHERE s.assignment_id = beta_assignment_progress.assignment_id AND s.status = 'COMPLETED') / ?, updated_at = ? WHERE book_id = ?`, count, now, book.id);
    await tx.run('INSERT INTO beta_activity_logs (id, user_id, action, book_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)', `log-${randomUUID()}`, admin.id, 'EDITOR_SYNC', book.id, JSON.stringify({ created: results.filter(r => r.status === 'CREATED').length, updated: results.filter(r => r.status === 'UPDATED').length, overwritten: results.filter(r => r.status === 'OVERWRITTEN').length }), now);
  }
  await tx.run('UPDATE editor_book_links SET source_total_chapters = ?, sync_state = ?, last_synced_at = ?, updated_at = ? WHERE id = ?', total, state, now, now, link.id);
  return { betaBookId: book.id as string, createdBook, sourceType: 'EDITOR_SYNC', syncState: state, totalChapters: count, sourceTotalChapters: total, results };
}

export async function getEditorSyncState(editorBookId: string) {
  const tx = getAdapter();
  const link = await tx.queryOne<any>('SELECT * FROM editor_book_links WHERE editor_source = ? AND editor_book_id = ?', source(), editorBookId);
  if (!link) return { betaBookId: null, syncState: 'NOT_SYNCED', chapters: [] };
  const chapters = await tx.queryAll(`SELECT l.editor_chapter_id AS "editorChapterId", l.source_chapter_index AS "sourceChapterIndex", l.last_editor_hash AS "contentHash", l.last_editor_updated_at AS "updatedAt", l.last_editor_version AS "sourceVersion", l.last_sync_status AS "syncStatus", c.id AS "betaChapterId", c.chapter_index AS "betaChapterIndex", c.content_version AS "contentVersion"
    FROM editor_chapter_links l JOIN beta_chapters c ON c.id = l.beta_chapter_id WHERE l.book_link_id = ? ORDER BY c.chapter_index`, link.id);
  return { betaBookId: link.beta_book_id, syncState: link.sync_state, totalChapters: chapters.length, sourceTotalChapters: link.source_total_chapters, chapters };
}
