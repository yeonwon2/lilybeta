import { Request, Response } from 'express';
import { queryAll, queryOne, run, transaction } from '../db/database.js';

export const listBooks = async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  if (user.role === 'ADMIN') {
    const books = await queryAll<any>(`
      SELECT 
        b.id,
        b.title,
        b.author,
        b.cover_url AS coverUrl,
        b.cover_color AS coverColor,
        b.total_chapters AS totalChapters,
        b.word_count AS wordCount,
        b.file_format AS fileFormat,
        b.status,
        b.created_at AS createdAt,
        b.updated_at AS updatedAt
      FROM beta_books b
      ORDER BY b.created_at DESC
    `);
    res.json({ books });
    return;
  }

  // Beta Reader: strictly scoped to active assignments
  const assignedBooks = await queryAll<any>(`
    SELECT 
      b.id,
      b.title,
      b.author,
      b.cover_url AS coverUrl,
      b.cover_color AS coverColor,
      b.total_chapters AS totalChapters,
      b.word_count AS wordCount,
      b.file_format AS fileFormat,
      b.status,
      b.created_at AS createdAt,
      ba.assigned_at AS assignedAt,
      COALESCE(ap.current_chapter_index, 1) AS currentChapter,
      COALESCE(ap.overall_percentage, 0) AS progressPercent,
      COALESCE(ap.completed_chapters_count, 0) AS completedChaptersCount,
      ap.last_read_at AS lastReadAt
    FROM beta_books b
    INNER JOIN beta_assignments ba ON ba.book_id = b.id AND ba.status IN ('ACTIVE', 'COMPLETED')
    LEFT JOIN beta_assignment_progress ap ON ap.assignment_id = ba.id
    WHERE ba.beta_user_id = ?
    ORDER BY ba.assigned_at DESC
  `, user.id);

  res.json({ books: assignedBooks });
};

export const getBook = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user!;

  const book = await queryOne<any>(`
    SELECT 
      b.id,
      b.title,
      b.author,
      b.cover_url AS coverUrl,
      b.cover_color AS coverColor,
      b.original_file_name AS originalFileName,
      b.file_format AS fileFormat,
      b.total_chapters AS totalChapters,
      b.word_count AS wordCount,
      b.status,
      b.created_at AS createdAt,
      b.updated_at AS updatedAt
    FROM beta_books b
    WHERE b.id = ?
  `, id);

  if (!book) {
    res.status(404).json({ error: 'Không tìm thấy tác phẩm' });
    return;
  }

  // Fetch assignment progress for this user
  const progress = await queryOne<any>(`
    SELECT 
      current_chapter_index AS currentChapter,
      overall_percentage AS progressPercent,
      completed_chapters_count AS completedChaptersCount,
      last_read_at AS lastReadAt
    FROM beta_assignment_progress
    WHERE book_id = ? AND beta_user_id = ?
  `, id, user.id);

  // Log activity
  try {
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, book_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      logId,
      user.id,
      'BOOK_OPENED',
      id,
      JSON.stringify({ title: book.title }),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to log activity:', err);
  }

  res.json({
    book: {
      ...book,
      currentChapter: progress?.currentChapter || 1,
      progressPercent: progress?.progressPercent || 0,
      completedChaptersCount: progress?.completedChaptersCount || 0,
      lastReadAt: progress?.lastReadAt || null,
      progress: progress || null,
    },
  });
};

export const getChapterList = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user;

  // Lean TOC query: excludes paragraphs payload to save network egress, but joins status for current user if available
  const chapters = await queryAll<any>(`
    SELECT 
      c.id,
      c.chapter_index AS chapterIndex,
      c.chapter_index AS "index",
      c.title,
      c.word_count AS wordCount,
      c.content_version AS contentVersion,
      c.content_hash AS contentHash,
      c.updated_at AS updatedAt,
      COALESCE(cs.status, 'NOT_STARTED') AS status,
      cs.started_at AS startedAt,
      cs.completed_at AS completedAt,
      cs.last_scroll_percent AS lastScrollPercent
    FROM beta_chapters c
    LEFT JOIN beta_chapter_status cs ON cs.book_id = c.book_id AND cs.chapter_index = c.chapter_index AND cs.beta_user_id = ?
    WHERE c.book_id = ?
    ORDER BY c.chapter_index ASC
  `, user?.id || null, id);

  res.json({ chapters });
};

export const getChapterMeta = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params;
  const chapterNum = parseInt(String(index), 10);

  if (isNaN(chapterNum) || chapterNum < 1) {
    res.status(400).json({ error: 'Chỉ số chương không hợp lệ' });
    return;
  }

  const meta = await queryOne<any>(`
    SELECT 
      c.id AS chapterId,
      c.chapter_index AS chapterIndex,
      c.title,
      c.word_count AS wordCount,
      c.content_version AS version,
      c.content_hash AS contentHash,
      c.updated_at AS updatedAt
    FROM beta_chapters c
    WHERE c.book_id = ? AND c.chapter_index = ?
  `, id, chapterNum);

  if (!meta) {
    res.status(404).json({ error: 'Không tìm thấy chương' });
    return;
  }

  res.json(meta);
};

export const getChapter = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params;
  const user = req.user!;

  const chapterNum = parseInt(String(index), 10);
  if (isNaN(chapterNum) || chapterNum < 1) {
    res.status(400).json({ error: 'Chỉ số chương không hợp lệ' });
    return;
  }

  const chapter = await queryOne<any>(`
    SELECT 
      c.id,
      c.book_id AS bookId,
      c.chapter_index AS chapterIndex,
      c.title,
      c.paragraphs,
      c.word_count AS wordCount,
      c.content_version AS contentVersion,
      c.content_hash AS contentHash,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt
    FROM beta_chapters c
    WHERE c.book_id = ? AND c.chapter_index = ?
  `, id, chapterNum);

  if (!chapter) {
    res.status(404).json({ error: 'Không tìm thấy chương' });
    return;
  }

  // HTTP ETag & Conditional GET
  const etag = `"${chapter.contentVersion}-${chapter.contentHash || ''}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
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

  const now = new Date().toISOString();

  // Find active or completed assignment
  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  let chapterWorkflowStatus = 'NOT_STARTED';
  let startedAt: string | null = null;
  let completedAt: string | null = null;
  let lastScrollPercent = 0;

  if (assignment) {
    const existingStatus = await queryOne<any>(
      'SELECT status, started_at, completed_at, last_scroll_percent FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );

    if (!existingStatus) {
      // First time opening: transition to IN_PROGRESS & log CHAPTER_STARTED
      await transaction(async () => {
        const statusId = `cs-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await run(
          `INSERT INTO beta_chapter_status (
            id, assignment_id, book_id, chapter_id, chapter_index, beta_user_id, status, started_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?)`,
          statusId,
          assignment.id,
          id,
          chapter.id,
          chapterNum,
          user.id,
          now,
          now
        );
        await run(
          `UPDATE beta_assignment_progress 
           SET current_chapter_index = ?, last_read_at = ?, updated_at = ?
           WHERE assignment_id = ?`,
          chapterNum,
          now,
          now,
          assignment.id
        );
        await run(
          `UPDATE beta_books SET status = 'IN_BETA', updated_at = ? WHERE id = ? AND status = 'ASSIGNED'`,
          now,
          id
        );
        const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await run(
          'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          logId,
          user.id,
          'CHAPTER_STARTED',
          id,
          chapter.id,
          JSON.stringify({ chapterIndex: chapterNum, chapterTitle: chapter.title }),
          now
        );
      });
      chapterWorkflowStatus = 'IN_PROGRESS';
      startedAt = now;
    } else if (existingStatus.status === 'NOT_STARTED') {
      // Transition from NOT_STARTED to IN_PROGRESS
      await transaction(async () => {
        await run(
          `UPDATE beta_chapter_status SET status = 'IN_PROGRESS', started_at = ?, updated_at = ? WHERE assignment_id = ? AND chapter_index = ?`,
          now,
          now,
          assignment.id,
          chapterNum
        );
        await run(
          `UPDATE beta_assignment_progress 
           SET current_chapter_index = ?, last_read_at = ?, updated_at = ?
           WHERE assignment_id = ?`,
          chapterNum,
          now,
          now,
          assignment.id
        );
        const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await run(
          'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          logId,
          user.id,
          'CHAPTER_STARTED',
          id,
          chapter.id,
          JSON.stringify({ chapterIndex: chapterNum, chapterTitle: chapter.title }),
          now
        );
      });
      chapterWorkflowStatus = 'IN_PROGRESS';
      startedAt = now;
      completedAt = existingStatus.completed_at;
      lastScrollPercent = existingStatus.last_scroll_percent || 0;
    } else {
      // Already IN_PROGRESS or COMPLETED: strictly READ ONLY! Zero DB writes, zero activity logs.
      chapterWorkflowStatus = existingStatus.status;
      startedAt = existingStatus.started_at;
      completedAt = existingStatus.completed_at;
      lastScrollPercent = existingStatus.last_scroll_percent || 0;
    }
  }

  res.json({
    chapter: {
      id: chapter.id,
      bookId: chapter.bookId,
      index: chapter.chapterIndex,
      title: chapter.title,
      wordCount: chapter.wordCount,
      paragraphs,
      contentVersion: chapter.contentVersion,
      contentHash: chapter.contentHash,
      status: chapterWorkflowStatus,
      startedAt,
      completedAt,
      lastScrollPercent,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt,
    },
  });
};

export const getProgress = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user!;

  const progress = await queryOne<any>(`
    SELECT 
      ap.book_id AS bookId,
      ap.current_chapter_index AS chapterIndex,
      c.title AS chapterTitle,
      ap.overall_percentage AS percentage,
      ap.completed_chapters_count AS completedChaptersCount,
      COALESCE(cs.last_scroll_percent, 0) AS scrollPercent,
      COALESCE(cs.last_scroll_offset, 0) AS scrollOffset,
      ap.last_read_at AS updatedAt
    FROM beta_assignment_progress ap
    LEFT JOIN beta_chapters c ON c.book_id = ap.book_id AND c.chapter_index = ap.current_chapter_index
    LEFT JOIN beta_chapter_status cs ON cs.assignment_id = ap.assignment_id AND cs.chapter_index = ap.current_chapter_index
    WHERE ap.book_id = ? AND ap.beta_user_id = ?
  `, id, user.id);

  res.json({ progress: progress || null });
};

export const saveProgress = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params; // bookId
  const { chapterIndex, percentage, scrollPercent, scrollOffset } = req.body;
  const user = req.user!;

  // 1. Validate assignment strictly (NO fallback!)
  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ 
      error: 'Truy cập bị từ chối: Bạn không có phân công hoạt động đối với tác phẩm này.' 
    });
    return;
  }

  // 2. Validate chapterIndex
  const chapterNum = parseInt(String(chapterIndex), 10);
  if (isNaN(chapterNum) || chapterNum < 1) {
    res.status(400).json({ error: 'Chỉ số chương không hợp lệ (phải >= 1)' });
    return;
  }

  // 3. Validate chapter exists in book
  const chapter = await queryOne<any>(
    'SELECT id, title FROM beta_chapters WHERE book_id = ? AND chapter_index = ?',
    id,
    chapterNum
  );

  if (!chapter) {
    res.status(404).json({ error: 'Chương không tồn tại trong tác phẩm' });
    return;
  }

  // 4. Clamp percentages
  const cleanScrollPercent = Math.min(100, Math.max(0, Number(scrollPercent) || 0));
  const cleanScrollOffset = Math.max(0, Number(scrollOffset) || 0);
  const now = new Date().toISOString();

  await transaction(async () => {
    // 5. Upsert chapter status record (update scroll position, start if not started)
    const existingStatus = await queryOne<any>(
      'SELECT id, status FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );

    if (!existingStatus) {
      const statusId = `cs-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await run(
        `INSERT INTO beta_chapter_status (
          id, assignment_id, book_id, chapter_id, chapter_index, beta_user_id, status, started_at, last_scroll_percent, last_scroll_offset, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?)`,
        statusId,
        assignment.id,
        id,
        chapter.id,
        chapterNum,
        user.id,
        now,
        cleanScrollPercent,
        cleanScrollOffset,
        now
      );
    } else {
      await run(
        `UPDATE beta_chapter_status 
         SET last_scroll_percent = ?, last_scroll_offset = ?, updated_at = ?
         WHERE assignment_id = ? AND chapter_index = ?`,
        cleanScrollPercent,
        cleanScrollOffset,
        now,
        assignment.id,
        chapterNum
      );
    }

    // 6. Upsert book-level assignment progress
    await run(
      `INSERT INTO beta_assignment_progress (
        id, assignment_id, book_id, beta_user_id, current_chapter_index, overall_percentage, completed_chapters_count, last_read_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 0, 0, ?, ?
      )
      ON CONFLICT(book_id, beta_user_id) DO UPDATE SET
        current_chapter_index = excluded.current_chapter_index,
        last_read_at = excluded.last_read_at,
        updated_at = excluded.updated_at`,
      `prog-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      assignment.id,
      id,
      user.id,
      chapterNum,
      now,
      now
    );
  });

  res.json({
    success: true,
    progress: {
      chapterIndex: chapterNum,
      scrollPercent: cleanScrollPercent,
      scrollOffset: cleanScrollOffset,
      updatedAt: now,
    },
  });
};

export const completeChapter = async (req: Request, res: Response): Promise<void> => {
  const { id, index } = req.params;
  const user = req.user!;

  // 1. Verify user assignment strictly
  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Truy cập bị từ chối: Bạn không có phân công hoạt động đối với tác phẩm này.' });
    return;
  }

  // 2. Validate chapter
  const chapterNum = parseInt(String(index), 10);
  if (isNaN(chapterNum) || chapterNum < 1) {
    res.status(400).json({ error: 'Chỉ số chương không hợp lệ' });
    return;
  }

  const chapter = await queryOne<any>(
    'SELECT id, title FROM beta_chapters WHERE book_id = ? AND chapter_index = ?',
    id,
    chapterNum
  );

  if (!chapter) {
    res.status(404).json({ error: 'Chương không tồn tại trong tác phẩm' });
    return;
  }

  const book = await queryOne<any>('SELECT total_chapters FROM beta_books WHERE id = ?', id);
  const totalChapters = book?.total_chapters || 1;
  const now = new Date().toISOString();

  let completedCount = 0;
  let overallPercentage = 0;

  await transaction(async () => {
    // 3. Mark chapter as COMPLETED
    const existing = await queryOne<any>(
      'SELECT id, status FROM beta_chapter_status WHERE assignment_id = ? AND chapter_index = ?',
      assignment.id,
      chapterNum
    );

    if (!existing) {
      const statusId = `cs-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      await run(
        `INSERT INTO beta_chapter_status (
          id, assignment_id, book_id, chapter_id, chapter_index, beta_user_id, status, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
        statusId,
        assignment.id,
        id,
        chapter.id,
        chapterNum,
        user.id,
        now,
        now,
        now
      );
    } else {
      await run(
        `UPDATE beta_chapter_status 
         SET status = 'COMPLETED', completed_at = ?, updated_at = ?
         WHERE assignment_id = ? AND chapter_index = ?`,
        now,
        now,
        assignment.id,
        chapterNum
      );
    }

    // 4. Count completed chapters for this assignment
    const countRes = await queryOne<any>(
      `SELECT COUNT(id) AS count FROM beta_chapter_status WHERE assignment_id = ? AND status = 'COMPLETED'`,
      assignment.id
    );
    completedCount = parseInt(String(countRes?.count || 0), 10);
    overallPercentage = Math.min(100, Math.round((completedCount / totalChapters) * 1000) / 10);

    // 5. Update book-level progress
    await run(
      `INSERT INTO beta_assignment_progress (
        id, assignment_id, book_id, beta_user_id, current_chapter_index, overall_percentage, completed_chapters_count, last_read_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(book_id, beta_user_id) DO UPDATE SET
        completed_chapters_count = excluded.completed_chapters_count,
        overall_percentage = excluded.overall_percentage,
        updated_at = excluded.updated_at`,
      `prog-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      assignment.id,
      id,
      user.id,
      chapterNum,
      overallPercentage,
      completedCount,
      now,
      now
    );

    // 6. If all chapters are completed, transition status to BETA_COMPLETE (never auto-publish!)
    if (completedCount >= totalChapters) {
      await run(
        `UPDATE beta_books SET status = 'BETA_COMPLETE', updated_at = ? WHERE id = ?`,
        now,
        id
      );
      await run(
        `UPDATE beta_assignments SET status = 'COMPLETED' WHERE id = ?`,
        assignment.id
      );
    } else {
      await run(
        `UPDATE beta_books SET status = 'IN_BETA', updated_at = ? WHERE id = ? AND status IN ('DRAFT', 'ASSIGNED')`,
        now,
        id
      );
    }

    // 7. Log activity
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await run(
      'INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      logId,
      user.id,
      'CHAPTER_COMPLETED',
      id,
      chapter.id,
      JSON.stringify({ chapterIndex: chapterNum, chapterTitle: chapter.title, completedCount, totalChapters }),
      now
    );
  });

  res.json({
    success: true,
    chapterIndex: chapterNum,
    status: 'COMPLETED',
    completedAt: now,
    completedChaptersCount: completedCount,
    totalChapters,
    overallPercentage,
  });
};

export const getChapterWorkflow = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const user = req.user!;

  const assignment = await queryOne<any>(
    "SELECT id FROM beta_assignments WHERE book_id = ? AND beta_user_id = ? AND status IN ('ACTIVE', 'COMPLETED')",
    id,
    user.id
  );

  if (!assignment) {
    res.status(403).json({ error: 'Không có phân công hoạt động' });
    return;
  }

  const statuses = await queryAll<any>(
    `SELECT chapter_index AS chapterIndex, status, started_at AS startedAt, completed_at AS completedAt, last_scroll_percent AS lastScrollPercent
     FROM beta_chapter_status
     WHERE assignment_id = ?`,
    assignment.id
  );

  const workflowMap: Record<number, any> = {};
  for (const s of statuses) {
    workflowMap[s.chapterIndex] = {
      status: s.status,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      lastScrollPercent: s.lastScrollPercent,
    };
  }

  res.json({ workflow: workflowMap });
};
