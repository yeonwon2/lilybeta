import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { TxtImporter } from '../src/book-engine/importers/TxtImporter.js';
import { sourceHash } from '../server/integrations/editorContract.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PROVIDER = 'sqlite';
const directory = mkdtempSync(join(tmpdir(), 'lilybeta-sync-test-'));
process.env.DB_PATH = join(directory, 'test.db');
const { createApp } = await import('../server/app.js');
const { runMigrations } = await import('../server/migrations/runner.js');
const { queryOne, queryAll, run, closeDatabase, setAdapter, getAdapter } = await import('../server/db/database.js');
if (process.env.SYNC_TEST_PGLITE === 'true') {
  const { PgliteAdapter } = await import('./helpers/pgliteAdapter.js');
  const { runPostgresMigrations } = await import('../server/migrations/postgresRunner.js');
  const adapter = new PgliteAdapter();
  setAdapter(adapter);
  await runPostgresMigrations(adapter as any);
  // Re-running migrations must leave existing mappings/schema untouched.
  await runPostgresMigrations(adapter as any);
} else {
  await runMigrations();
}
const server = createApp().listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
let assertions = 0;
function check(condition: unknown, label: string) { assert.ok(condition, label); assertions++; console.log(`✓ ${label}`); }
async function request(path: string, token = '', body?: unknown, expected = 200, method?: string) {
  const response = await fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
const secret = 'synthetic-integration-secret-only-for-local-tests';
const timestamp = (n: number) => new Date(Date.now() - 100_000 + n * 1000).toISOString();
const stamp = timestamp(0);
const ch = (id: string, index: number, content = 'Hắn nhìn nàng.', updatedAt = stamp) => ({ editorChapterId: id, chapterIndex: index, title: `Chương ${index}`, paragraphs: [content], sourceVersion: updatedAt, updatedAt });
const generalRules = [{ name: 'Đổi ngôi', from_words: ['Ta'], to_words: ['Tôi'] }];
const narrativeRules = [{ character: 'A', pronoun: 'nàng', note: 'lời dẫn' }];
const pairRules = [{ speaker: 'A', listener: 'B', self_word: 'ta', target_word: 'ngươi', note: 'khi riêng tư' }];
const payload = (chapters: any[], id = 'source-book', total = 30, overwriteExisting = false) => ({ editorBookId: id, overwriteExisting, book: { title: 'Truyện từ Editor', author: 'Tác giả', totalChapters: total, pronounRules: generalRules, narrativePronounRules: narrativeRules, contextualPronounRules: pairRules }, chapters });
async function workflow(bookId: string, admin: string, beta: string, userId: string) {
  const assignment = (await request(`/admin/books/${bookId}/assign`, admin, { betaUserId: userId })).assignment;
  await request(`/books/${bookId}/chapters/1`, beta);
  const edit = (await request(`/books/${bookId}/chapters/1/edits`, beta, { paragraphIndex: 0, startOffset: 0, endOffset: 3, originalText: 'Hắn', proposedText: 'Chàng', errorType: 'XUNG_HO' }, 201)).edit;
  await request(`/books/${bookId}/chapters/1/complete`, beta, {});
  const detail = await request(`/admin/books/${bookId}/assignments/${assignment.id}/chapters/1/review`, admin);
  check(detail.edits[0].id === edit.id, 'Review sees the Beta edit');
  await request(`/admin/edits/${edit.id}/reviews`, admin, { decision: 'ACCEPTED', expectedEditVersion: 1, expectedRevisionNumber: 1 }, 201);
  await request(`/admin/books/${bookId}/assignments/${assignment.id}/chapters/1/approve`, admin, {});
  const approved = await request(`/books/${bookId}/chapters/1/approved?assignmentId=${assignment.id}`, admin);
  check(approved.paragraphs[0].startsWith('Chàng'), 'Assign → edit → complete → review → approve PASS');
  // File export path is Admin-only and reads the stored snapshot, never live edits.
  const listing = await request(`/admin/books/${bookId}/approved-export/chapters?assignmentId=${assignment.id}`, admin);
  check(listing.chapters.every((c: any) => !('paragraphs' in c) && !('content' in c)), 'Export selection returns metadata only');
  const selected = listing.chapters.find((c: any) => c.chapterNumber === 1);
  const exportBody = { assignmentId: assignment.id, chapters: [{ id: selected.id, snapshotVersion: selected.snapshotVersion }] };
  await request(`/admin/books/${bookId}/approved-export/export`, beta, exportBody, 403);
  const exported = await request(`/admin/books/${bookId}/approved-export/export`, admin, exportBody);
  check(exported.chapters[0].content === approved.paragraphs.join('\n\n'), 'Stored approval snapshot exports exact accepted content');
  const { exportTxt } = await import('../src/exports/documentExport.js');
  check(exportTxt(exported.chapters).includes(exported.chapters[0].content), 'Editor/manual → review → TXT export includes exact approved text');
  const liveEdit = await queryOne<any>('SELECT current_text FROM beta_edits WHERE id = ?', edit.id);
  await run('UPDATE beta_edits SET current_text = ? WHERE id = ?', 'DRAFT MUST NEVER EXPORT', edit.id);
  const afterDraftChange = await request(`/admin/books/${bookId}/approved-export/export`, admin, exportBody);
  check(afterDraftChange.chapters[0].content === exported.chapters[0].content, 'Live mutable edit changes cannot enter export');
  await run('UPDATE beta_edits SET current_text = ? WHERE id = ?', liveEdit.current_text, edit.id);
  const staleExport = await request(`/admin/books/${bookId}/approved-export/export`, admin, { ...exportBody, chapters: [{ id: selected.id, snapshotVersion: selected.snapshotVersion + 1 }] });
  check(!!staleExport.chapters[0].error, 'Changed snapshot version is blocked');
  return assignment;
}
try {
  // First prove old path works when integration is unconfigured.
  const admin = (await request('/auth/login', '', { username: 'admin', password: 'admin123456' })).token;
  const user = (await request('/admin/beta-readers', admin, { username: 'sync-reader', password: 'synthetic-reader-password', displayName: 'Reader' }, 201)).reader;
  const beta = (await request('/auth/login', '', { username: 'sync-reader', password: 'synthetic-reader-password' })).token;
  const draft = await TxtImporter.parseFile(new File(['Hắn nhìn nàng.'], 'manual.txt', { type: 'text/plain' }));
  const manual = (await request('/admin/books', admin, draft, 201)).book;
  check(!(await queryOne('SELECT id FROM editor_book_links WHERE beta_book_id = ?', manual.id)), 'Manual TXT import requires no Editor mapping');
  await workflow(manual.id, admin, beta, user.id);
  const manualBefore = JSON.stringify(await queryAll('SELECT * FROM beta_chapters WHERE book_id = ?', manual.id));
  await request('/integrations/editor/sync', secret, payload([ch('a', 1)]), 503);
  process.env.EDITOR_SYNC_SECRET = secret;
  process.env.EDITOR_SYNC_ADMIN_ID = 'admin-root-id';
  await request('/integrations/editor/sync', admin, payload([ch('a', 1)]), 401);
  await request('/integrations/editor/sync', beta, payload([ch('a', 1)]), 401);
  await request('/integrations/editor/sync', '', payload([ch('a', 1)]), 401);
  await request('/admin/books', secret, undefined, 401);
  await request('/admin/beta-readers', secret, { username: 'forbidden' }, 401);
  check(true, 'Integration token and browser JWT scopes are separate');
  const first = await request('/integrations/editor/sync', secret, payload(Array.from({ length: 20 }, (_, i) => ch(`chapter-${i + 1}`, i + 1))));
  check(first.createdBook && first.totalChapters === 20 && first.syncState === 'PARTIAL', 'First partial sync creates exactly selected chapters');
  const storedRules = await queryOne<any>('SELECT pronoun_rules, narrative_pronoun_rules, contextual_pronoun_rules FROM beta_books WHERE id = ?', first.betaBookId);
  check(JSON.parse(storedRules.pronoun_rules)[0].name === 'Đổi ngôi' && JSON.parse(storedRules.narrative_pronoun_rules)[0].pronoun === 'nàng' && JSON.parse(storedRules.contextual_pronoun_rules)[0].listener === 'B', 'Editor pronoun tables are stored at book level');
  const firstIds = first.results.map((c: any) => c.betaChapterId);
  const rulesOnly = await request('/integrations/editor/sync', secret, { editorBookId: 'source-book', rulesOnly: true, book: { title: 'Truyện từ Editor', pronounRules: [{ name: 'Cập nhật', from_words: ['Ta'], to_words: ['Mình'] }], contextualPronounRules: pairRules }, chapters: [] });
  check(rulesOnly.rulesUpdated === true && rulesOnly.results.length === 0, 'Rules-only sync updates book context without sending chapters');
  const rulesOnlyStored = await queryOne<any>('SELECT pronoun_rules FROM beta_books WHERE id = ?', first.betaBookId);
  check(JSON.parse(rulesOnlyStored.pronoun_rules)[0].to_words[0] === 'Mình', 'Rules-only sync persists the updated rule table');
  await request('/integrations/editor/sync', secret, { editorBookId: 'never-sent', rulesOnly: true, book: { title: 'Chưa gửi', pronounRules: generalRules }, chapters: [] }, 404);
  check(!(await queryOne("SELECT id FROM editor_book_links WHERE editor_book_id = 'never-sent'")), 'Rules-only sync cannot create an empty book before first chapter sync');
  const again = await request('/integrations/editor/sync', secret, payload(Array.from({ length: 20 }, (_, i) => ch(`chapter-${i + 1}`, i + 1))));
  check(again.results.every((c: any) => c.status === 'ALREADY_SYNCED' && c.contentVersion === 1) && again.betaBookId === first.betaBookId, 'Duplicate batch is idempotent with no version bump');
  const overlap = await request('/integrations/editor/sync', secret, payload(Array.from({ length: 11 }, (_, i) => ch(`chapter-${i + 15}`, i + 15))));
  check(overlap.totalChapters === 25 && overlap.betaBookId === first.betaBookId && overlap.results.filter((c: any) => c.status === 'ALREADY_SYNCED').length === 6 && overlap.results.filter((c: any) => c.status === 'CREATED').length === 5, 'Custom overlapping send 15–25 after 1–20 creates only five new chapters');
  const second = await request('/integrations/editor/sync', secret, payload(Array.from({ length: 10 }, (_, i) => ch(`chapter-${i + 21}`, i + 21))));
  check(second.totalChapters === 30 && second.syncState === 'SYNCED' && second.betaBookId === first.betaBookId, 'Incremental chapters 21–30 reuse same book');
  const preserved = await queryAll<any>('SELECT id FROM beta_chapters WHERE book_id = ? AND chapter_index <= 20 ORDER BY chapter_index', first.betaBookId);
  check(JSON.stringify(preserved.map(r => r.id)) === JSON.stringify(firstIds), 'Earlier chapter identities preserved');
  const changed = ch('chapter-1', 1, 'Hắn nhìn nàng và mỉm cười.', timestamp(1));
  const updated = await request('/integrations/editor/sync', secret, payload([changed]));
  check(updated.results[0].status === 'UPDATED' && updated.results[0].contentVersion === 2 && updated.results[0].betaChapterId === firstIds[0], 'Safe pre-assignment source update bumps cache version and preserves identity');
  const titleChange = { ...changed, title: 'Tiêu đề mới', updatedAt: timestamp(2), sourceVersion: timestamp(2) };
  const titleUpdated = await request('/integrations/editor/sync', secret, payload([titleChange]));
  check(titleUpdated.results[0].contentVersion === 3, 'Title-only update also invalidates cached title');
  const stale = await request('/integrations/editor/sync', secret, payload([changed]));
  check(stale.results[0].status === 'STALE_SOURCE', 'Older source cannot overwrite newer content');
  const collision = await request('/integrations/editor/sync', secret, payload([{ ...titleChange, paragraphs: ['Different same version'] }]));
  check(collision.results[0].status === 'SOURCE_VERSION_CONFLICT', 'Same version/different text is rejected');
  const clear = await request('/integrations/editor/sync', secret, payload([titleChange]));
  check(clear.syncState === 'SYNCED', 'Retry matching accepted source clears version conflict');
  await request('/integrations/editor/sync', secret, payload([{ ...changed, contentHash: 'forged' }]), 400);
  await request('/integrations/editor/sync', secret, payload(Array.from({ length: 26 }, (_, i) => ch(`too-many-${i}`, i + 1))), 400);
  await request('/integrations/editor/sync', secret, payload([ch('dup', 1), ch('dup', 2)]), 400);
  await request('/integrations/editor/sync', secret, payload([ch('dup', 1), ch('dup2', 1)]), 400);
  await request('/integrations/editor/sync', secret, { ...payload([ch('invalid-overwrite', 1)]), overwriteExisting: 'yes' }, 400);
  await request('/integrations/editor/sync', secret, { ...payload([ch('invalid-rules', 1)]), book: { ...payload([], 'x').book, contextualPronounRules: [{ speaker: '', listener: 'B', self_word: 'ta', target_word: 'ngươi' }] } }, 400);
  check(true, 'Batch limits, duplicate identity/order and forged client hashes rejected');
  const validHash = ch('hash-source', 1); delete (validHash as any).sourceVersion;
  (validHash as any).contentHash = sourceHash(validHash.title, validHash.paragraphs);
  await request('/integrations/editor/sync', secret, payload([validHash], 'hash-book', 1));
  check(true, 'Hash + updatedAt source accepted without numeric version');
  const beforeCount = Number((await queryOne<any>('SELECT COUNT(*) AS n FROM beta_books'))?.n);
  await request('/integrations/editor/sync', secret, payload([ch('new-rollback', 1), ch('chapter-1', 2)], 'cross-book', 2), 409);
  check(Number((await queryOne<any>('SELECT COUNT(*) AS n FROM beta_books'))?.n) === beforeCount && !(await queryOne("SELECT id FROM editor_chapter_links WHERE editor_chapter_id = 'new-rollback'")), 'Cross-book identity collision rolls back entire batch/book');
  const concurrent = await Promise.all([request('/integrations/editor/sync', secret, payload([ch('parallel', 1)], 'parallel', 1)), request('/integrations/editor/sync', secret, payload([ch('parallel', 1)], 'parallel', 1))]);
  check(concurrent[0].betaBookId === concurrent[1].betaBookId && JSON.stringify(concurrent.map(result => result.results[0].status).sort()) === JSON.stringify(['ALREADY_SYNCED', 'CREATED']) && Number((await queryOne<any>("SELECT COUNT(*) AS n FROM editor_book_links WHERE editor_book_id = 'parallel'"))?.n) === 1 && Number((await queryOne<any>("SELECT COUNT(*) AS n FROM editor_chapter_links WHERE editor_chapter_id = 'parallel'"))?.n) === 1, 'Concurrent first sync creates one mapping and one chapter regardless of request order');
  const sparse = await request('/integrations/editor/sync', secret, payload([ch('only-13', 13)], 'sparse', 30));
  check(sparse.totalChapters === 1 && sparse.results[0].betaChapterIndex === 1, 'Current source chapter 13 works with existing dense Beta navigation');
  const moved = await request('/integrations/editor/sync', secret, payload([ch('only-13', 2, 'Hắn nhìn nàng.', timestamp(1))], 'sparse', 30));
  check(moved.results[0].status === 'UPDATED', 'Title follows source metadata while target identity remains stable');
  check(moved.results[0].betaChapterIndex === 1 && moved.results[0].betaChapterId === sparse.results[0].betaChapterId, 'Reorder never changes Beta positions/anchors');
  // New source enters precisely the existing workflow.
  await workflow(first.betaBookId, admin, beta, user.id);
  const visibleBook = (await request(`/books/${first.betaBookId}`, beta)).book;
  check(visibleBook.pronounRules[0].to_words[0] === 'Tôi' && visibleBook.narrativePronounRules[0].pronoun === 'nàng' && visibleBook.contextualPronounRules[0].target_word === 'ngươi', 'Assigned Beta reader can load all rule tables with book metadata');
  const sourceBefore = JSON.stringify(await queryAll('SELECT * FROM beta_chapters WHERE book_id = ?', first.betaBookId));
  const editsBefore = JSON.stringify(await queryAll('SELECT * FROM beta_edits WHERE book_id = ?', first.betaBookId));
  const reviewsBefore = JSON.stringify(await queryAll('SELECT * FROM beta_chapter_reviews WHERE book_id = ?', first.betaBookId));
  const conflict = await request('/integrations/editor/sync', secret, payload([ch('chapter-1', 1, 'Nội dung khác phá anchor', timestamp(5))]));
  check(conflict.results[0].status === 'SOURCE_CONFLICT' && conflict.syncState === 'CONFLICT', 'Approved source edit returns persistent SOURCE_CONFLICT');
  check(JSON.stringify(await queryAll('SELECT * FROM beta_chapters WHERE book_id = ?', first.betaBookId)) === sourceBefore && JSON.stringify(await queryAll('SELECT * FROM beta_edits WHERE book_id = ?', first.betaBookId)) === editsBefore && JSON.stringify(await queryAll('SELECT * FROM beta_chapter_reviews WHERE book_id = ?', first.betaBookId)) === reviewsBefore, 'Conflict preserves original content, edit anchors and approval snapshot byte-for-byte');
  const append = await request('/integrations/editor/sync', secret, payload([ch('chapter-31', 31)], 'source-book', 31));
  check(append.results[0].status === 'CREATED' && append.totalChapters === 31 && append.syncState === 'CONFLICT', 'Append works during Beta; previous conflict is not hidden');
  const unreadConflict = await request('/integrations/editor/sync', secret, payload([ch('chapter-2', 2, 'Different', timestamp(2))]));
  check(unreadConflict.results[0].reason === 'BOOK_ALREADY_ASSIGNED', 'Conservative cache safety locks source after assignment');
  const overwritten = await request('/integrations/editor/sync', secret, payload([ch('chapter-1', 1, 'Nội dung nguồn đã sửa hoàn chỉnh', timestamp(6))], 'source-book', 31, true));
  check(overwritten.results[0].status === 'OVERWRITTEN' && overwritten.results[0].betaChapterId === firstIds[0] && overwritten.results[0].contentVersion === 4, 'Explicit overwrite replaces source while preserving chapter identity');
  const overwrittenChapter = await queryOne<any>('SELECT paragraphs FROM beta_chapters WHERE id = ?', firstIds[0]);
  const overwrittenParagraphs = Array.isArray(overwrittenChapter.paragraphs) ? overwrittenChapter.paragraphs : JSON.parse(overwrittenChapter.paragraphs);
  check(overwrittenParagraphs[0] === 'Nội dung nguồn đã sửa hoàn chỉnh', 'Overwritten chapter stores the amended Editor content');
  check((await queryAll('SELECT * FROM beta_edits WHERE chapter_id = ?', firstIds[0])).length === 0 && (await queryAll('SELECT * FROM beta_notes WHERE chapter_id = ?', firstIds[0])).length === 0 && (await queryAll('SELECT * FROM beta_chapter_reviews WHERE chapter_id = ?', firstIds[0])).length === 0, 'Overwrite removes stale paragraph anchors and approval snapshots for that chapter');
  const resetStatus = await queryOne<any>('SELECT status, last_scroll_percent, last_scroll_offset FROM beta_chapter_status WHERE chapter_id = ?', firstIds[0]);
  check(resetStatus.status === 'NOT_STARTED' && Number(resetStatus.last_scroll_percent) === 0 && Number(resetStatus.last_scroll_offset) === 0, 'Overwrite resets only the affected chapter workflow');
  // 305 real synthetic source rows, selected five bodies only.
  let largeBookId = '';
  for (let offset = 0; offset < 305; offset += 25) {
    const batch = Array.from({ length: Math.min(25, 305 - offset) }, (_, i) => ch(`large-${offset + i + 1}`, offset + i + 1));
    largeBookId = (await request('/integrations/editor/sync', secret, payload(batch, 'large-synthetic-book', 305))).betaBookId;
  }
  const largeAssignment = (await request(`/admin/books/${largeBookId}/assign`, admin, { betaUserId: user.id })).assignment;
  for (let index = 101; index <= 105; index++) {
    const edit = (await request(`/books/${largeBookId}/chapters/${index}/edits`, beta, { paragraphIndex: 0, startOffset: 0, endOffset: 3, originalText: 'Hắn', proposedText: 'Chàng', errorType: 'XUNG_HO' }, 201)).edit;
    await request(`/books/${largeBookId}/chapters/${index}/complete`, beta, {});
    await request(`/admin/edits/${edit.id}/reviews`, admin, { decision: 'ACCEPTED', expectedEditVersion: 1, expectedRevisionNumber: 1 }, 201);
    await request(`/admin/books/${largeBookId}/assignments/${largeAssignment.id}/chapters/${index}/approve`, admin, {});
  }
  const adapter = getAdapter(); const originalQueryAll = adapter.queryAll.bind(adapter); let bodiesRead = 0;
  adapter.queryAll = ((sql: string, ...args: any[]) => {
    const result = originalQueryAll(sql, ...args);
    if (/c\.paragraphs/.test(sql)) return Promise.resolve(result).then(rows => { bodiesRead += rows.length; return rows; });
    return result;
  }) as typeof adapter.queryAll;
  const listing305 = await request(`/admin/books/${largeBookId}/approved-export/chapters?assignmentId=${largeAssignment.id}`, admin);
  check(listing305.chapters.length === 305 && bodiesRead === 0, '305-chapter selection loads zero bodies');
  const selected5 = listing305.chapters.filter((c: any) => c.chapterNumber >= 101 && c.chapterNumber <= 105);
  let exportData: any = null; const exported5 = [];
  for (const chapter of selected5) {
    exportData = await request(`/admin/books/${largeBookId}/approved-export/export`, admin, { assignmentId: largeAssignment.id, chapters: [{ id: chapter.id, snapshotVersion: chapter.snapshotVersion }] });
    exported5.push(...exportData.chapters);
  }
  adapter.queryAll = originalQueryAll;
  check(bodiesRead === 5 && exported5.length === 5 && exported5.every(c => c.content === 'Chàng nhìn nàng.'), 'Selected 101–105 from 305: exactly five approved bodies reconstructed');
  const { exportTxt } = await import('../src/exports/documentExport.js');
  check(exportTxt(exported5).includes('Chương 105'), 'Selected TXT contains chapter headings for LilyHub importer');
  await request(`/admin/books/${largeBookId}/assignments/${largeAssignment.id}/chapters/101/reopen`, admin, {});
  const reopened = await request(`/admin/books/${largeBookId}/approved-export/export`, admin, { assignmentId: largeAssignment.id, chapters: [{ id: selected5[0].id, snapshotVersion: selected5[0].snapshotVersion }] });
  check(!!reopened.chapters[0].error, 'Reopened approved chapter is blocked from export');
  const state = await request('/integrations/editor/books/source-book', secret);
  check(state.chapters.length === 31 && state.chapters[0].syncStatus === 'SYNCED' && !JSON.stringify(state).includes('paragraphs'), 'Status checkpoint is metadata-only and reflects successful overwrite');
  check(JSON.stringify(await queryAll('SELECT * FROM beta_chapters WHERE book_id = ?', manual.id)) === manualBefore, 'Manual book remains untouched by every integration operation');
  if (process.env.SYNC_TEST_PGLITE === 'true') {
    const { getAdapter } = await import('../server/db/database.js');
    const adapter = getAdapter();
    await adapter.exec('CREATE ROLE editor_sync_untrusted; GRANT USAGE ON SCHEMA public TO editor_sync_untrusted; GRANT SELECT ON editor_book_links, editor_chapter_links TO editor_sync_untrusted');
    try {
      await adapter.exec('SET ROLE editor_sync_untrusted');
      check((await queryAll('SELECT * FROM editor_book_links')).length === 0 && (await queryAll('SELECT * FROM editor_chapter_links')).length === 0, 'RLS prevents direct client access to integration mappings');
    } finally { await adapter.exec('RESET ROLE'); }
  }

  // The optional bridge test calls the real Editor server implementation against this real LilyBeta API.
  if (process.env.EDITOR_SYNC_TEST_CHECKOUT) {
    const editorServerUrl = pathToFileURL(join(process.env.EDITOR_SYNC_TEST_CHECKOUT, 'server', 'lilybetaSync.js')).href;
    const { createLilyBetaSyncHandler } = await import(editorServerUrl);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const chapterId = '22222222-2222-4222-8222-222222222222';
    const userId = '33333333-3333-4333-8333-333333333333';
    const env = { NODE_ENV: 'test', LILYBETA_SYNC_SECRET: secret, LILYBETA_SYNC_USER_IDS: userId, SUPABASE_URL: 'https://editor-test.invalid', SUPABASE_ANON_KEY: 'synthetic-anon', LILYBETA_API_URL: base.replace('/api', '') };
    const handler = createLilyBetaSyncHandler({ env, fetchImpl: async (url: string, opts: any) => {
      if (url.startsWith(env.SUPABASE_URL)) {
        const data = url.includes('/auth/') ? { id: userId } : url.includes('/projects?') ? [{ id: projectId, title: 'Editor round trip', pronoun_rules: generalRules, contextual_pronoun_rules: pairRules, style_toggles: { story_memory: { narrativeRules } } }] : [{ id: chapterId, title: 'Chương round trip', chapter_order: 0.5, updated_date: stamp, edited: 'Hắn nhìn nàng.\nĐoạn hai.' }];
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      }
      return fetch(url, opts);
    } });
    let output: any; let status = 200;
    const res = { setHeader() {}, status(n: number) { status = n; return this; }, json(data: any) { output = data; return this; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-editor-jwt' }, body: { projectId, action: 'batch', chapterIds: [chapterId] } }, res);
    check(status === 200 && output.results[0].status === 'CREATED', 'Editor server → real LilyBeta API round trip creates selected chapter');
    const roundTripBook = await queryOne<any>('SELECT pronoun_rules, narrative_pronoun_rules, contextual_pronoun_rules FROM beta_books WHERE id = ?', output.betaBookId);
    check(JSON.parse(roundTripBook.pronoun_rules)[0].name === 'Đổi ngôi' && JSON.parse(roundTripBook.narrative_pronoun_rules)[0].pronoun === 'nàng' && JSON.parse(roundTripBook.contextual_pronoun_rules)[0].speaker === 'A', 'Editor server → LilyBeta preserves all pronoun tables end to end');
    await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-editor-jwt' }, body: { projectId, action: 'plan' } }, res);
    check(status === 200 && output.chapters[0].changed === false, 'Editor plan reads server checkpoint and skips already-synced chapter');
  }
  console.log(`\nALL ${assertions} EDITOR SYNC / BACKWARD COMPATIBILITY ASSERTIONS PASSED`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDatabase();
  rmSync(directory, { recursive: true, force: true });
}
