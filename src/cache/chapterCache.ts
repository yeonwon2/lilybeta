import { CachedChapter, CachePruneOptions, CacheStats } from './cacheTypes';

const DB_NAME = 'lilybeta_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'chapters';

export const buildChapterCacheKey = (userId: string, bookId: string, chapterIndex: number): string => {
  return `${userId}:${bookId}:${chapterIndex}`;
};

// In-Memory fallback for environments without IndexedDB (e.g. Node.js unit tests / SSR)
class MemoryChapterCacheStore {
  private map = new Map<string, CachedChapter>();

  async get(key: string): Promise<CachedChapter | null> {
    const item = this.map.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async set(key: string, chapter: CachedChapter): Promise<void> {
    this.map.set(key, JSON.parse(JSON.stringify(chapter)));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clearBook(userId: string, bookId: string): Promise<void> {
    const prefix = `${userId}:${bookId}:`;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
      }
    }
  }

  async prune(maxAgeDays: number = 30, maxEntries?: number): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    const entries: { key: string; item: CachedChapter }[] = [];

    for (const [k, v] of this.map.entries()) {
      if (v.cachedAt < cutoff) {
        this.map.delete(k);
        deletedCount++;
      } else {
        entries.push({ key: k, item: v });
      }
    }

    if (maxEntries && entries.length > maxEntries) {
      entries.sort((a, b) => a.item.cachedAt - b.item.cachedAt);
      const toRemove = entries.slice(0, entries.length - maxEntries);
      for (const e of toRemove) {
        this.map.delete(e.key);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  async clearAll(): Promise<void> {
    this.map.clear();
  }
}

const memoryStore = new MemoryChapterCacheStore();

// A local cache is optional: blocked IndexedDB must never block reading.
const withCacheTimeout = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Chapter cache timed out')), 1000);
  operation.then(resolve, reject).finally(() => clearTimeout(timer));
});

class IndexedDBChapterCacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let abandoned = false;
      const timer = setTimeout(() => {
        abandoned = true;
        reject(new Error('Chapter cache opening timed out'));
      }, 1000);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
          store.createIndex('by_user', 'userId', { unique: false });
          store.createIndex('by_user_book', ['userId', 'bookId'], { unique: false });
          store.createIndex('by_cached_at', 'cachedAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.dbPromise = null; };
        resolve(db);
      };
      const fail = (error: Error | DOMException) => {
        clearTimeout(timer);
        abandoned = true;
        reject(error);
      };
      request.onerror = () => fail(request.error || new Error('Chapter cache opening failed'));
      request.onblocked = () => fail(new Error('Chapter cache opening blocked'));
    });
    this.dbPromise = opening.catch(err => {
      this.dbPromise = null;
      throw err;
    });

    return this.dbPromise;
  }

  async get(key: string): Promise<CachedChapter | null> {
    try {
      const db = await this.openDB();
      return await withCacheTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
          if (!req.result) {
            resolve(null);
            return;
          }
          const { cacheKey, ...data } = req.result;
          resolve(data as CachedChapter);
        };
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Chapter cache transaction aborted'));
      }));
    } catch (err) {
      console.warn('[ChapterCache] IndexedDB get error, fallback to memory:', err);
      return memoryStore.get(key);
    }
  }

  async set(key: string, chapter: CachedChapter): Promise<void> {
    try {
      const db = await this.openDB();
      return await withCacheTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = { ...chapter, cacheKey: key };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Chapter cache transaction aborted'));
      }));
    } catch (err) {
      console.warn('[ChapterCache] IndexedDB set error, fallback to memory:', err);
      return memoryStore.set(key, chapter);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this.openDB();
      return await withCacheTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Chapter cache transaction aborted'));
      }));
    } catch (err) {
      return memoryStore.delete(key);
    }
  }

  async clearBook(userId: string, bookId: string): Promise<void> {
    try {
      const db = await this.openDB();
      return await withCacheTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('by_user_book');
        const req = index.openCursor(IDBKeyRange.only([userId, bookId]));

        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Chapter cache transaction aborted'));
      }));
    } catch {
      return memoryStore.clearBook(userId, bookId);
    }
  }

  async prune(maxAgeDays: number = 30, maxEntries?: number): Promise<number> {
    try {
      const db = await this.openDB();
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      let deleted = 0;

      return await withCacheTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('by_cached_at');
        const range = IDBKeyRange.upperBound(cutoff);
        const req = index.openCursor(range);

        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else {
            resolve(deleted);
          }
        };
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Chapter cache transaction aborted'));
      }));
    } catch {
      return memoryStore.prune(maxAgeDays, maxEntries);
    }
  }

  async clearAll(): Promise<void> {
    try {
      const db = await this.openDB();
      return await withCacheTimeout(new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error('Chapter cache transaction aborted'));
      }));
    } catch {
      return memoryStore.clearAll();
    }
  }
}

const idbStore = new IndexedDBChapterCacheStore();

const getBackendStore = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
      return idbStore;
    }
  } catch { /* Storage access can be denied by browser policy. */ }
  return memoryStore;
};

// Telemetry state for dev/testing
let telemetryHits = 0;
let telemetryMisses = 0;

export class ChapterCache {
  /**
   * Retrieve cached chapter if it exists and matches user scope.
   */
  static async getCachedChapter(userId: string, bookId: string, chapterIndex: number): Promise<CachedChapter | null> {
    const key = buildChapterCacheKey(userId, bookId, chapterIndex);
    const store = getBackendStore();
    const item = await store.get(key);

    if (item && item.userId === userId && item.bookId === bookId && item.chapterIndex === chapterIndex) {
      telemetryHits++;
      return item;
    }

    telemetryMisses++;
    return null;
  }

  /**
   * Store parsed chapter content in local cache.
   */
  static async setCachedChapter(chapter: CachedChapter): Promise<void> {
    const key = buildChapterCacheKey(chapter.userId, chapter.bookId, chapter.chapterIndex);
    const store = getBackendStore();
    await store.set(key, {
      ...chapter,
      cachedAt: chapter.cachedAt || Date.now(),
    });
  }

  /**
   * Delete specific chapter from cache.
   */
  static async deleteCachedChapter(userId: string, bookId: string, chapterIndex: number): Promise<void> {
    const key = buildChapterCacheKey(userId, bookId, chapterIndex);
    const store = getBackendStore();
    await store.delete(key);
  }

  /**
   * Clear all cached chapters for a specific book and user.
   */
  static async clearBookCache(userId: string, bookId: string): Promise<void> {
    const store = getBackendStore();
    await store.clearBook(userId, bookId);
  }

  /**
   * Clear assignment cache (clears user's cached chapters when access changes).
   */
  static async clearAssignmentCache(userId: string, _assignmentId: string, bookId?: string): Promise<void> {
    if (bookId) {
      await this.clearBookCache(userId, bookId);
    } else {
      // If bookId is not provided, prune user entries
      await this.pruneCache();
    }
  }

  /**
   * Prune stale chapters (e.g. older than 30 days or beyond limit).
   */
  static async pruneCache(options?: CachePruneOptions): Promise<number> {
    const store = getBackendStore();
    return store.prune(options?.maxAgeDays ?? 30, options?.maxEntries);
  }

  /**
   * Developer Telemetry: get hit rate & counts (zero database impact).
   */
  static getCacheStats(): CacheStats {
    const total = telemetryHits + telemetryMisses;
    const hitRate = total > 0 ? Math.round((telemetryHits / total) * 1000) / 10 : 0;
    return {
      hits: telemetryHits,
      misses: telemetryMisses,
      totalRequests: total,
      hitRate,
    };
  }

  /**
   * Reset stats (useful for dev tools and tests).
   */
  static resetCacheStats(): void {
    telemetryHits = 0;
    telemetryMisses = 0;
  }

  /**
   * Clear all cached data (for test fixtures / user data erasure).
   */
  static async _clearAll(): Promise<void> {
    const store = getBackendStore();
    await store.clearAll();
    this.resetCacheStats();
  }
}
