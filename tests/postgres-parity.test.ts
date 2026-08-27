import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { SqliteAdapter } from '../server/db/sqliteAdapter.js';
import { translatePlaceholders, PostgresAdapter } from '../server/db/postgresAdapter.js';
import { setAdapter, closeDatabase } from '../server/db/database.js';
import { sanitizeDatabaseUrl } from '../server/config.js';

let passedAssertions = 0;
const assert = (condition: boolean, msg: string) => {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passedAssertions++;
  console.log(`  ✓ ${msg}`);
};

const runPostgresParityTests = async () => {
  console.log('====================================================');
  console.log('🐘 STARTING DATABASE PARITY & POSTGRES ADAPTER TESTS');
  console.log('====================================================\n');

  // -------------------------------------------------------------
  // Part 1: SQL Placeholder Translation Unit Tests
  // -------------------------------------------------------------
  console.log('[Part 1] SQL Placeholder Translation Tests');
  const q1 = 'SELECT * FROM beta_books WHERE id = ?';
  assert(translatePlaceholders(q1) === 'SELECT * FROM beta_books WHERE id = $1', 'Single placeholder translated');

  const q2 = 'INSERT INTO beta_edits (id, book_id, chapter_index) VALUES (?, ?, ?)';
  assert(
    translatePlaceholders(q2) === 'INSERT INTO beta_edits (id, book_id, chapter_index) VALUES ($1, $2, $3)',
    'Multiple positional placeholders translated in order'
  );

  const q3 = "SELECT * FROM beta_books WHERE title = 'What?' AND author = 'O''Reilly ?' AND id = ?";
  assert(
    translatePlaceholders(q3) === "SELECT * FROM beta_books WHERE title = 'What?' AND author = 'O''Reilly ?' AND id = $1",
    'Question marks inside string literals preserved correctly'
  );

  const q4 = 'SELECT "col?" FROM beta_books WHERE id = ?';
  assert(
    translatePlaceholders(q4) === 'SELECT "col?" FROM beta_books WHERE id = $1',
    'Question marks inside double-quoted identifiers preserved'
  );

  const q5 = '-- comment with ?\nSELECT * FROM beta_books WHERE id = ?';
  assert(
    translatePlaceholders(q5) === '-- comment with ?\nSELECT * FROM beta_books WHERE id = $1',
    'Question marks inside line comments preserved'
  );

  const q6 = '/* block comment with ? */ SELECT * FROM beta_books WHERE id = ?';
  assert(
    translatePlaceholders(q6) === '/* block comment with ? */ SELECT * FROM beta_books WHERE id = $1',
    'Question marks inside block comments preserved'
  );

  const q7 = 'SELECT $$dollar with ?$$ AS content, ? AS id';
  assert(
    translatePlaceholders(q7) === 'SELECT $$dollar with ?$$ AS content, $1 AS id',
    'Question marks inside dollar-quoted strings preserved'
  );

  // -------------------------------------------------------------
  // Part 2: PostgreSQL Migration Schema Integrity
  // -------------------------------------------------------------
  console.log('\n[Part 2] PostgreSQL Migration Schema File Integrity');
  const pgSchemaFile = path.join(process.cwd(), 'server', 'migrations', 'postgres', '001_initial_schema.sql');
  assert(fs.existsSync(pgSchemaFile), 'PostgreSQL 001_initial_schema.sql migration file exists');

  const pgSql = fs.readFileSync(pgSchemaFile, 'utf8');
  const requiredPgTables = [
    'schema_migrations',
    'profiles',
    'beta_books',
    'beta_chapters',
    'beta_assignments',
    'beta_assignment_progress',
    'beta_chapter_status',
    'beta_activity_logs',
    'beta_edits',
    'beta_edit_revisions',
    'beta_edit_reviews',
    'beta_notes',
    'beta_chapter_reviews',
  ];

  for (const t of requiredPgTables) {
    assert(pgSql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `PostgreSQL schema defines ${t} table`);
  }

  assert(pgSql.includes('paragraphs JSONB NOT NULL'), 'PostgreSQL schema defines paragraphs as JSONB');
  assert(pgSql.includes('TIMESTAMPTZ NOT NULL DEFAULT NOW()'), 'PostgreSQL schema uses TIMESTAMPTZ timestamps');
  assert(pgSql.includes('ON DELETE CASCADE'), 'Foreign keys enforce ON DELETE CASCADE');

  // -------------------------------------------------------------
  // Part 3: SQLite Adapter Contract & Transactions
  // -------------------------------------------------------------
  console.log('\n[Part 3] SQLite Adapter Contract & Transactions');
  const testDb = path.join(process.cwd(), 'data', `test_parity_${Date.now()}.db`);
  const sqlite = new SqliteAdapter(testDb);

  try {
    const alive = await sqlite.isAlive();
    assert(alive, 'SQLite adapter isAlive returns true');

    sqlite.exec('CREATE TABLE test_items (id TEXT PRIMARY KEY, value INTEGER);');
    const runRes = sqlite.run('INSERT INTO test_items (id, value) VALUES (?, ?)', 'item-1', 42);
    assert(runRes.changes === 1, 'SQLite run returns changes = 1');

    const row = sqlite.queryOne<{ value: number }>('SELECT value FROM test_items WHERE id = ?', 'item-1');
    assert(row?.value === 42, 'SQLite queryOne returns expected row');

    // Transaction commit
    sqlite.transaction((tx) => {
      tx.run('INSERT INTO test_items (id, value) VALUES (?, ?)', 'item-2', 100);
    });
    const row2 = sqlite.queryOne('SELECT id FROM test_items WHERE id = ?', 'item-2');
    assert(Boolean(row2), 'Transaction commit successfully persisted row');

    // Transaction rollback on error
    try {
      sqlite.transaction((tx) => {
        tx.run('INSERT INTO test_items (id, value) VALUES (?, ?)', 'item-3', 200);
        throw new Error('Simulated failure');
      });
    } catch {
      // Expected
    }
    const row3 = sqlite.queryOne('SELECT id FROM test_items WHERE id = ?', 'item-3');
    assert(!row3, 'Transaction rollback successfully reverted row on error');
  } finally {
    sqlite.close();
    if (fs.existsSync(testDb)) {
      try { fs.unlinkSync(testDb); } catch {}
    }
  }

  // -------------------------------------------------------------
  // Part 4: Live PostgreSQL Integration Suite (Fail-Hard on Failure)
  // -------------------------------------------------------------
  console.log('\n[Part 4] Live PostgreSQL Integration Suite');
  const livePgUrl = process.env.POSTGRES_TEST_URL || process.env.DATABASE_URL;

  if (!livePgUrl || (!livePgUrl.startsWith('postgres://') && !livePgUrl.startsWith('postgresql://'))) {
    console.log('========================================================================');
    console.log('ℹ️  POSTGRES INTEGRATION TESTS: SKIPPED');
    console.log('   Reason: No POSTGRES_TEST_URL or DATABASE_URL provided in environment.');
    console.log('   To execute live PostgreSQL verification against Supabase / Postgres:');
    console.log('     export POSTGRES_TEST_URL="postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres"');
    console.log('     npm run test:postgres');
    console.log('========================================================================\n');
    console.log(`🎉 ALL ${passedAssertions} UNIT & LOCAL PARITY ASSERTIONS PASSED!`);
    return;
  }

  console.log(`  Connecting to PostgreSQL: ${sanitizeDatabaseUrl(livePgUrl)}...`);
  const rootPgAdapter = new PostgresAdapter(livePgUrl);

  const testSchemaName = `lilybeta_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  let appServer: http.Server | null = null;
  let testPgAdapter: PostgresAdapter | null = null;

  try {
    // [A] PostgreSQL Connection
    const isAlive = await rootPgAdapter.isAlive();
    assert(isAlive, '[A] PostgreSQL Connection: connection is alive (SELECT 1 returns 1)');

    // Isolated Test Schema Strategy
    console.log(`\n  Creating isolated test schema: ${testSchemaName}...`);
    await rootPgAdapter.exec(`CREATE SCHEMA "${testSchemaName}";`);
    assert(true, `Test schema "${testSchemaName}" created successfully`);

    // Connect test adapter bound to the isolated schema search_path
    testPgAdapter = new PostgresAdapter({
      connectionString: livePgUrl,
      schema: testSchemaName,
    });

    // [B] Clean Migrations from Zero
    console.log('\n  [B] Clean Migrations: Running Clean Migration from Zero...');
    const schemaSql = fs.readFileSync(pgSchemaFile, 'utf8');

    await testPgAdapter.transaction(async (tx) => {
      await tx.exec(schemaSql);
      await tx.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        '001',
        '001_initial_schema.sql',
        new Date().toISOString()
      );
    });

    // Verify all 13 tables exist in testSchema
    const createdTables = await testPgAdapter.queryAll<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
      testSchemaName
    );
    const tableNames = new Set(createdTables.map(t => t.table_name));

    for (const t of requiredPgTables) {
      assert(tableNames.has(t), `[B] Clean Migrations: Table "${t}" exists in migrated PostgreSQL schema`);
    }

    // [E] JSONB Parity
    const paragraphCol = await testPgAdapter.queryOne<any>(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = 'beta_chapters' AND column_name = 'paragraphs'`,
      testSchemaName
    );
    assert(paragraphCol?.data_type === 'jsonb', '[E] JSONB Parity: beta_chapters.paragraphs is native jsonb in PostgreSQL');

    // [F] TIMESTAMPTZ Parity
    const timestampCol = await testPgAdapter.queryOne<any>(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = 'beta_chapters' AND column_name = 'created_at'`,
      testSchemaName
    );
    assert(timestampCol?.data_type === 'timestamp with time zone', '[F] TIMESTAMPTZ Parity: created_at is timestamp with time zone in PostgreSQL');

    // [G] Boolean Parity
    const booleanCol = await testPgAdapter.queryOne<any>(
      `SELECT data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = 'profiles' AND column_name = 'is_active'`,
      testSchemaName
    );
    assert(booleanCol?.data_type === 'boolean', '[G] Boolean Parity: profiles.is_active is native boolean in PostgreSQL');

    // Idempotent Migration Re-run
    await testPgAdapter.transaction(async (tx) => {
      await tx.exec(schemaSql);
    });
    assert(true, '[B] Clean Migrations: Re-executing initial schema SQL is idempotent and succeeds without error');

    // [C] Transactions Commit Test
    await testPgAdapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO profiles (id, username, password_hash, display_name, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ADMIN', TRUE, ?, ?)`,
        'admin-test-id',
        'admin',
        'hash123',
        'Test Admin',
        new Date().toISOString(),
        new Date().toISOString()
      );
    });
    const adminCheck = await testPgAdapter.queryOne<any>('SELECT id FROM profiles WHERE id = ?', 'admin-test-id');
    assert(Boolean(adminCheck), '[C] Transactions: Transaction commit persisted row in PostgreSQL');

    // [D] Rollback Test (Multi-step atomic rollback with zero orphan records)
    const preCount = (await testPgAdapter.queryOne<any>('SELECT COUNT(*) AS count FROM beta_activity_logs')).count;
    try {
      await testPgAdapter.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO beta_activity_logs (id, user_id, action, book_id, chapter_id, details, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          'temp-log-1',
          'admin-test-id',
          'TEST_ACTION',
          null,
          null,
          JSON.stringify({ step: 1 }),
          new Date().toISOString()
        );
        throw new Error('Simulated multi-step transaction failure');
      });
    } catch {
      // Expected
    }
    const postCount = (await testPgAdapter.queryOne<any>('SELECT COUNT(*) AS count FROM beta_activity_logs')).count;
    assert(Number(preCount) === Number(postCount), '[D] Rollback: Transaction rolled back completely: zero orphan records created');

    // Seed valid bcrypt admin password for Express API tests
    const bcryptMod = await import('bcryptjs');
    const adminPassHash = bcryptMod.default.hashSync('admin123456', 10);
    await testPgAdapter.run(
      'UPDATE profiles SET password_hash = ? WHERE id = ?',
      adminPassHash,
      'admin-test-id'
    );

    // Bind Express App to test PostgreSQL adapter
    setAdapter(testPgAdapter);
    const { createApp } = await import('../server/app.js');
    const app = createApp();
    appServer = http.createServer(app);

    await new Promise<void>((resolve) => {
      appServer!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = appServer.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // [H] Auth: Admin login & /api/auth/me
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    });
    assert(adminLoginRes.status === 200, '[H] Auth: Admin login on PostgreSQL returns 200 OK');
    const { token: adminToken } = await adminLoginRes.json();

    const adminMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminMeRes.status === 200, '[H] Auth: GET /api/auth/me returns 200 OK');
    const adminMe = await adminMeRes.json();
    assert(adminMe.user.role === 'ADMIN', '[H] Auth: Current user role is ADMIN');

    // Create Beta Reader A and Beta Reader B
    const createBetaARes = await fetch(`${baseUrl}/api/admin/beta-readers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'beta_alice', password: 'password123', displayName: 'Alice Beta' }),
    });
    assert(createBetaARes.status === 201, 'Admin creates Beta A returns 201 Created');
    const { reader: betaA } = await createBetaARes.json();

    const createBetaBRes = await fetch(`${baseUrl}/api/admin/beta-readers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'beta_bob', password: 'password123', displayName: 'Bob Beta' }),
    });
    assert(createBetaBRes.status === 201, 'Admin creates Beta B returns 201 Created');
    const { reader: betaB } = await createBetaBRes.json();

    // Create 3-chapter Book 1
    const sampleChapters = [
      { index: 1, title: 'Chương 1', paragraphs: ['Đoạn văn mở đầu cuốn sách.', 'Gió lay cành trúc biếc.'], wordCount: 20 },
      { index: 2, title: 'Chương 2', paragraphs: ['Trăng lên đỉnh núi mờ sương.'], wordCount: 15 },
      { index: 3, title: 'Chương 3', paragraphs: ['Ánh bình minh rạng rỡ.'], wordCount: 10 },
    ];
    const createBookRes = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: 'Truyện Thử Nghiệm Postgres', author: 'Tác Giả', fileFormat: 'TXT', chapters: sampleChapters }),
    });
    assert(createBookRes.status === 201, 'Create Book 1 on PostgreSQL returns 201 Created');
    const { book } = await createBookRes.json();

    // Create Book 2 for IDOR testing
    const createBook2Res = await fetch(`${baseUrl}/api/admin/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: 'Truyện Riêng Beta B', author: 'Tác Giả B', fileFormat: 'TXT', chapters: sampleChapters }),
    });
    const { book: book2 } = await createBook2Res.json();

    // Assign Book 1 to Beta A, Book 2 to Beta B
    const assignRes = await fetch(`${baseUrl}/api/admin/books/${book.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ betaUserId: betaA.id }),
    });
    assert(assignRes.status === 200, 'Assign Book 1 to Beta A returns 200 OK');
    const { assignment } = await assignRes.json();

    await fetch(`${baseUrl}/api/admin/books/${book2.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ betaUserId: betaB.id }),
    });

    // Beta A Login
    const betaALoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'beta_alice', password: 'password123' }),
    });
    assert(betaALoginRes.status === 200, '[H] Auth: Beta A login returns 200 OK');
    const { token: tokenA } = await betaALoginRes.json();

    // [K] Book Metadata Only (Phase 4.5 Egress Rule)
    const booksListRes = await fetch(`${baseUrl}/api/books`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(booksListRes.status === 200, '[K] Book Metadata Only: GET /api/books returns 200 OK');
    const { books } = await booksListRes.json();
    assert(books.length === 1 && books[0].paragraphs === undefined, '[K] Book Metadata Only: GET /api/books excludes paragraphs payload');

    // [L] TOC Metadata Only (Phase 4.5 Egress Rule)
    const tocRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(tocRes.status === 200, '[L] TOC Metadata Only: GET chapter list returns 200 OK');
    const { chapters: tocChapters } = await tocRes.json();
    assert(tocChapters.length === 3 && tocChapters[0].paragraphs === undefined, '[L] TOC Metadata Only: Chapter list excludes paragraphs payload');

    // [M] Chapter Content Fetch (Fetches only that chapter body with ETag)
    const ch1Res = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(ch1Res.status === 200, '[M] Chapter Content Fetch: Open Chapter 1 returns 200 OK');
    const etag = ch1Res.headers.get('etag');
    assert(Boolean(etag), '[M] Chapter Content Fetch: Server returns ETag header');
    const ch1Data = await ch1Res.json();
    assert(Array.isArray(ch1Data.chapter.paragraphs), '[M] Chapter Content Fetch: Returns paragraphs as native array');
    assert(ch1Data.chapter.paragraphs[0] === 'Đoạn văn mở đầu cuốn sách.', '[M] Chapter Content Fetch: Paragraph content intact');

    // Conditional GET ETag test
    const ch1304Res = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1`, {
      headers: { Authorization: `Bearer ${tokenA}`, 'If-None-Match': etag! },
    });
    assert(ch1304Res.status === 304, '[M] Chapter Content Fetch: Conditional GET with ETag returns 304 Not Modified');

    // [N] Progress Save
    const saveProgressRes = await fetch(`${baseUrl}/api/books/${book.id}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ chapterIndex: 1, scrollPercent: 55, scrollOffset: 320 }),
    });
    assert(saveProgressRes.status === 200, '[N] Progress Save: POST progress returns 200 OK');

    const getProgressRes = await fetch(`${baseUrl}/api/books/${book.id}/progress`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(getProgressRes.status === 200, '[N] Progress Save: GET progress returns 200 OK');
    const progressData = await getProgressRes.json();
    assert(progressData.progress?.chapterIndex === 1, '[N] Progress Save: Progress records current chapter index 1');

    // Delta-Write baseline snapshot: capture beta_chapters & beta_books row timestamps
    const preChapterRow = await testPgAdapter.queryOne<any>('SELECT updated_at, paragraphs FROM beta_chapters WHERE book_id = ? AND chapter_index = 1', book.id);
    const preBookRow = await testPgAdapter.queryOne<any>('SELECT updated_at FROM beta_books WHERE id = ?', book.id);

    // [O] Inline Edit
    const createEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        paragraphIndex: 1,
        startOffset: 0,
        endOffset: 3, // 'Gió'
        originalText: 'Gió',
        proposedText: 'Làn gió',
        errorType: 'VAN_PHONG',
        reason: 'Tăng tính biểu cảm',
      }),
    });
    assert(createEditRes.status === 201, '[O] Inline Edit: Create edit on PostgreSQL returns 201 Created');
    const { edit } = await createEditRes.json();
    assert(edit.version === 1, '[O] Inline Edit: Initial edit version is 1');

    // [P] Edit Revision (Update Edit to Revision 2)
    const updateEditRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ proposedText: 'Ngọn gió mát lành', errorType: 'VAN_PHONG', expectedVersion: 1 }),
    });
    assert(updateEditRes.status === 200, '[P] Edit Revision: Update edit returns 200 OK');
    const { edit: updatedEdit } = await updateEditRes.json();
    assert(updatedEdit.version === 2, '[P] Edit Revision: Version incremented to 2');

    // Query Edit Revisions endpoint
    const revisionsRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit.id}/revisions`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(revisionsRes.status === 200, '[P] Edit Revision: GET revisions returns 200 OK');
    const { revisions } = await revisionsRes.json();
    assert(revisions.length === 2, '[P] Edit Revision: Exactly 2 revisions recorded');

    // Delta-Write Validation on PostgreSQL: beta_chapters & beta_books must NOT be touched
    const postChapterRow = await testPgAdapter.queryOne<any>('SELECT updated_at, paragraphs FROM beta_chapters WHERE book_id = ? AND chapter_index = 1', book.id);
    const postBookRow = await testPgAdapter.queryOne<any>('SELECT updated_at FROM beta_books WHERE id = ?', book.id);
    assert(JSON.stringify(preChapterRow.paragraphs) === JSON.stringify(postChapterRow.paragraphs), 'Delta-Write Invariant: beta_chapters.paragraphs NEVER modified during edit creation/update');
    assert(new Date(preChapterRow.updated_at).getTime() === new Date(postChapterRow.updated_at).getTime(), 'Delta-Write Invariant: beta_chapters row untouched during edit');
    assert(new Date(preBookRow.updated_at).getTime() === new Date(postBookRow.updated_at).getTime(), 'Delta-Write Invariant: beta_books row untouched during edit');

    // [Q] Optimistic Concurrency Locking on PostgreSQL
    const staleUpdateRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ proposedText: 'Cơn gió thoảng', errorType: 'VAN_PHONG', expectedVersion: 99 }),
    });
    assert(staleUpdateRes.status === 409, '[Q] Optimistic Concurrency: Stale expectedVersion rejected with 409 Conflict');
    const staleData = await staleUpdateRes.json();
    assert(staleData.code === 'EDIT_CONFLICT', '[Q] Optimistic Concurrency: Error code is EDIT_CONFLICT');

    // Controlled race condition with Promise.all
    const [raceRes1, raceRes2] = await Promise.all([
      fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ proposedText: 'Gió nhẹ nhàng', errorType: 'VAN_PHONG', expectedVersion: 2 }),
      }),
      fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ proposedText: 'Gió thoảng qua', errorType: 'VAN_PHONG', expectedVersion: 2 }),
      }),
    ]);

    const statuses = [raceRes1.status, raceRes2.status].sort();
    assert(statuses[0] === 200 && statuses[1] === 409, '[Q] Optimistic Concurrency: Controlled race: exactly 1 succeeds (200) and 1 receives conflict (409)');

    // [R] Notes: Create and List Paragraph Notes
    const createNoteRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ paragraphIndex: 0, startOffset: 0, endOffset: 8, selectedText: 'Đoạn văn', note: 'Ghi chú mở đầu' }),
    });
    assert(createNoteRes.status === 201, '[R] Notes: Create paragraph note returns 201 Created');

    const listNotesRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/notes`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(listNotesRes.status === 200, '[R] Notes: List paragraph notes returns 200 OK');
    const { notes } = await listNotesRes.json();
    assert(notes.length === 1 && notes[0].note === 'Ghi chú mở đầu', '[R] Notes: Note content matches perfectly');

    // [S] Chapter COMPLETED
    const completeCh1Res = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(completeCh1Res.status === 200, '[S] Chapter COMPLETED: Mark Chapter 1 completed returns 200 OK');

    // Create a second edit on Chapter 1 to test Admin Reject [U]
    const createEdit2Res = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ paragraphIndex: 0, startOffset: 0, endOffset: 8, originalText: 'Đoạn văn', proposedText: 'Khổ thơ', errorType: 'TYPO' }),
    });
    const { edit: edit2 } = await createEdit2Res.json();

    // Create a third edit on Chapter 1 to test Request Changes [V]
    const createEdit3Res = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ paragraphIndex: 0, startOffset: 9, endOffset: 15, originalText: 'mở đầu', proposedText: 'khởi đầu', errorType: 'VAN_PHONG' }),
    });
    const { edit: edit3 } = await createEdit3Res.json();

    // [V] Request Changes: Admin reviews Edit 3 with CHANGES_REQUESTED
    const reqChangesRes = await fetch(`${baseUrl}/api/admin/edits/${edit3.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: 'CHANGES_REQUESTED', comment: 'Từ này chưa thoát nghĩa, hãy chọn từ khác', expectedRevisionNumber: 1, expectedEditVersion: 1 }),
    });
    assert(reqChangesRes.status === 201, '[V] Request Changes: Review decision CHANGES_REQUESTED returns 201 Created');

    // Beta A submits updated revision for Edit 3
    await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/edits/${edit3.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ proposedText: 'mở màn', errorType: 'VAN_PHONG', expectedVersion: 1 }),
    });

    // [U] Admin Reject: Admin reviews Edit 2 with REJECTED
    const rejectRes = await fetch(`${baseUrl}/api/admin/edits/${edit2.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: 'REJECTED', comment: 'Không chính xác', expectedRevisionNumber: 1, expectedEditVersion: 1 }),
    });
    assert(rejectRes.status === 201, '[U] Admin Reject: Review decision REJECTED returns 201 Created');

    // [T] Admin Accept: Admin reviews Edit 1 (revision 3 from race) & Edit 3 with ACCEPTED
    const currentEdit1 = await testPgAdapter.queryOne<any>('SELECT version FROM beta_edits WHERE id = ?', edit.id);
    const acceptRes = await fetch(`${baseUrl}/api/admin/edits/${edit.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: 'ACCEPTED', comment: 'Duyệt bản sửa', expectedRevisionNumber: currentEdit1.version, expectedEditVersion: currentEdit1.version }),
    });
    assert(acceptRes.status === 201, '[T] Admin Accept: Review decision ACCEPTED returns 201 Created');

    await fetch(`${baseUrl}/api/admin/edits/${edit3.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: 'ACCEPTED', comment: 'Đồng ý mở màn', expectedRevisionNumber: 2, expectedEditVersion: 2 }),
    });

    // Re-mark chapter 1 completed after new edits
    await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    });

    // [X] Chapter Approval (Admin approves Chapter 1)
    const approveCh1Res = await fetch(`${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/1/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(approveCh1Res.status === 200, '[X] Chapter Approval: Approve Chapter 1 on PostgreSQL returns 200 OK');

    // [W] Approved Version Reconstruction
    const approvedVerRes = await fetch(`${baseUrl}/api/books/${book.id}/chapters/1/approved`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(approvedVerRes.status === 200, '[W] Approved Version: Query approved chapter version returns 200 OK');
    const approvedData = await approvedVerRes.json();
    assert(approvedData.acceptedEditsCount === 2, '[W] Approved Version: Exactly 2 accepted edits incorporated');
    assert(approvedData.paragraphs[0].includes('mở màn'), '[W] Approved Version: Reconstructed text includes Edit 3 accepted revision');

    // [J] Assignment IDOR Defenses on PostgreSQL
    const betaBLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'beta_bob', password: 'password123' }),
    });
    const { token: tokenB } = await betaBLoginRes.json();

    const idorBookRes = await fetch(`${baseUrl}/api/books/${book2.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(idorBookRes.status === 403, '[J] Assignment IDOR: Beta A accessing Book 2 (assigned to B) returns 403 Forbidden');

    const idorChapterRes = await fetch(`${baseUrl}/api/books/${book2.id}/chapters/1`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(idorChapterRes.status === 403, '[J] Assignment IDOR: Beta A accessing Chapter of Book 2 returns 403 Forbidden');

    const readerAdminRes = await fetch(`${baseUrl}/api/admin/beta-readers`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(readerAdminRes.status === 403, '[J] Assignment IDOR: Beta Reader calling Admin endpoint returns 403 Forbidden');

    // [I] Disabled Account Token Rejection
    await fetch(`${baseUrl}/api/admin/beta-readers/${betaA.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ isActive: false }),
    });

    const disabledUserRes = await fetch(`${baseUrl}/api/books`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(disabledUserRes.status === 401, '[I] Disabled Account: Deactivated Beta Reader token immediately rejected with 401');

    // Reactivate Beta A
    await fetch(`${baseUrl}/api/admin/beta-readers/${betaA.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ isActive: true }),
    });

    // Complete & Approve Chapters 2 and 3
    await fetch(`${baseUrl}/api/books/${book.id}/chapters/2/complete`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
    await fetch(`${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/2/approve`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });
    await fetch(`${baseUrl}/api/books/${book.id}/chapters/3/complete`, { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` } });
    await fetch(`${baseUrl}/api/admin/books/${book.id}/assignments/${assignment.id}/chapters/3/approve`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } });

    // [Y] Readiness Endpoint (Derived State Verification)
    const readinessRes = await fetch(`${baseUrl}/api/admin/books/${book.id}/readiness`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(readinessRes.status === 200, '[Y] Readiness Endpoint: GET readiness returns 200 OK on PostgreSQL');
    const readiness = await readinessRes.json();
    assert(readiness.ready === true, '[Y] Readiness Endpoint: Book derived ready state is true on PostgreSQL');
    assert(readiness.state === 'READY_TO_PUBLISH', '[Y] Readiness Endpoint: State is READY_TO_PUBLISH on PostgreSQL');
    assert(readiness.totalChapters === 3, '[Y] Readiness Endpoint: Total chapters is 3');
    assert(readiness.betaCompleted === 3, '[Y] Readiness Endpoint: All 3 chapters are Beta COMPLETED');
    assert(readiness.approved === 3, '[Y] Readiness Endpoint: All 3 chapters are Admin APPROVED');
    assert(readiness.pendingEdits === 0, '[Y] Readiness Endpoint: Zero pending edits');
    assert(readiness.changesRequested === 0, '[Y] Readiness Endpoint: Zero changes requested');
    assert(readiness.conflicts === 0, '[Y] Readiness Endpoint: Zero conflicts');
    assert(readiness.blockers.length === 0, '[Y] Readiness Endpoint: Zero blockers remaining');

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedAssertions} POSTGRESQL LIVE INTEGRATION ASSERTIONS PASSED!`);
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ POSTGRES INTEGRATION TESTS: FAILED');
    console.error('Fatal Error during live PostgreSQL testing:', error);
    process.exit(1);
  } finally {
    if (appServer) {
      appServer.close();
    }
    setAdapter(null);
    if (testPgAdapter) {
      await testPgAdapter.close();
    }

    // Safety check before dropping schema: MUST start with 'lilybeta_test_'
    if (testSchemaName && testSchemaName.startsWith('lilybeta_test_')) {
      try {
        console.log(`  Cleaning up isolated test schema "${testSchemaName}"...`);
        await rootPgAdapter.exec(`DROP SCHEMA IF EXISTS "${testSchemaName}" CASCADE;`);
        console.log(`  ✓ Test schema "${testSchemaName}" dropped successfully.`);
      } catch (cleanupErr: any) {
        console.warn('  ⚠️ Error dropping test schema:', cleanupErr.message);
      }
    } else {
      console.error(`  ⚠️ SAFETY ABORT: Refusing to drop schema "${testSchemaName}" (must start with lilybeta_test_).`);
    }

    await rootPgAdapter.close();
    await closeDatabase();
  }
};

runPostgresParityTests().catch((err) => {
  console.error('Fatal Parity Test Error:', err);
  process.exit(1);
});
