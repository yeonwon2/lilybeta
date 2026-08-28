import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
process.env.NODE_ENV = 'test'; process.env.DATABASE_PROVIDER = 'sqlite';
const directory = mkdtempSync(join(tmpdir(), 'lily-admin-account-'));
process.env.DB_PATH = join(directory, 'test.db');
const { createApp } = await import('../server/app.js');
const { runMigrations } = await import('../server/migrations/runner.js');
const { queryOne, queryAll, closeDatabase, setAdapter } = await import('../server/db/database.js');
const { JWT_SECRET } = await import('../server/middleware/auth.js');
if (process.env.ACCOUNT_TEST_PGLITE === 'true') {
  const { PgliteAdapter } = await import('./helpers/pgliteAdapter.js');
  const { runPostgresMigrations } = await import('../server/migrations/postgresRunner.js');
  const adapter = new PgliteAdapter(); setAdapter(adapter); await runPostgresMigrations(adapter as any);
} else await runMigrations();
const server = createApp().listen(0, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
async function request(path: string, token = '', body?: any, status = 200, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}

const { quickReviewChapters } = await import('../src/beta-review/quickReview.js');
try {
  const admin = await request('/auth/login', '', { username: 'admin', password: 'admin123456' });
  const reader = await request('/admin/beta-readers', admin.token, { username: 'reader1', displayName: 'Reader', password: 'reader-password' }, 201);
  const beta = await request('/auth/login', '', { username: 'reader1', password: 'reader-password' });
  const { book } = await request('/admin/books', admin.token, { title: 'Bulk review test', author: 'Test', originalFileName: 'test.txt', fileFormat: 'TXT', chapters: [1,2,3].map(index => ({ index, title: `Chapter ${index}`, paragraphs: ['Hắn nhìn nàng.', 'Gió nhẹ.'] })) }, 201);
  const { assignment } = await request(`/admin/books/${book.id}/assign`, admin.token, { betaUserId: reader.reader.id });
  const root = `/admin/books/${book.id}/assignments/${assignment.id}/chapters`;
  const edit = async (i: number, paragraphIndex = 0) => (await request(`/books/${book.id}/chapters/${i}/edits`, beta.token, { paragraphIndex, startOffset: 0, endOffset: 3, originalText: paragraphIndex ? 'Gió' : 'Hắn', proposedText: paragraphIndex ? 'Mưa' : 'Chàng', errorType: 'XUNG_HO', reason: 'Test' }, 201)).edit;
  const first = await edit(1); const rejected = await edit(1,1); const second = await edit(2);
  const selected = { edits: [{ id: first.id, version: 1, revisionNumber: 1 }] };
  await request(`${root}/1/accept-pending`, '', selected, 401);
  await request(`${root}/1/accept-pending`, beta.token, selected, 403);
  await request(`${root}/1/accept-pending`, admin.token, selected, 409);
  await request(`${root}/1/accept-pending`, admin.token, { edits: [] }, 400);
  await request(`${root}/1/accept-pending`, admin.token, { edits: [...selected.edits, ...selected.edits] }, 400);
  for (const i of [1,2]) await request(`/books/${book.id}/chapters/${i}/complete`, beta.token, {});
  await request(`${root}/1/accept-pending`, admin.token, { edits: [...selected.edits, {id:second.id,version:1,revisionNumber:1}] }, 409);
  assert.equal((await queryAll('SELECT * FROM beta_edit_reviews WHERE edit_id = ?',first.id)).length,0);
  await request(`${root}/1/accept-pending`, admin.token, { edits: [{id:first.id,version:2,revisionNumber:2}] }, 409);
  await request(`/admin/edits/${rejected.id}/reviews`, admin.token, { decision:'ACCEPTED', expectedRevisionNumber:1, expectedEditVersion:1 },201);
  await new Promise(r => setTimeout(r,20));
  await request(`/admin/edits/${rejected.id}/reviews`, admin.token, { decision:'REJECTED', expectedRevisionNumber:1, expectedEditVersion:1 },201);
  await request(`${root}/1/accept-pending`, admin.token, { edits:[{id:rejected.id,version:1,revisionNumber:1}] },409);
  const client = {
    get: async <T>(path:string): Promise<T> => request(path,admin.token),
    post: async <T>(path:string,body?:any): Promise<T> => request(path,admin.token,body || {}),
  };
  const results:any[] = [];
  await quickReviewChapters(client,book.id,assignment.id,[1,2,3],r=>results.push(r));
  assert.deepEqual(results.map(r=>r.status),['APPROVED','APPROVED','FAILED']);
  const snapshot:any = await queryOne('SELECT * FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?', assignment.id,1);
  assert.ok(JSON.stringify(snapshot.approved_edits_snapshot).includes(first.id));
  assert.ok(!JSON.stringify(snapshot.approved_edits_snapshot).includes(rejected.id),'historical acceptance must not override rejection');
  await request(`${root}/1/accept-pending`,admin.token,selected,409);
  const repeat:any[]=[];
  await quickReviewChapters(client,book.id,assignment.id,[1,2],r=>repeat.push(r));
  assert.ok(repeat.every(r=>r.status==='SKIPPED'));
  assert.equal((await queryOne<any>('SELECT review_snapshot_version FROM beta_chapter_reviews WHERE assignment_id = ? AND chapter_index = ?',assignment.id,1)).review_snapshot_version,snapshot.review_snapshot_version);
  assert.equal((await queryAll('SELECT * FROM beta_activity_logs WHERE action = ?', 'EDITS_BULK_REVIEWED')).length,2);
  // Large selection uses bounded bulk requests, no per-edit round trips.
  const calls:any[]=[]; const outcomes:any[]=[];
  const mock = { get: async <T>():Promise<T> => ({ chapter:{isBetaCompleted:true}, counts:{changesRequested:0}, approvedVersion:{conflict:false}, edits:Array.from({length:405},(_,id)=>({id:String(id),version:1,status:'ACTIVE',derivedReviewStatus:'PENDING'})) } as T), post:async <T>(path:string,body?:any):Promise<T> => {calls.push({path,body});return {} as T;} };
  await quickReviewChapters(mock,'b','a',[1],r=>outcomes.push(r));
  assert.deepEqual(calls.slice(0,3).map(c=>c.body.edits.length),[200,200,5]);
  assert.equal(calls.length,4); assert.equal(outcomes[0].status,'APPROVED');
  for (const detail of [
    { chapter:{isBetaCompleted:true},counts:{changesRequested:1},approvedVersion:{conflict:false} },
    { chapter:{isBetaCompleted:true},counts:{changesRequested:0},approvedVersion:{conflict:true} },
  ]) {
    const blocked:any[]=[];
    await quickReviewChapters({get:async <T>()=>detail as T,post:async <T>()=>{throw new Error('Must not write');}},'b','a',[1],r=>blocked.push(r));
    assert.equal(blocked[0].status,'FAILED'); assert.ok(!blocked[0].message.includes('Must not write'));
  }
  console.log('PASS: manual import/assign/edit/complete + bulk approval, rejected snapshot, permissions, atomic stale/foreign rejection, retries and batching.');
} finally { await new Promise<void>(r => server.close(() => r())); await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
