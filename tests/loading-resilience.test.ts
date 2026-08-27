import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { ApiClient, ApiError } from '../src/services/api.js';
import { RequestDeduplicator } from '../src/services/requestDedupe.js';
import { ChapterCache } from '../src/cache/chapterCache.js';
import { BetaCloudBookSource } from '../src/book-engine/source/BetaCloudBookSource.js';
import { api } from '../src/services/api.js';
import { createApp } from '../server/app.js';
import { setAdapter } from '../server/db/database.js';
import type { DatabaseAdapter } from '../server/db/DatabaseAdapter.js';
import { JWT_SECRET } from '../server/middleware/auth.js';

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('API: bounded wait aborts fetch and releases deduplication for retries', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };
    const client = new ApiClient(15);
    const one = client.get('/timeout-test');
    const two = client.get('/timeout-test');
    assert.equal(one, two);
    await assert.rejects(one, (err: ApiError) => err.code === 'REQUEST_TIMEOUT');
    assert.equal(calls, 1);
    assert.equal(RequestDeduplicator.isInFlight('GET:anon:/timeout-test'), false);
    globalThis.fetch = async () => json({ ok: true });
    assert.deepEqual(await client.get('/timeout-test'), { ok: true });
  } finally { globalThis.fetch = original; }
});

test('API: timeout also covers a stalled response body', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => new Response(new ReadableStream({
      start(controller) {
        options!.signal!.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    }), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(new ApiClient(15).get('/body-timeout'), (err: ApiError) => err.code === 'REQUEST_TIMEOUT');
  } finally { globalThis.fetch = original; }
});

test('API: HTML rewrites and broken JSON become explicit errors; empty 204 is supported', async () => {
  const original = globalThis.fetch;
  try {
    const client = new ApiClient();
    globalThis.fetch = async () => new Response('<html>SPA fallback</html>');
    await assert.rejects(client.get('/html'), (err: ApiError) => err.code === 'INVALID_RESPONSE');
    globalThis.fetch = async () => new Response('{', { headers: { 'content-type': 'application/json' } });
    await assert.rejects(client.get('/json'), (err: ApiError) => err.code === 'INVALID_RESPONSE');
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await client.delete('/empty'), undefined);
  } finally { globalThis.fetch = original; }
});

test('API: blocked storage does not crash rendering/login/logout', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  try {
    const client = new ApiClient();
    assert.equal(client.getToken(), null);
    client.setToken('test-session');
    assert.equal(client.getToken(), 'test-session');
    client.clearToken();
    assert.equal(client.getToken(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Express: database rejections from controllers and access middleware return JSON instead of hanging', async () => {
  let mode = 'failure';
  const adapter = {
    provider: 'sqlite',
    async queryOne(sql: string) {
      if (mode === 'assignment' && sql.includes('FROM profiles')) {
        return { id: 'test-reader', role: 'BETA_READER', is_active: 1 };
      }
      throw new Error('simulated database outage');
    },
  } as unknown as DatabaseAdapter;
  setAdapter(adapter);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = jwt.sign({ id: 'test-reader' }, JWT_SECRET);
  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'synthetic-test-user', password: 'synthetic-test-password' }), signal: AbortSignal.timeout(2000),
    });
    assert.equal(login.status, 500);
    assert.ok((await login.json()).error);
    const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
    assert.equal(me.status, 500, 'database outage must not be reported as invalid credentials');
    mode = 'assignment';
    const book = await fetch(`${base}/api/books/example`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
    assert.equal(book.status, 500);
    const invalid = await fetch(`${base}/api/auth/me`, { headers: { Authorization: 'Bearer invalid' } });
    assert.equal(invalid.status, 401);
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'NOT_FOUND');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    setAdapter(null);
  }
});

test('Reader: a pending cache write does not delay displaying a downloaded chapter', async () => {
  const originalGet = api.get;
  const originalCacheGet = ChapterCache.getCachedChapter;
  const originalCacheSet = ChapterCache.setCachedChapter;
  const chapter = { id: 'chapter-test', bookId: 'book-test', index: 1, title: 'Test', paragraphs: ['Test content'], wordCount: 2 };
  let finishWrite!: () => void;
  try {
    ChapterCache.getCachedChapter = async () => null;
    ChapterCache.setCachedChapter = () => new Promise(resolve => { finishWrite = resolve; });
    api.get = async <T>() => ({ chapter }) as T;
    assert.deepEqual(await BetaCloudBookSource.getInstance().getChapter('book-test', 1), chapter);
  } finally {
    finishWrite?.();
    api.get = originalGet;
    ChapterCache.getCachedChapter = originalCacheGet;
    ChapterCache.setCachedChapter = originalCacheSet;
  }
});

test('Cache: blocked IndexedDB opening falls back instead of hanging', async () => {
  const w = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const i = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const fakeIndexedDB = { open() {
    const request: any = {};
    queueMicrotask(() => request.onblocked());
    return request;
  } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: fakeIndexedDB } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fakeIndexedDB });
  try {
    assert.equal(await ChapterCache.getCachedChapter('blocked-user', 'blocked-book', 1), null);
  } finally {
    if (w) Object.defineProperty(globalThis, 'window', w); else Reflect.deleteProperty(globalThis, 'window');
    if (i) Object.defineProperty(globalThis, 'indexedDB', i); else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});

test('API: failed storage writes cannot restore a stale token after login/logout', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => 'stale-token',
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); },
  } });
  try {
    const client = new ApiClient();
    assert.equal(client.getToken(), 'stale-token');
    client.setToken('new-token');
    assert.equal(client.getToken(), 'new-token');
    client.clearToken();
    assert.equal(client.getToken(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Cache: rejected transactions fall back to memory and stalled opening has a deadline', async () => {
  const w = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const i = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const db: any = {
    close() {},
    transaction() {
      const tx: any = { objectStore() { return { get() { return {}; } }; } };
      queueMicrotask(() => tx.onabort());
      return tx;
    },
  };
  let stalled = false;
  const fakeIndexedDB = { open() {
    const request: any = { result: db };
    if (!stalled) queueMicrotask(() => request.onsuccess());
    return request;
  } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { indexedDB: fakeIndexedDB } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fakeIndexedDB });
  try {
    assert.equal(await ChapterCache.getCachedChapter('abort-user', 'test-book', 1), null);
    db.onversionchange();
    stalled = true;
    const start = Date.now();
    assert.equal(await ChapterCache.getCachedChapter('stalled-user', 'test-book', 1), null);
    assert.ok(Date.now() - start < 2500);
  } finally {
    if (w) Object.defineProperty(globalThis, 'window', w); else Reflect.deleteProperty(globalThis, 'window');
    if (i) Object.defineProperty(globalThis, 'indexedDB', i); else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
