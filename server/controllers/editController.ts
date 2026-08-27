import { Request, Response } from 'express';
import { queryAll, queryOne, run, transaction } from '../db/database.js';

const VALID_ERROR_TYPES = new Set([
  'XUNG_HO',
  'DICH_SAI',
  'CAU_TOI_NGHIA',
  'NGU_PHAP',
  'TYPO',
  'DAU_CAU',
  'TEN_RIENG',
  'VAN_PHONG',
  'CONSISTENCY',
  'FORMATTING',
  'OTHER',
]);

/**
 * List all edits for the current chapter and assignment.
 */
export const listChapterEdits = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params; // bookId, chapterIndex
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);

  if (isNaN(chapterNum) || chapterNum < 1) {
    res.status(400).json({ error: 'Chỉ số chương không hợp lệ' });
    return;
  }

  if (user.role === 'ADMIN') {
    const edits = await queryAll<any>(`
      SELECT 
        e.*,
        p.username AS userName,
        p.display_name AS userDisplayName
      FROM beta_edits e
      JOIN profiles p ON p.id = e.beta_user_id
      WHERE e.book_id = ? AND e.chapter_index = ?
      ORDER BY e.paragraph_index ASC, e.start_offset ASC
    `, id, chapterNum);

    res.json({ edits: await formatEdits(edits) });
    return;
  }

  // Beta Reader: strictly own assignment
  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Bạn không có phân công hoạt động đối với tác phẩm này' });
    return;
  }

  const edits = await queryAll<any>(`
    SELECT * FROM beta_edits 
    WHERE assignment_id = ? AND chapter_index = ? AND status = 'ACTIVE'
    ORDER BY paragraph_index ASC, start_offset ASC
  `, assignment.id, chapterNum);

  res.json({ edits: await formatEdits(edits) });
};

/**
 * Create a new paragraph-anchored edit with Revision 1.
 */
export const createEdit = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params; // bookId, chapterIndex
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);

  const {
    paragraphIndex,
    startOffset,
    endOffset,
    originalText,
    proposedText,
    errorType,
    reason,
  } = req.body;

  // 1. Resolve active assignment
  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Bạn không có phân công hoạt động đối với tác phẩm này' });
    return;
  }

  // 2. Validate chapter existence
  const chapter = await queryOne<any>(
    'SELECT id, paragraphs FROM beta_chapters WHERE book_id = ? AND chapter_index = ?',
    id,
    chapterNum
  );

  if (!chapter) {
    res.status(404).json({ error: 'Không tìm thấy chương' });
    return;
  }

  let paragraphs: string[] = [];
  if (Array.isArray(chapter.paragraphs)) {
    paragraphs = chapter.paragraphs;
  } else if (typeof chapter.paragraphs === 'string') {
    try {
      paragraphs = JSON.parse(chapter.paragraphs);
    } catch {
      paragraphs = [chapter.paragraphs];
    }
  }

  const pIdx = parseInt(String(paragraphIndex), 10);
  if (isNaN(pIdx) || pIdx < 0 || pIdx >= paragraphs.length) {
    res.status(400).json({ error: 'Chỉ số đoạn văn không hợp lệ' });
    return;
  }

  const paragraph = paragraphs[pIdx];
  const start = parseInt(String(startOffset), 10);
  const end = parseInt(String(endOffset), 10);

  if (isNaN(start) || isNaN(end) || start < 0 || end > paragraph.length || start >= end) {
    res.status(400).json({ error: 'Khoảng bôi chọn không hợp lệ' });
    return;
  }

  // 3. Server-side slice check (prevent anchor stale)
  const actualSlice = paragraph.slice(start, end);
  if (actualSlice !== originalText) {
    res.status(409).json({
      error: 'Vị trí văn bản gốc không khớp với bản thảo (Anchor mismatch).',
      code: 'EDIT_ANCHOR_STALE',
    });
    return;
  }

  // 4. Validate non-empty & change
  const cleanProposed = String(proposedText || '').trim();
  if (!cleanProposed) {
    res.status(400).json({ error: 'Nội dung sửa không được để trống' });
    return;
  }

  if (cleanProposed === originalText.trim()) {
    res.status(400).json({ error: 'Nội dung sửa không có thay đổi so với bản gốc' });
    return;
  }

  // 5. Validate error type
  if (!VALID_ERROR_TYPES.has(errorType)) {
    res.status(400).json({ error: 'Loại lỗi không hợp lệ' });
    return;
  }

  // 6. Overlap collision check with active edits
  const existingEdits = await queryAll<any>(
    `SELECT id, start_offset AS startOffset, end_offset AS endOffset
     FROM beta_edits 
     WHERE assignment_id = ? AND chapter_index = ? AND paragraph_index = ? AND status = 'ACTIVE'`,
    assignment.id,
    chapterNum,
    pIdx
  );

  for (const ex of existingEdits) {
    if (Math.max(start, ex.startOffset) < Math.min(end, ex.endOffset)) {
      res.status(409).json({
        error: 'Đoạn bạn chọn đang giao với một chỉnh sửa khác. Hãy sửa chỉnh sửa hiện có hoặc chọn vùng khác.',
        code: 'EDIT_OVERLAP',
      });
      return;
    }
  }

  // 7. Context anchoring
  const prefixContext = paragraph.slice(Math.max(0, start - 35), start);
  const suffixContext = paragraph.slice(end, Math.min(paragraph.length, end + 35));
  const editId = `edit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const revId = `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await transaction(async () => {
    // Insert edit row
    await run(
      `INSERT INTO beta_edits (
        id, assignment_id, book_id, chapter_id, chapter_index, beta_user_id,
        paragraph_index, start_offset, end_offset, original_text, current_text,
        prefix_context, suffix_context, error_type, reason, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`,
      editId,
      assignment.id,
      id,
      chapter.id,
      chapterNum,
      user.id,
      pIdx,
      start,
      end,
      originalText,
      cleanProposed,
      prefixContext,
      suffixContext,
      errorType,
      reason ? String(reason).trim() : null,
      now,
      now
    );

    // Insert Revision 1
    await run(
      `INSERT INTO beta_edit_revisions (
        id, edit_id, revision_number, before_text, after_text,
        error_type_before, error_type_after, reason_before, reason_after, changed_by, created_at
      ) VALUES (?, ?, 1, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
      revId,
      editId,
      originalText,
      cleanProposed,
      errorType,
      reason ? String(reason).trim() : null,
      user.id,
      now
    );

    // If chapter was COMPLETED, transition back to IN_PROGRESS!
    const chapterStatus = await queryOne<any>(
      'SELECT status FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );

    if (chapterStatus && chapterStatus.status === 'COMPLETED') {
      await run(
        `UPDATE beta_chapter_status SET status = 'IN_PROGRESS', updated_at = ? WHERE assignment_id = ? AND chapter_index = ?`,
        now,
        assignment.id,
        chapterNum
      );

      // Recalculate completed count
      const countRes = await queryOne<any>(
        `SELECT COUNT(id) AS count FROM beta_chapter_status WHERE assignment_id = ? AND status = 'COMPLETED'`,
        assignment.id
      );
      const totalBook = await queryOne<any>('SELECT total_chapters FROM beta_books WHERE id = ?', id);
      const total = totalBook?.total_chapters || 1;
      const completed = countRes?.count || 0;
      const pct = Math.min(100, Math.round((completed / total) * 1000) / 10);

      await run(
        `UPDATE beta_assignment_progress 
         SET completed_chapters_count = ?, overall_percentage = ?, updated_at = ?
         WHERE assignment_id = ?`,
        completed,
        pct,
        now,
        assignment.id
      );
    }

    // Invalidate chapter approval if chapter was APPROVED
    const chapterReview = await queryOne<any>(
      'SELECT id, status FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );
    if (chapterReview && chapterReview.status === 'APPROVED') {
      await run(
        `UPDATE beta_chapter_reviews SET status = 'REOPENED', updated_at = ? WHERE id = ?`,
        now,
        chapterReview.id
      );
      const logReopenId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await run(
        'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        logReopenId,
        user.id,
        'CHAPTER_REOPENED',
        id,
        chapter.id,
        JSON.stringify({ reason: 'BETA_EDIT_CREATED_POST_APPROVAL', chapterIndex: chapterNum, editId }),
        now
      );
    }

    // Activity log for edit creation
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      logId,
      user.id,
      'EDIT_PROPOSED',
      id,
      chapter.id,
      JSON.stringify({ editId, chapterIndex: chapterNum, paragraphIndex: pIdx, errorType }),
      now
    );
  });

  const created = await queryOne<any>('SELECT * FROM beta_edits WHERE id = ?', editId);
  res.status(201).json({ edit: await formatEdit(created) });
};

/**
 * Update an existing edit (creates next revision).
 * Enforces atomic optimistic locking via UPDATE ... WHERE id = ? AND version = ?
 */
export const updateEdit = async (req: Request, res: Response): Promise<void> => {
  const { id, index, editId } = req.params;
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);
  const { proposedText, errorType, reason, expectedVersion } = req.body;

  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Bạn không có quyền sửa đổi bản thảo này' });
    return;
  }

  const edit = await queryOne<any>(
    'SELECT * FROM beta_edits WHERE id = ? AND assignment_id = ? AND beta_user_id = ?',
    editId,
    assignment.id,
    user.id
  );

  if (!edit) {
    res.status(404).json({ error: 'Không tìm thấy bản sửa' });
    return;
  }

  if (edit.status !== 'ACTIVE') {
    res.status(400).json({ error: 'Bản sửa này đã bị xóa hoặc không còn hiệu lực' });
    return;
  }

  // Pre-check optimistic version if supplied
  if (expectedVersion !== undefined && edit.version !== parseInt(String(expectedVersion), 10)) {
    res.status(409).json({
      error: 'Bản sửa đã được cập nhật bởi một phiên làm việc khác.',
      code: 'EDIT_CONFLICT',
    });
    return;
  }

  const cleanProposed = String(proposedText || '').trim();
  if (!cleanProposed) {
    res.status(400).json({ error: 'Nội dung sửa không được để trống' });
    return;
  }

  if (!VALID_ERROR_TYPES.has(errorType)) {
    res.status(400).json({ error: 'Loại lỗi không hợp lệ' });
    return;
  }

  const targetVersion = expectedVersion !== undefined ? parseInt(String(expectedVersion), 10) : edit.version;
  const nextVersion = edit.version + 1;
  const revId = `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  let updateConflict = false;

  await transaction(async () => {
    // 1. Atomic optimistic lock update on beta_edits
    const updateRes = await run(
      `UPDATE beta_edits SET
        current_text = ?,
        error_type = ?,
        reason = ?,
        version = version + 1,
        updated_at = ?
       WHERE id = ? AND version = ?`,
      cleanProposed,
      errorType,
      reason ? String(reason).trim() : null,
      now,
      editId,
      targetVersion
    );

    if (updateRes.changes === 0) {
      updateConflict = true;
      return;
    }

    // 2. Insert new revision
    await run(
      `INSERT INTO beta_edit_revisions (
        id, edit_id, revision_number, before_text, after_text,
        error_type_before, error_type_after, reason_before, reason_after, changed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      revId,
      editId,
      nextVersion,
      edit.current_text,
      cleanProposed,
      edit.error_type,
      errorType,
      edit.reason,
      reason ? String(reason).trim() : null,
      user.id,
      now
    );

    // 3. If chapter was COMPLETED, transition back to IN_PROGRESS
    const chapterStatus = await queryOne<any>(
      'SELECT status FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );

    if (chapterStatus && chapterStatus.status === 'COMPLETED') {
      await run(
        `UPDATE beta_chapter_status SET status = 'IN_PROGRESS', updated_at = ? WHERE assignment_id = ? AND chapter_index = ?`,
        now,
        assignment.id,
        chapterNum
      );
    }

    // Invalidate chapter approval if chapter was APPROVED
    const chapterReview = await queryOne<any>(
      'SELECT id, status FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );
    if (chapterReview && chapterReview.status === 'APPROVED') {
      await run(
        `UPDATE beta_chapter_reviews SET status = 'REOPENED', updated_at = ? WHERE id = ?`,
        now,
        chapterReview.id
      );
      const logReopenId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await run(
        'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        logReopenId,
        user.id,
        'CHAPTER_REOPENED',
        id,
        edit.chapter_id,
        JSON.stringify({ reason: 'BETA_EDIT_UPDATED_POST_APPROVAL', chapterIndex: chapterNum, editId }),
        now
      );
    }
  });

  if (updateConflict) {
    res.status(409).json({
      error: 'Bản sửa đã được cập nhật bởi một phiên làm việc khác.',
      code: 'EDIT_CONFLICT',
    });
    return;
  }

  const updated = await queryOne<any>('SELECT * FROM beta_edits WHERE id = ?', editId);
  res.json({ success: true, edit: await formatEdit(updated) });
};

/**
 * Revert / Delete an edit (marks status = 'REVERTED').
 */
export const deleteEdit = async (req: Request, res: Response): Promise<void> => {
  const { id, editId } = req.params;
  const user = req.user!;

  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này' });
    return;
  }

  const edit = await queryOne<any>(
    'SELECT * FROM beta_edits WHERE id = ? AND assignment_id = ? AND beta_user_id = ?',
    editId,
    assignment.id,
    user.id
  );

  if (!edit) {
    res.status(404).json({ error: 'Không tìm thấy bản sửa' });
    return;
  }

  const nextVersion = edit.version + 1;
  const revId = `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await transaction(async () => {
    // Insert reversion revision
    await run(
      `INSERT INTO beta_edit_revisions (
        id, edit_id, revision_number, before_text, after_text,
        error_type_before, error_type_after, reason_before, reason_after, changed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Đã hoàn tác chỉnh sửa (Reverted)', ?, ?)`,
      revId,
      editId,
      nextVersion,
      edit.current_text,
      edit.original_text,
      edit.error_type,
      edit.error_type,
      edit.reason,
      user.id,
      now
    );

    // Soft delete edit
    await run(
      `UPDATE beta_edits SET status = 'DELETED', version = ?, updated_at = ? WHERE id = ?`,
      nextVersion,
      now,
      editId
    );
  });

  res.json({ success: true, message: 'Đã hoàn tác chỉnh sửa thành công' });
};

/**
 * Get all revision steps for an edit.
 */
export const getEditRevisions = async (req: Request, res: Response): Promise<void> => {
  const { editId } = req.params;
  const user = req.user!;

  const edit = await queryOne<any>('SELECT * FROM beta_edits WHERE id = ?', editId);
  if (!edit) {
    res.status(404).json({ error: 'Không tìm thấy bản sửa' });
    return;
  }

  if (user.role !== 'ADMIN' && edit.beta_user_id !== user.id) {
    res.status(403).json({ error: 'Bạn không có quyền xem lịch sử sửa đổi này' });
    return;
  }

  const revisions = await queryAll<any>(`
    SELECT 
      r.id,
      r.edit_id AS editId,
      r.revision_number AS revisionNumber,
      r.before_text AS beforeText,
      r.after_text AS afterText,
      r.error_type_before AS errorTypeBefore,
      r.error_type_after AS errorTypeAfter,
      r.reason_before AS reasonBefore,
      r.reason_after AS reasonAfter,
      r.changed_by AS changedBy,
      r.created_at AS createdAt,
      p.display_name AS changedByName
    FROM beta_edit_revisions r
    JOIN profiles p ON p.id = r.changed_by
    WHERE r.edit_id = ?
    ORDER BY r.revision_number ASC
  `, editId);

  res.json({ revisions });
};

/**
 * Notes CRUD
 */
export const listChapterNotes = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params;
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);

  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment && user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Không có quyền truy cập' });
    return;
  }

  const notes = await queryAll<any>(`
    SELECT 
      id,
      assignment_id AS assignmentId,
      book_id AS bookId,
      chapter_id AS chapterId,
      chapter_index AS chapterIndex,
      beta_user_id AS betaUserId,
      paragraph_index AS paragraphIndex,
      start_offset AS startOffset,
      end_offset AS endOffset,
      selected_text AS selectedText,
      note,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM beta_notes
    WHERE book_id = ? AND chapter_index = ? AND beta_user_id = ?
    ORDER BY paragraph_index ASC, start_offset ASC
  `, id, chapterNum, user.id);

  res.json({ notes });
};

export const createNote = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params;
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);
  const { paragraphIndex, startOffset, endOffset, selectedText, note } = req.body;

  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Không có quyền ghi chú' });
    return;
  }

  const chapter = await queryOne<any>('SELECT id FROM beta_chapters WHERE book_id = ? AND chapter_index = ?', id, chapterNum);
  if (!chapter) {
    res.status(404).json({ error: 'Chương không tồn tại' });
    return;
  }

  const cleanNote = String(note || '').trim();
  if (!cleanNote) {
    res.status(400).json({ error: 'Nội dung ghi chú không được để trống' });
    return;
  }

  const noteId = `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await run(
    `INSERT INTO beta_notes (
      id, assignment_id, book_id, chapter_id, chapter_index, beta_user_id,
      paragraph_index, start_offset, end_offset, selected_text, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    noteId,
    assignment.id,
    id,
    chapter.id,
    chapterNum,
    user.id,
    parseInt(String(paragraphIndex), 10) || 0,
    parseInt(String(startOffset), 10) || 0,
    parseInt(String(endOffset), 10) || 0,
    selectedText || null,
    cleanNote,
    now,
    now
  );

  res.status(201).json({
    note: {
      id: noteId,
      assignmentId: assignment.id,
      bookId: id,
      chapterId: chapter.id,
      chapterIndex: chapterNum,
      betaUserId: user.id,
      paragraphIndex: parseInt(String(paragraphIndex), 10) || 0,
      startOffset: parseInt(String(startOffset), 10) || 0,
      endOffset: parseInt(String(endOffset), 10) || 0,
      selectedText,
      note: cleanNote,
      createdAt: now,
      updatedAt: now,
    },
  });
};

export const deleteNote = async (req: Request, res: Response): Promise<void> => {
  const { noteId } = req.params;
  const user = req.user!;

  await run('DELETE FROM beta_notes WHERE id = ? AND beta_user_id = ?', noteId, user.id);
  res.json({ success: true, message: 'Đã xóa ghi chú' });
};

/**
 * Admin Inspector: List all edits for a book across all Beta Readers and chapters.
 */
export const listAdminBookEdits = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params; // bookId

  const edits = await queryAll<any>(`
    SELECT 
      e.*,
      p.username AS userName,
      p.display_name AS userDisplayName,
      (SELECT COUNT(r.id) FROM beta_edit_revisions r WHERE r.edit_id = e.id) AS revisionCount
    FROM beta_edits e
    JOIN profiles p ON p.id = e.beta_user_id
    WHERE e.book_id = ?
    ORDER BY e.created_at DESC
  `, id);

  res.json({ edits: await formatEdits(edits) });
};

// Helpers
async function formatEdit(e: any) {
  if (!e) return null;
  const formatted = await formatEdits([e]);
  return formatted[0] || null;
}

async function formatEdits(list: any[]) {
  if (!list || list.length === 0) return [];
  const editIds = list.map(e => e.id);
  const placeholders = editIds.map(() => '?').join(',');

  const reviews = await queryAll<any>(`
    SELECT r.edit_id, r.decision, r.comment, r.reviewed_revision_number AS reviewedRevisionNumber,
           p.display_name AS reviewerDisplayName, r.created_at AS reviewCreatedAt
    FROM beta_edit_reviews r
    LEFT JOIN profiles p ON p.id = r.reviewer_id
    WHERE r.edit_id IN (${placeholders})
    ORDER BY r.created_at DESC
  `, ...editIds);

  const latestReviewMap: Record<string, any> = {};
  for (const r of reviews) {
    if (!latestReviewMap[r.edit_id]) {
      latestReviewMap[r.edit_id] = r;
    }
  }

  return list.map(e => {
    const latestReview = latestReviewMap[e.id] || null;
    const isCurrentReview = latestReview && latestReview.reviewedRevisionNumber === e.version;

    return {
      id: e.id,
      assignmentId: e.assignment_id,
      bookId: e.book_id,
      chapterId: e.chapter_id,
      chapterIndex: e.chapter_index,
      betaUserId: e.beta_user_id,
      paragraphIndex: e.paragraph_index,
      startOffset: e.start_offset,
      endOffset: e.end_offset,
      originalText: e.original_text,
      currentText: e.current_text,
      prefixContext: e.prefix_context,
      suffixContext: e.suffix_context,
      errorType: e.error_type,
      reason: e.reason,
      status: e.status,
      version: e.version,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      userName: e.userName,
      userDisplayName: e.userDisplayName,
      revisionCount: e.revisionCount,
      reviewStatus: isCurrentReview ? latestReview.decision : 'PENDING',
      reviewComment: latestReview?.comment || null,
      reviewerDisplayName: latestReview?.reviewerDisplayName || null,
      isStaleReview: latestReview ? latestReview.reviewedRevisionNumber !== e.version : false,
      reviewedRevisionNumber: latestReview?.reviewedRevisionNumber || null,
    };
  });
}
