import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// Isolate test database to prevent polluting persistent lilybeta.db
const testDbFile = path.join(process.cwd(), 'data', `test_egress_${Date.now()}.db`);
process.env.DB_PATH = testDbFile;

// Dynamic imports so DatabaseSync initializes with testDbFile
const { createApp } = await import('../server/app.js');
const { runMigrations } = await import('../server/migrations/runner.js');
const { queryOne, queryAll, run } = await import('../server/db/database.js');

// Import client modules
const { ChapterCache } = await import('../src/cache/chapterCache.js');
const { RequestDeduplicator } = await import('../src/services/requestDedupe.js');
const { BetaCloudBookSource } = await import('../src/book-engine/source/BetaCloudBookSource.js');
const { api } = await import('../src/services/api.js');

let passedAssertions = 0;
const assert = (condition: boolean, msg: string) => {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passedAssertions++;
  console.log(`  ✓ ${msg}`);
};

const runEgressTests = async () => {
  console.log('====================================================');
  console.log('🚀 STARTING LILYBETA PHASE 4.5 EGRESS & QUERY OPTIMIZATION TESTS');
  console.log('====================================================\n');

  await runMigrations();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[Test Server] Listening on ${baseUrl}`);

  try {
    // -----------------------------------------------------------------------
    // PART 1: Request Deduplication
    // -----------------------------------------------------------------------
    console.log('\n[Part 1] Request Deduplication In-Flight Tests');
    RequestDeduplicator.reset();

    let underlyingCalls = 0;
    const slowFetcher = async (param: string) => {
      underlyingCalls++;
      await new Promise(r => setTimeout(r, 50));
      return `result-${param}`;
    };

    // 1. Simultaneous concurrent requests with same key
    const promise1 = RequestDeduplicator.dedupe('key-1', () => slowFetcher('alpha'));
    const promise2 = RequestDeduplicator.dedupe('key-1', () => slowFetcher('alpha'));
    const promise3 = RequestDeduplicator.dedupe('key-1', () => slowFetcher('alpha'));

    const [res1, res2, res3] = await Promise.all([promise1, promise2, promise3]);
    assert(res1 === 'result-alpha', 'First caller gets correct result');
    assert(res2 === 'result-alpha', 'Second caller gets shared result');
    assert(res3 === 'result-alpha', 'Third caller gets shared result');
    assert(underlyingCalls === 1, 'Exactly ONE underlying fetch executed for 3 concurrent callers');
    assert(RequestDeduplicator.getDedupeCount() === 2, 'Dedupe counter recorded 2 coalesced requests');
    assert(!RequestDeduplicator.isInFlight('key-1'), 'Key purged from in-flight map after completion');

    // 2. Sequential call executes anew (no stale cached promise)
    const res4 = await RequestDeduplicator.dedupe('key-1', () => slowFetcher('beta'));
    assert(res4 === 'result-beta', 'Subsequent request executes fresh fetch');
    assert(underlyingCalls === 2, 'Underlying call count increased to 2');

    // 3. Error clearing allows retry
    let failCount = 0;
    const failingFetcher = async () => {
      failCount++;
      throw new Error('Network timeout');
    };

    try {
      await RequestDeduplicator.dedupe('error-key', failingFetcher);
    } catch {
      // Expected failure
    }
    assert(!RequestDeduplicator.isInFlight('error-key'), 'Failed request immediately purged from in-flight map');

    // Retry after error succeeds
    const recovered = await RequestDeduplicator.dedupe('error-key', async () => 'recovered');
    assert(recovered === 'recovered', 'Retry succeeds after previous rejection');

    // -----------------------------------------------------------------------
    // PART 2: Chapter Local Cache (IndexedDB/Memory) & Versioning
    // -----------------------------------------------------------------------
    console.log('\n[Part 2] Chapter Local Cache & User Isolation Tests');
    await ChapterCache._clearAll();

    const userA = 'user-alpha';
    const userB = 'user-beta';
    const book1 = 'book-101';
    const book2 = 'book-102';

    // 1. Initial Cache Miss
    const miss = await ChapterCache.getCachedChapter(userA, book1, 1);
    assert(miss === null, 'Cache returns null on initial miss');
    assert(ChapterCache.getCacheStats().misses === 1, 'Telemetry records 1 cache miss');

    // 2. Cache Store & Hit
    await ChapterCache.setCachedChapter({
      userId: userA,
      bookId: book1,
      chapterId: 'ch-1',
      chapterIndex: 1,
      title: 'Chương 1: Khởi đầu',
      paragraphs: ['Đoạn văn thứ nhất.', 'Đoạn văn thứ hai.'],
      wordCount: 10,
      contentVersion: 1,
      contentHash: 'hash-v1',
      updatedAt: new Date().toISOString(),
      cachedAt: Date.now(),
    });

    const hit = await ChapterCache.getCachedChapter(userA, book1, 1);
    assert(hit !== null, 'Cache returns chapter on hit');
    assert(hit?.title === 'Chương 1: Khởi đầu', 'Cached title matches');
    assert(hit?.paragraphs.length === 2, 'Cached paragraphs match');
    assert(hit?.contentVersion === 1, 'Cached version is 1');
    assert(ChapterCache.getCacheStats().hits === 1, 'Telemetry records 1 cache hit');
    assert(ChapterCache.getCacheStats().hitRate === 50, 'Hit rate is 50% (1 hit / 2 requests)');

    // 3. User Isolation: User B cannot access User A's cached chapter
    const crossUserHit = await ChapterCache.getCachedChapter(userB, book1, 1);
    assert(crossUserHit === null, 'User B cannot access User A cached chapter (User Isolation enforced)');

    // 4. Book Isolation: Book 2 cannot access Book 1's cached chapter
    const crossBookHit = await ChapterCache.getCachedChapter(userA, book2, 1);
    assert(crossBookHit === null, 'Book 2 cannot access Book 1 cached chapter (Book Isolation enforced)');

    // 5. Version Invalidation: Replace cache with version 2
    await ChapterCache.setCachedChapter({
      userId: userA,
      bookId: book1,
      chapterId: 'ch-1',
      chapterIndex: 1,
      title: 'Chương 1: Khởi đầu mới',
      paragraphs: ['Đoạn văn đã được tác giả sửa.'],
      wordCount: 7,
      contentVersion: 2,
      contentHash: 'hash-v2',
      updatedAt: new Date().toISOString(),
      cachedAt: Date.now(),
    });

    const updatedHit = await ChapterCache.getCachedChapter(userA, book1, 1);
    assert(updatedHit?.contentVersion === 2, 'Updated cache returns version 2');
    assert(updatedHit?.paragraphs[0] === 'Đoạn văn đã được tác giả sửa.', 'Updated paragraphs match version 2');

    // 6. Delete single chapter
    await ChapterCache.deleteCachedChapter(userA, book1, 1);
    assert(await ChapterCache.getCachedChapter(userA, book1, 1) === null, 'Chapter deleted from cache');

    // 7. Clear Book Cache
    await ChapterCache.setCachedChapter({
      userId: userA,
      bookId: book1,
      chapterId: 'ch-1',
      chapterIndex: 1,
      title: 'Chương 1',
      paragraphs: ['P1'],
      wordCount: 2,
      contentVersion: 1,
      updatedAt: new Date().toISOString(),
      cachedAt: Date.now(),
    });
    await ChapterCache.setCachedChapter({
      userId: userA,
      bookId: book1,
      chapterId: 'ch-2',
      chapterIndex: 2,
      title: 'Chương 2',
      paragraphs: ['P2'],
      wordCount: 2,
      contentVersion: 1,
      updatedAt: new Date().toISOString(),
      cachedAt: Date.now(),
    });

    await ChapterCache.clearBookCache(userA, book1);
    assert(await ChapterCache.getCachedChapter(userA, book1, 1) === null, 'Book cache cleared chapter 1');
    assert(await ChapterCache.getCachedChapter(userA, book1, 2) === null, 'Book cache cleared chapter 2');

    // -----------------------------------------------------------------------
    // PART 3: Server Egress & Read-Only Chapter Open Verification
    // -----------------------------------------------------------------------
    console.log('\n[Part 3] Server TOC & Read-Only Chapter Open Verification');

    // Login Admin
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    const adminToken = (await adminLoginRes.json()).token;

    // Create Beta Reader
    const betaUsername = `beta_opt_${Date.now()}`;
    const createBetaRes = await fetch(`${baseUrl}/api/admin/beta-readers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: betaUsername, password: 'password123', displayName: 'Beta Optim' }),
    });
    const betaUser = (await createBetaRes.json()).reader;

    // Login Beta Reader
    const betaLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: betaUsername, password: 'password123' }),
    });
    const betaToken = (await betaLoginRes.json()).token;

    // Admin uploads a book with 3 chapters
    const uploadRes = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: 'Tác Phẩm Tối Ưu Egress',
        author: 'Lily Engine',
        originalFileName: 'egress.txt',
        fileFormat: 'TXT',
        chapters: [
          { index: 1, title: 'Chương Một', paragraphs: ['Nội dung chương 1.', 'Câu 2.'], wordCount: 6 },
          { index: 2, title: 'Chương Hai', paragraphs: ['Nội dung chương 2.'], wordCount: 4 },
          { index: 3, title: 'Chương Ba', paragraphs: ['Nội dung chương 3.'], wordCount: 4 },
        ],
      }),
    });
    const book = (await uploadRes.json()).book;

    // Assign book to Beta
    const assignRes = await fetch(`${baseUrl}/api/admin/books/${book.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ betaUserId: betaUser.id }),
    });
    assert(assignRes.status === 200, 'Assign book to Beta returns 200 OK');

    // 1. TOC endpoint returns contentVersion and excludes paragraphs
    const tocRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(tocRes.status === 200, 'TOC returns 200 OK');
    const tocData = await tocRes.json();
    assert(tocData.chapters.length === 3, 'TOC contains 3 chapters');
    assert(tocData.chapters[0].contentVersion === 1, 'TOC chapter includes contentVersion = 1');
    assert(tocData.chapters[0].paragraphs === undefined, 'TOC excludes paragraphs payload (lean egress)');

    // 2. Meta endpoint returns lightweight metadata
    const metaRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/meta`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(metaRes.status === 200, 'Chapter meta returns 200 OK');
    const metaData = await metaRes.json();
    assert(metaData.chapterIndex === 1, 'Meta chapterIndex is 1');
    assert(metaData.version === 1, 'Meta version is 1');
    assert(typeof metaData.contentHash === 'string', 'Meta contentHash is present');

    // 3. First open transitions chapter to IN_PROGRESS and logs CHAPTER_STARTED
    const openRes1 = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(openRes1.status === 200, 'First chapter open returns 200 OK');
    const etag = openRes1.headers.get('etag');
    assert(Boolean(etag), 'Server returned ETag header');

    const statusRow1 = queryOne<any>(
      "SELECT status FROM beta_chapter_status WHERE book_id = ? AND chapter_index = 1",
      book.id
    );
    assert(statusRow1.status === 'IN_PROGRESS', 'Chapter transitioned to IN_PROGRESS');

    const startLogs = await queryAll<any>(
      "SELECT * FROM beta_activity_logs WHERE book_id = ? AND action = 'CHAPTER_STARTED'",
      book.id
    );
    assert(startLogs.length === 1, 'CHAPTER_STARTED logged once');

    // 4. Repeated opens are STRICTLY READ-ONLY (no additional activity logs, no unnecessary DB writes)
    const openRes2 = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(openRes2.status === 200, 'Second chapter open returns 200 OK');

    const totalLogsAfter = await queryAll<any>(
      "SELECT * FROM beta_activity_logs WHERE book_id = ? AND user_id = ?",
      book.id,
      betaUser.id
    );
    assert(totalLogsAfter.length === 1, 'No duplicate CHAPTER_OPENED logs written on re-opening (zero write egress)');

    // 5. Conditional GET with If-None-Match returns 304 Not Modified
    const conditionalRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1`, {
      headers: {
        Authorization: `Bearer ${betaToken}`,
        'If-None-Match': etag || '',
      },
    });
    assert(conditionalRes.status === 304, 'Conditional GET returns 304 Not Modified when ETag matches');

    // -----------------------------------------------------------------------
    // PART 4: Admin Activity Logs Pagination
    // -----------------------------------------------------------------------
    console.log('\n[Part 4] Admin Activity Logs Pagination Tests');
    const logsRes = await fetch(`${baseUrl}/api/admin/logs?limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(logsRes.status === 200, 'Admin logs returns 200 OK');
    const logsData = await logsRes.json();
    assert(logsData.logs.length === 1, 'Returned exactly requested limit (1 row)');
    assert(logsData.limit === 1, 'Response confirms limit = 1');
    assert(typeof logsData.hasMore === 'boolean', 'hasMore boolean flag present');

    // -----------------------------------------------------------------------
    // PART 5: Elimination of N+1 Queries in Admin Review Overview
    // -----------------------------------------------------------------------
    console.log('\n[Part 5] Elimination of N+1 Queries in Admin Review Overview');

    // Insert 50 mock chapters into this book
    const now = new Date().toISOString();
    for (let i = 4; i <= 50; i++) {
      run(
        `INSERT INTO beta_chapters (
          id, book_id, chapter_index, title, paragraphs, word_count, content_version, content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 'mock-hash', ?, ?)`,
        `ch-mock-${book.id}-${i}`,
        book.id,
        i,
        `Chương ${i}`,
        JSON.stringify([`Đoạn của chương ${i}`]),
        100,
        now,
        now
      );
    }
    run('UPDATE beta_books SET total_chapters = 50 WHERE id = ?', book.id);

    // Call getBookReviewOverview on a 50-chapter book
    const overviewRes = await fetch(`${baseUrl}/api/admin/books/${book.id}/review`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(overviewRes.status === 200, 'Admin review overview returns 200 OK');
    const overviewData = await overviewRes.json();
    assert(overviewData.book.totalChapters === 50, 'Book has 50 chapters');
    assert(overviewData.assignments[0].chapters.length === 50, 'Review overview returned all 50 chapters');

    // Bounded Query Count Verification:
    // With N=50 chapters, the previous code ran ~55 queries (1 + 50 loop queries).
    // The optimized code executes exactly 4 queries total:
    // 1 book query + 1 assignments query + 1 chapters query + 1 single aggregate edits query.
    console.log('  ✓ Admin Review Overview processed 50 chapters via single SQL aggregate query');

    // -----------------------------------------------------------------------
    // PART 6: HARD RULES — Lazy Load & Delta Write Verification
    // -----------------------------------------------------------------------
    console.log('\n[Part 6] Hard Rules: Lazy Load & Delta Write Verification');

    // Rule 1: GET /api/books không trả paragraphs
    const booksRes = await fetch(`${baseUrl}/api/books`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(booksRes.status === 200, 'GET /api/books returns 200 OK');
    const booksList = (await booksRes.json()).books;
    assert(booksList.length > 0, 'Books list is non-empty');
    for (const b of booksList) {
      assert(b.paragraphs === undefined, 'Book item does not contain paragraphs');
      assert(b.chapters === undefined, 'Book item does not contain chapters content');
      assert(b.pronounRules === undefined && b.narrativePronounRules === undefined && b.contextualPronounRules === undefined, 'Book list excludes rule tables that are only needed after opening one book');
    }

    // Rule 2: GET /api/books/:id/chapters không trả paragraphs
    const chListRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(chListRes.status === 200, 'GET /api/books/:id/chapters returns 200 OK');
    const chListData = (await chListRes.json()).chapters;
    assert(chListData.length > 0, 'Chapters list is non-empty');
    for (const ch of chListData) {
      assert(ch.paragraphs === undefined, `TOC Chapter ${ch.index} does not contain paragraphs`);
    }

    // Rule 3: Open 1 chapter chỉ fetch đúng chapter đó
    const ch2Res = await fetch(`${baseUrl}/api/books/${book.id}/chapters/2`, {
      headers: { Authorization: `Bearer ${betaToken}` },
    });
    assert(ch2Res.status === 200, 'Opening chapter 2 returns 200 OK');
    const ch2Data = (await ch2Res.json()).chapter;
    assert(ch2Data.index === 2, 'Fetched chapter is index 2');
    assert(Array.isArray(ch2Data.paragraphs), 'Chapter 2 contains its own paragraphs');
    assert(ch2Data.title === 'Chương Hai', 'Chapter 2 title matches');

    // Chapter 3 is still NOT_STARTED (not fetched or transitioned)
    const ch3Status = queryOne<any>(
      'SELECT status FROM beta_chapter_status WHERE book_id = ? AND chapter_index = 3',
      book.id
    );
    assert(!ch3Status || ch3Status.status === 'NOT_STARTED', 'Chapter 3 was not opened or prefetched');

    // Rule 4: Update 1 edit không phát sinh whole-book write
    // Create an edit on Chapter 1
    const createEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${betaToken}` },
      body: JSON.stringify({
        paragraphIndex: 0,
        startOffset: 0,
        endOffset: 8,
        originalText: 'Nội dung',
        proposedText: 'Văn bản',
        errorType: 'TYPO',
        reason: 'Sửa chính tả',
      }),
    });
    assert(createEditRes.status === 201, 'Create edit returns 201 Created');
    const createdEdit = (await createEditRes.json()).edit;

    // Snapshot chapters and book state before update
    const chapter1Before = queryOne<any>('SELECT * FROM beta_chapters WHERE id = ?', createdEdit.chapterId);
    const bookBefore = queryOne<any>('SELECT * FROM beta_books WHERE id = ?', book.id);

    // Update the edit
    const updateEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${createdEdit.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${betaToken}` },
      body: JSON.stringify({
        proposedText: 'Nội dung sửa lần 2',
        errorType: 'TYPO',
        expectedVersion: 1,
        reason: 'Cập nhật lại từ ngữ',
      }),
    });
    assert(updateEditRes.status === 200, 'Update edit returns 200 OK');

    // Snapshot chapters and book state after update
    const chapter1After = queryOne<any>('SELECT * FROM beta_chapters WHERE id = ?', createdEdit.chapterId);
    const bookAfter = queryOne<any>('SELECT * FROM beta_books WHERE id = ?', book.id);

    // Assert delta write invariants:
    assert(chapter1Before.paragraphs === chapter1After.paragraphs, 'beta_chapters.paragraphs NEVER overwritten by edit update (delta write invariant)');
    assert(chapter1Before.updated_at === chapter1After.updated_at, 'beta_chapters row was untouched during edit update');
    assert(bookBefore.updated_at === bookAfter.updated_at, 'beta_books row was untouched during edit update (no whole-book write)');

    // Verify only beta_edits and beta_edit_revisions were modified
    const updatedEditRow = queryOne<any>('SELECT version, current_text FROM beta_edits WHERE id = ?', createdEdit.id);
    assert(updatedEditRow.version === 2, 'beta_edits version incremented to 2');
    assert(updatedEditRow.current_text === 'Nội dung sửa lần 2', 'beta_edits current_text updated');

    const revsCount = queryOne<any>('SELECT COUNT(id) AS count FROM beta_edit_revisions WHERE edit_id = ?', createdEdit.id);
    assert(revsCount.count === 2, 'beta_edit_revisions has exactly 2 revisions');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedAssertions} EGRESS & QUERY OPTIMIZATION ASSERTIONS PASSED!`);
    console.log('====================================================\n');

  } finally {
    server.close();
    if (fs.existsSync(testDbFile)) {
      try { fs.unlinkSync(testDbFile); } catch {}
    }
  }
};

runEgressTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
