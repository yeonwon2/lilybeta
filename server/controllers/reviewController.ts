import type { ChapterReviewDetailResponse } from '../../src/beta-review/reviewTypes.js';
import { Request, Response } from 'express';
import { queryAll, queryOne, run, transaction } from '../db/database.js';
import { buildApprovedChapter, checkAcceptedOverlaps, ApprovedVersionConflictError } from '../../src/beta-review/approvedVersion.js';
import { AcceptedRevisionItem, ChapterReviewStatus, DerivedReviewStatus } from '../../src/beta-review/reviewTypes.js';

/**
 * Review Controller for LilyBeta Phase 4 & Phase 5
 * 
 * Handles:
 * 1. Overview and aggregation of review statistics per book and assignment (zero N+1 queries).
 * 2. Detailed chapter review payload (Original, Working Version edits, Approved Version).
 * 3. Exact-revision bound edit reviews (Accept, Reject, Request Changes) with stale protection.
 * 4. Chapter approval snapshot creation and invalidation/reopening.
 * 5. Note resolution.
 */

export const getBookReviewOverview = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params; // bookId

  const book = await queryOne<any>('SELECT * FROM beta_books WHERE id = ?', id);
  if (!book) {
    res.status(404).json({ error: 'Không tìm thấy tác phẩm' });
    return;
  }

  // Fetch all assignments for this book
  const assignments = await queryAll<any>(`
    SELECT 
      ba.id AS assignmentId,
      ba.beta_user_id AS betaUserId,
      ba.status AS assignmentStatus,
      p.username AS betaUserName,
      p.display_name AS betaDisplayName,
      COALESCE(ap.completed_chapters_count, 0) AS completedChapters,
      COALESCE(ap.overall_percentage, 0) AS progressPercent
    FROM beta_assignments ba
    JOIN profiles p ON p.id = ba.beta_user_id
    LEFT JOIN beta_assignment_progress ap ON ap.assignment_id = ba.id
    WHERE ba.book_id = ? AND ba.status = 'ACTIVE'
    ORDER BY ba.assigned_at ASC
  `, id);

  // For each assignment, aggregate review metrics
  const assignmentOverviews = await Promise.all(assignments.map(async (assign) => {
    // 1. Chapters review overview (Query 1)
    const chapters = await queryAll<any>(`
      SELECT 
        c.chapter_index AS chapterIndex,
        c.title AS chapterTitle,
        c.word_count AS wordCount,
        COALESCE(cs.status, 'NOT_STARTED') AS betaStatus,
        cr.status AS approvalStatus,
        cr.approved_at AS approvedAt
      FROM beta_chapters c
      LEFT JOIN beta_chapter_status cs ON cs.chapter_id = c.id AND cs.assignment_id = ?
      LEFT JOIN beta_chapter_reviews cr ON cr.chapter_id = c.id AND cr.assignment_id = ?
      WHERE c.book_id = ?
      ORDER BY c.chapter_index ASC
    `, assign.assignmentId, assign.assignmentId, id);

    // 2. Single SQL Aggregate Query for all edits across all chapters (Query 2)
    const editsAggRows = await queryAll<any>(`
      SELECT 
        e.chapter_index AS chapterIndex,
        COUNT(e.id) AS totalEdits,
        SUM(CASE WHEN r.decision = 'ACCEPTED' THEN 1 ELSE 0 END) AS acceptedEdits,
        SUM(CASE WHEN r.decision = 'REJECTED' THEN 1 ELSE 0 END) AS rejectedEdits,
        SUM(CASE WHEN r.decision = 'CHANGES_REQUESTED' THEN 1 ELSE 0 END) AS changesRequestedEdits,
        SUM(CASE WHEN r.decision IS NULL THEN 1 ELSE 0 END) AS pendingEdits
      FROM beta_edits e
      LEFT JOIN (
        SELECT r1.edit_id, r1.reviewed_revision_number, r1.decision
        FROM beta_edit_reviews r1
        INNER JOIN (
          SELECT edit_id, reviewed_revision_number, MAX(created_at) AS max_created
          FROM beta_edit_reviews
          GROUP BY edit_id, reviewed_revision_number
        ) r2 ON r1.edit_id = r2.edit_id 
            AND r1.reviewed_revision_number = r2.reviewed_revision_number 
            AND r1.created_at = r2.max_created
      ) r ON r.edit_id = e.id AND r.reviewed_revision_number = e.version
      WHERE e.assignment_id = ? AND e.status = 'ACTIVE'
      GROUP BY e.chapter_index
    `, assign.assignmentId);

    const editsAggMap: Record<number, any> = {};
    let totalEdits = 0;
    let accepted = 0;
    let rejected = 0;
    let changesRequested = 0;
    let pending = 0;

    for (const row of editsAggRows) {
      editsAggMap[row.chapterIndex] = row;
      totalEdits += Number(row.totalEdits) || 0;
      accepted += Number(row.acceptedEdits) || 0;
      rejected += Number(row.rejectedEdits) || 0;
      changesRequested += Number(row.changesRequestedEdits) || 0;
      pending += Number(row.pendingEdits) || 0;
    }

    const chapterSummaries = chapters.map((ch) => {
      const agg = editsAggMap[ch.chapterIndex] || {
        totalEdits: 0,
        acceptedEdits: 0,
        rejectedEdits: 0,
        changesRequestedEdits: 0,
        pendingEdits: 0,
      };

      const chPending = Number(agg.pendingEdits) || 0;
      const chAccepted = Number(agg.acceptedEdits) || 0;
      const chRejected = Number(agg.rejectedEdits) || 0;
      const chChanges = Number(agg.changesRequestedEdits) || 0;
      const chTotal = Number(agg.totalEdits) || 0;

      let reviewStatus: ChapterReviewStatus = 'NOT_READY';
      if (ch.approvalStatus === 'APPROVED') {
        reviewStatus = 'APPROVED';
      } else if (ch.approvalStatus === 'REOPENED') {
        reviewStatus = 'REOPENED';
      } else if (ch.betaStatus !== 'COMPLETED') {
        reviewStatus = 'NOT_READY';
      } else if (chChanges > 0) {
        reviewStatus = 'CHANGES_REQUESTED';
      } else if (chPending > 0) {
        reviewStatus = 'NEEDS_REVIEW';
      } else {
        reviewStatus = 'REVIEWED';
      }

      return {
        chapterIndex: ch.chapterIndex,
        chapterTitle: ch.chapterTitle,
        wordCount: ch.wordCount,
        isBetaCompleted: ch.betaStatus === 'COMPLETED',
        totalEdits: chTotal,
        pendingEdits: chPending,
        acceptedEdits: chAccepted,
        rejectedEdits: chRejected,
        changesRequestedEdits: chChanges,
        reviewStatus,
        approvedAt: ch.approvedAt,
      };
    });

    return {
      assignmentId: assign.assignmentId,
      betaUserId: assign.betaUserId,
      betaUserName: assign.betaUserName,
      betaDisplayName: assign.betaDisplayName,
      completedChapters: assign.completedChapters,
      totalChapters: book.total_chapters,
      progressPercent: assign.progressPercent,
      totalEdits,
      acceptedEdits: accepted,
      pendingEdits: pending,
      rejectedEdits: rejected,
      changesRequestedEdits: changesRequested,
      chapters: chapterSummaries,
    };
  }));

  res.json({
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      totalChapters: book.total_chapters,
      wordCount: book.word_count,
    },
    assignments: assignmentOverviews,
  });
};

/**
 * Detailed Chapter Review Workspace Data
 */
export const getChapterReviewDetail = async (req: Request, res: Response): Promise<void> => {
  const { id, assignmentId, index } = req.params;
  const chapterNum = parseInt(String(index), 10);

  if (isNaN(chapterNum) || chapterNum < 1) {
    res.status(400).json({ error: 'Chỉ số chương không hợp lệ' });
    return;
  }

  const book = await queryOne<any>('SELECT * FROM beta_books WHERE id = ?', id);
  if (!book) {
    res.status(404).json({ error: 'Không tìm thấy tác phẩm' });
    return;
  }

  const assignment = await queryOne<any>(`
    SELECT ba.*, p.username AS betaUserName, p.display_name AS betaDisplayName
    FROM beta_assignments ba
    JOIN profiles p ON p.id = ba.beta_user_id
    WHERE ba.id = ? AND ba.book_id = ?
  `, assignmentId, id);

  if (!assignment) {
    res.status(404).json({ error: 'Không tìm thấy phân công beta reader' });
    return;
  }

  const chapter = await queryOne<any>(
    'SELECT * FROM beta_chapters WHERE book_id = ? AND chapter_index = ?',
    id,
    chapterNum
  );

  if (!chapter) {
    res.status(404).json({ error: 'Không tìm thấy chương' });
    return;
  }

  let originalParagraphs: string[] = [];
  if (Array.isArray(chapter.paragraphs)) {
    originalParagraphs = chapter.paragraphs;
  } else if (typeof chapter.paragraphs === 'string') {
    try {
      originalParagraphs = JSON.parse(chapter.paragraphs);
    } catch {
      originalParagraphs = [chapter.paragraphs];
    }
  }

  // Get all edits for this chapter
  const rawEdits = await queryAll<any>(`
    SELECT e.*, p.username AS betaUserName, p.display_name AS betaDisplayName
    FROM beta_edits e
    JOIN profiles p ON p.id = e.beta_user_id
    WHERE e.assignment_id = ? AND e.chapter_index = ? AND e.status = 'ACTIVE'
    ORDER BY e.paragraph_index ASC, e.start_offset ASC
  `, assignmentId, chapterNum);

  const editIds = rawEdits.map((e) => e.id);
  let allRevisions: any[] = [];
  let allReviews: any[] = [];

  if (editIds.length > 0) {
    const placeholders = editIds.map(() => '?').join(',');
    allRevisions = await queryAll<any>(`
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
      WHERE r.edit_id IN (${placeholders})
      ORDER BY r.revision_number ASC
    `, ...editIds);

    allReviews = await queryAll<any>(`
      SELECT 
        rev.id,
        rev.edit_id AS editId,
        rev.reviewer_id AS reviewerId,
        rev.decision,
        rev.comment,
        rev.reviewed_revision_number AS reviewedRevisionNumber,
        rev.reviewed_edit_version AS reviewedEditVersion,
        rev.created_at AS createdAt,
        p.display_name AS reviewerDisplayName
      FROM beta_edit_reviews rev
      JOIN profiles p ON p.id = rev.reviewer_id
      WHERE rev.edit_id IN (${placeholders})
      ORDER BY rev.created_at ASC
    `, ...editIds);
  }

  const revisionsByEditId: Record<string, any[]> = {};
  for (const rev of allRevisions) {
    if (!revisionsByEditId[rev.editId]) revisionsByEditId[rev.editId] = [];
    revisionsByEditId[rev.editId].push(rev);
  }

  const reviewsByEditId: Record<string, any[]> = {};
  for (const rev of allReviews) {
    if (!reviewsByEditId[rev.editId]) reviewsByEditId[rev.editId] = [];
    reviewsByEditId[rev.editId].push(rev);
  }

  const acceptedRevisionItems: AcceptedRevisionItem[] = [];

  const edits = rawEdits.map((e) => {
    const revisions = revisionsByEditId[e.id] || [];
    const reviews = reviewsByEditId[e.id] || [];

    // Latest review on current revision
    const currentReview = reviews
      .filter((r) => r.reviewedRevisionNumber === e.version)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

    const derivedReviewStatus: DerivedReviewStatus = currentReview
      ? currentReview.decision
      : 'PENDING';

    // Find latest ACCEPTED review across all revisions of this edit
    const latestAcceptedReview = reviews
      .filter((r) => r.decision === 'ACCEPTED')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;

    let acceptedRevision: any = null;
    if (latestAcceptedReview) {
      const targetRev = revisions.find(
        (r) => r.revisionNumber === latestAcceptedReview.reviewedRevisionNumber
      );
      if (targetRev) {
        acceptedRevision = targetRev;
        acceptedRevisionItems.push({
          editId: e.id,
          paragraphIndex: e.paragraph_index,
          startOffset: e.start_offset,
          endOffset: e.end_offset,
          revisionNumber: targetRev.revisionNumber,
          afterText: targetRev.afterText,
          errorType: e.error_type,
        });
      }
    }

    return {
      id: e.id,
      assignmentId: e.assignment_id,
      bookId: e.book_id,
      chapterId: e.chapter_id,
      chapterIndex: e.chapter_index,
      betaUserId: e.beta_user_id,
      betaUserName: e.betaUserName,
      betaDisplayName: e.betaDisplayName,
      paragraphIndex: e.paragraph_index,
      startOffset: e.start_offset,
      endOffset: e.end_offset,
      originalText: e.original_text,
      currentText: e.current_text,
      errorType: e.error_type,
      reason: e.reason,
      status: e.status,
      version: e.version,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      revisions,
      reviews,
      currentReview,
      derivedReviewStatus,
      reviewStatus: derivedReviewStatus,
      acceptedRevision,
    };
  });

  // Chapter status and approval
  const chapterStatus = await queryOne<any>(
    'SELECT * FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
    assignmentId,
    chapterNum
  );

  const chapterReview = await queryOne<any>(
    'SELECT * FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',
    assignmentId,
    chapterNum
  );

  // Notes
  const notes = await queryAll<any>(`
    SELECT 
      n.id, n.paragraph_index AS paragraphIndex, n.start_offset AS startOffset,
      n.end_offset AS endOffset, n.selected_text AS selectedText, n.note,
      n.status, n.created_at AS createdAt, p.display_name AS resolvedByName
    FROM beta_notes n
    LEFT JOIN profiles p ON p.id = n.resolved_by
    WHERE n.assignment_id = ? AND n.chapter_index = ?
    ORDER BY n.paragraph_index ASC
  `, assignmentId, chapterNum);

  // Compute approved paragraphs
  let approvedParagraphs: any[] = [];
  let approvedConflict: any = null;

  try {
    approvedParagraphs = buildApprovedChapter(originalParagraphs, acceptedRevisionItems);
  } catch (err: any) {
    if (err instanceof ApprovedVersionConflictError) {
      approvedConflict = {
        message: err.message,
        editA: err.editA,
        editB: err.editB,
      };
    }
  }

  // Derive chapter overall status
  const pendingCount = edits.filter((e) => e.reviewStatus === 'PENDING').length;
  const changesCount = edits.filter((e) => e.reviewStatus === 'CHANGES_REQUESTED').length;
  const isBetaCompleted = chapterStatus?.status === 'COMPLETED';

  let derivedChapterStatus: ChapterReviewStatus = 'NOT_READY';
  if (chapterReview && chapterReview.status === 'APPROVED') {
    derivedChapterStatus = 'APPROVED';
  } else if (chapterReview && chapterReview.status === 'REOPENED') {
    derivedChapterStatus = 'REOPENED';
  } else if (!isBetaCompleted) {
    derivedChapterStatus = 'NOT_READY';
  } else if (changesCount > 0) {
    derivedChapterStatus = 'CHANGES_REQUESTED';
  } else if (pendingCount > 0) {
    derivedChapterStatus = 'NEEDS_REVIEW';
  } else {
    derivedChapterStatus = 'REVIEWED';
  }

  const response: ChapterReviewDetailResponse = {
    chapter: {
      id: chapter.id,
      index: chapter.chapter_index,
      title: chapter.title,
      wordCount: chapter.word_count,
      contentVersion: chapter.content_version,
      contentHash: chapter.content_hash,
      originalParagraphs,
      betaStatus: chapterStatus?.status || 'NOT_STARTED',
      isBetaCompleted,
      derivedStatus: derivedChapterStatus,
      approvedAt: chapterReview?.approved_at || null,
      approvedEditsCount: acceptedRevisionItems.length,
    },
    assignment: {
      id: assignment.id,
      betaUserId: assignment.beta_user_id,
      betaUserName: assignment.betaUserName,
      betaDisplayName: assignment.betaDisplayName,
    },
    edits,
    notes,
    approvedVersion: {
      paragraphs: approvedParagraphs,
      conflict: approvedConflict,
    },
    counts: {
      total: edits.length,
      pending: pendingCount,
      changesRequested: changesCount,
      accepted: edits.filter((e) => e.reviewStatus === 'ACCEPTED').length,
      rejected: edits.filter((e) => e.reviewStatus === 'REJECTED').length,
    },
  };
  res.json(response);
};

/**
 * Review an individual edit (Accept, Reject, Request Changes)
 */
export const createEditReview = async (req: Request, res: Response): Promise<void> => {
  const { editId } = req.params;
  const user = req.user!;

  if (user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền review chỉnh sửa' });
    return;
  }

  const { decision, comment, expectedRevisionNumber, expectedEditVersion } = req.body;

  if (!['ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED'].includes(decision)) {
    res.status(400).json({ error: 'Quyết định review không hợp lệ' });
    return;
  }

  if (decision === 'CHANGES_REQUESTED' && (!comment || !String(comment).trim())) {
    res.status(400).json({ error: 'Vui lòng nhập lý do/yêu cầu cụ thể khi yêu cầu sửa lại' });
    return;
  }

  const edit = await queryOne<any>('SELECT * FROM beta_edits WHERE id = ?', editId);
  if (!edit) {
    res.status(404).json({ error: 'Không tìm thấy chỉnh sửa' });
    return;
  }

  // 1. Query current/latest revision of the edit
  const currentRevision = await queryOne<any>(
    'SELECT * FROM beta_edit_revisions WHERE edit_id = ? ORDER BY revision_number DESC LIMIT 1',
    editId
  );

  if (!currentRevision) {
    res.status(409).json({
      error: 'Không tìm thấy revision hợp lệ cho chỉnh sửa này.',
      code: 'REVIEW_STALE',
    });
    return;
  }

  // 2. expectedEditVersion must equal edit.version
  if (expectedEditVersion !== undefined && edit.version !== parseInt(String(expectedEditVersion), 10)) {
    res.status(409).json({
      error: 'Bản sửa đã được Beta Reader cập nhật phiên bản mới. Hãy xem phiên bản mới nhất trước khi duyệt.',
      code: 'REVIEW_STALE',
    });
    return;
  }

  // 3. expectedRevisionNumber must equal current revision number (cannot review old revision on new edit)
  if (expectedRevisionNumber !== undefined && currentRevision.revision_number !== parseInt(String(expectedRevisionNumber), 10)) {
    res.status(409).json({
      error: 'Bản sửa đã được Beta Reader cập nhật phiên bản mới. Hãy xem phiên bản mới nhất trước khi duyệt.',
      code: 'REVIEW_STALE',
    });
    return;
  }

  // 4. Target revision is strictly the verified latest revision from database (never trust client input)
  const targetRevisionNumber = currentRevision.revision_number;

  const reviewId = `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await transaction(async () => {
    await run(
      `INSERT INTO beta_edit_reviews (
        id, edit_id, assignment_id, chapter_id, reviewer_id,
        decision, comment, reviewed_revision_number, reviewed_edit_version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reviewId,
      editId,
      edit.assignment_id,
      edit.chapter_id,
      user.id,
      decision,
      comment ? String(comment).trim() : null,
      targetRevisionNumber,
      edit.version,
      now,
      now
    );

    // If chapter was previously APPROVED, transition to REOPENED
    const chapterReview = await queryOne<any>(
      'SELECT id, status FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',
      edit.assignment_id,
      edit.chapter_index
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
        edit.book_id,
        edit.chapter_id,
        JSON.stringify({ reason: 'NEW_REVIEW_POST_APPROVAL', chapterIndex: edit.chapter_index, editId, decision }),
        now
      );
    }

    // Log review activity
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      logId,
      user.id,
      'EDIT_REVIEWED',
      edit.book_id,
      edit.chapter_id,
      JSON.stringify({ editId, decision, revisionNumber: targetRevisionNumber, editVersion: edit.version }),
      now
    );
  });

  res.status(201).json({
    success: true,
    review: {
      id: reviewId,
      editId,
      decision,
      comment: comment ? String(comment).trim() : null,
      reviewedRevisionNumber: targetRevisionNumber,
      reviewedEditVersion: edit.version,
      reviewerId: user.id,
      reviewerDisplayName: user.displayName,
      createdAt: now,
    },
  });
};

/**
 * Approve Chapter by Admin
 */
export const approveChapter = async (req: Request, res: Response): Promise<void> => {
  const { id, assignmentId, index } = req.params;
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);

  if (user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Chỉ Quản trị viên mới có quyền phê duyệt chương' });
    return;
  }

  const chapter = await queryOne<any>(
    'SELECT id, title, paragraphs FROM beta_chapters WHERE book_id = ? AND chapter_index = ?',
    id,
    chapterNum
  );

  if (!chapter) {
    res.status(404).json({ error: 'Không tìm thấy chương' });
    return;
  }

  // 1. Invariant: beta_chapter_status must be COMPLETED
  const chapterStatus = await queryOne<any>(
    'SELECT status FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
    assignmentId,
    chapterNum
  );

  if (!chapterStatus || chapterStatus.status !== 'COMPLETED') {
    res.status(400).json({
      error: 'Không thể phê duyệt: Beta Reader chưa đánh dấu hoàn thành đọc/góp ý cho chương này (Trạng thái phải là COMPLETED).',
      code: 'CHAPTER_NOT_BETA_COMPLETE',
      betaStatus: chapterStatus?.status || 'NOT_STARTED',
    });
    return;
  }

  // 2. Invariant: No PENDING or CHANGES_REQUESTED edits on current revisions
  const edits = await queryAll<any>(`
    SELECT 
      e.id,
      e.paragraph_index,
      e.start_offset,
      e.end_offset,
      e.version,
      (
        SELECT r.decision 
        FROM beta_edit_reviews r 
        WHERE r.edit_id = e.id AND r.reviewed_revision_number = e.version
        ORDER BY r.created_at DESC LIMIT 1
      ) AS currentDecision,
      (
        SELECT r.reviewed_revision_number 
        FROM beta_edit_reviews r 
        WHERE r.edit_id = e.id AND r.decision = 'ACCEPTED'
        ORDER BY r.created_at DESC LIMIT 1
      ) AS acceptedRevisionNumber
    FROM beta_edits e
    WHERE e.assignment_id = ? AND e.chapter_index = ? AND e.status = 'ACTIVE'
  `, assignmentId, chapterNum);

  const pendingEdits = edits.filter((e) => !e.currentDecision);
  const changesEdits = edits.filter((e) => e.currentDecision === 'CHANGES_REQUESTED');

  if (pendingEdits.length > 0 || changesEdits.length > 0) {
    res.status(400).json({
      error: `Chưa thể phê duyệt: còn ${pendingEdits.length} đề xuất chưa duyệt và ${changesEdits.length} đề xuất đang yêu cầu sửa.`,
      pendingCount: pendingEdits.length,
      changesCount: changesEdits.length,
    });
    return;
  }

  // Collect accepted revisions snapshot
  const acceptedItems: AcceptedRevisionItem[] = [];
  for (const e of edits) {
    if (e.currentDecision === 'ACCEPTED' && e.acceptedRevisionNumber === e.version) {
      const rev = await queryOne<any>(
        'SELECT * FROM beta_edit_revisions WHERE edit_id = ? AND revision_number = ?',
        e.id,
        e.acceptedRevisionNumber
      );
      if (rev) {
        acceptedItems.push({
          editId: e.id,
          paragraphIndex: e.paragraph_index,
          startOffset: e.start_offset,
          endOffset: e.end_offset,
          revisionNumber: rev.revision_number,
          afterText: rev.after_text,
        });
      }
    }
  }

  // Validate no overlapping accepted edits
  try {
    checkAcceptedOverlaps(acceptedItems);
  } catch (err: any) {
    if (err instanceof ApprovedVersionConflictError) {
      res.status(409).json({
        error: err.message,
        code: 'APPROVED_EDIT_CONFLICT',
        editA: err.editA,
        editB: err.editB,
      });
      return;
    }
    throw err;
  }

  const now = new Date().toISOString();
  const existingReview = await queryOne<any>(
    'SELECT id, review_snapshot_version FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',
    assignmentId,
    chapterNum
  );

  await transaction(async () => {
    if (existingReview) {
      await run(
        `UPDATE beta_chapter_reviews SET
          status = 'APPROVED',
          reviewer_id = ?,
          approved_at = ?,
          review_snapshot_version = ?,
          approved_edits_snapshot = ?,
          updated_at = ?
         WHERE id = ?`,
        user.id,
        now,
        existingReview.review_snapshot_version + 1,
        JSON.stringify(acceptedItems),
        now,
        existingReview.id
      );
    } else {
      const crId = `cr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await run(
        `INSERT INTO beta_chapter_reviews (
          id, assignment_id, book_id, chapter_id, chapter_index,
          reviewer_id, status, approved_at, review_snapshot_version,
          approved_edits_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?, 1, ?, ?, ?)`,
        crId,
        assignmentId,
        id,
        chapter.id,
        chapterNum,
        user.id,
        now,
        JSON.stringify(acceptedItems),
        now,
        now
      );
    }

    // Log activity
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      logId,
      user.id,
      'CHAPTER_APPROVED',
      id,
      chapter.id,
      JSON.stringify({ chapterIndex: chapterNum, acceptedCount: acceptedItems.length }),
      now
    );
  });

  res.json({
    success: true,
    message: `Đã phê duyệt hoàn tất Chương ${chapterNum}`,
    approvedAt: now,
    acceptedEditsCount: acceptedItems.length,
  });
};

/**
 * Reopen Chapter Review by Admin
 */
export const reopenChapter = async (req: Request, res: Response): Promise<void> => {
  const { id, assignmentId, index } = req.params;
  const user = req.user!;
  const chapterNum = parseInt(String(index), 10);

  if (user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Chỉ Admin mới có quyền mở lại chương' });
    return;
  }

  const now = new Date().toISOString();
  const chapterReview = await queryOne<any>(
    'SELECT id, chapter_id FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',
    assignmentId,
    chapterNum
  );

  if (!chapterReview) {
    res.status(404).json({ error: 'Chương chưa từng được phê duyệt' });
    return;
  }

  await transaction(async () => {
    await run(
      `UPDATE beta_chapter_reviews SET status = 'REOPENED', updated_at = ? WHERE id = ?`,
      now,
      chapterReview.id
    );

    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      logId,
      user.id,
      'CHAPTER_REOPENED',
      id,
      chapterReview.chapter_id,
      JSON.stringify({ chapterIndex: chapterNum, manual: true }),
      now
    );
  });

  res.json({ success: true, message: `Đã mở lại Chương ${chapterNum} để rà soát` });
};

/**
 * Resolve Reader Note
 */
export const resolveNote = async (req: Request, res: Response): Promise<void> => {
  const { noteId } = req.params;
  const user = req.user!;

  if (user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Chỉ Admin mới có quyền xử lý ghi chú' });
    return;
  }

  const note = await queryOne<any>('SELECT * FROM beta_notes WHERE id = ?', noteId);
  if (!note) {
    res.status(404).json({ error: 'Không tìm thấy ghi chú' });
    return;
  }

  const now = new Date().toISOString();
  await run(
    `UPDATE beta_notes SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
    user.id,
    now,
    now,
    noteId
  );

  res.json({ success: true, message: 'Đã đánh dấu xử lý ghi chú' });
};

/**
 * Query Deterministic Approved Version of a Chapter
 */
export const getApprovedChapterVersion = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params;
  const { assignmentId } = req.query;
  const chapterNum = parseInt(String(index), 10);

  const chapter = await queryOne<any>(
    'SELECT * FROM beta_chapters WHERE book_id = ? AND chapter_index = ?',
    id,
    chapterNum
  );

  if (!chapter) {
    res.status(404).json({ error: 'Không tìm thấy chương' });
    return;
  }

  let originalParagraphs: string[] = [];
  if (Array.isArray(chapter.paragraphs)) {
    originalParagraphs = chapter.paragraphs;
  } else if (typeof chapter.paragraphs === 'string') {
    try {
      originalParagraphs = JSON.parse(chapter.paragraphs);
    } catch {
      originalParagraphs = [chapter.paragraphs];
    }
  }

  // Resolve target assignment
  let targetAssignmentId = assignmentId as string;
  if (!targetAssignmentId) {
    // Pick the primary active assignment for this book
    const firstAssign = await queryOne<any>(
      "SELECT id FROM beta_assignments WHERE book_id = ? AND status = 'ACTIVE' LIMIT 1",
      id
    );
    targetAssignmentId = firstAssign?.id;
  }

  const acceptedItems: AcceptedRevisionItem[] = [];

  if (targetAssignmentId) {
    const edits = await queryAll<any>(`
      SELECT 
        e.id,
        e.paragraph_index,
        e.start_offset,
        e.end_offset,
        e.error_type,
        (
          SELECT r.reviewed_revision_number 
          FROM beta_edit_reviews r 
          WHERE r.edit_id = e.id AND r.decision = 'ACCEPTED'
          ORDER BY r.created_at DESC LIMIT 1
        ) AS acceptedRevNumber
      FROM beta_edits e
      WHERE e.assignment_id = ? AND e.chapter_index = ? AND e.status = 'ACTIVE'
    `, targetAssignmentId, chapterNum);

    for (const e of edits) {
      if (e.acceptedRevNumber) {
        const rev = await queryOne<any>(
          'SELECT after_text FROM beta_edit_revisions WHERE edit_id = ? AND revision_number = ?',
          e.id,
          e.acceptedRevNumber
        );
        if (rev) {
          acceptedItems.push({
            editId: e.id,
            paragraphIndex: e.paragraph_index,
            startOffset: e.start_offset,
            endOffset: e.end_offset,
            revisionNumber: e.acceptedRevNumber,
            afterText: rev.after_text,
            errorType: e.error_type,
          });
        }
      }
    }
  }

  try {
    const approvedParagraphs = buildApprovedChapter(originalParagraphs, acceptedItems);
    res.json({
      chapterIndex: chapterNum,
      title: chapter.title,
      acceptedEditsCount: acceptedItems.length,
      paragraphs: approvedParagraphs.map(p => p.text),
      segments: approvedParagraphs.map(p => p.segments),
    });
  } catch (err: any) {
    if (err instanceof ApprovedVersionConflictError) {
      res.status(409).json({
        error: err.message,
        code: 'APPROVED_EDIT_CONFLICT',
        editA: err.editA,
        editB: err.editB,
      });
      return;
    }
    throw err;
  }
};
