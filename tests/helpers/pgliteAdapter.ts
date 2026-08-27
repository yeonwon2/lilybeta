// Test-only embedded PostgreSQL engine. Production continues using pg.Pool.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseAdapter, QueryResult } from '../../server/db/DatabaseAdapter.js';
import { translatePlaceholders } from '../../server/db/postgresAdapter.js';

export class PgliteAdapter implements DatabaseAdapter {
  readonly provider = 'postgres' as const;
  private context = new AsyncLocalStorage<Transaction>();
  private pg = new PGlite();
  private get runner() { return this.context.getStore() || this.pg; }
  async queryAll<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    return (await this.runner.query<T>(translatePlaceholders(sql), params.map(p => p === undefined ? null : p))).rows;
  }
  async queryOne<T = any>(sql: string, ...params: any[]): Promise<T | null> { return (await this.queryAll<T>(sql, ...params))[0] ?? null; }
  async run(sql: string, ...params: any[]): Promise<QueryResult> {
    const result = await this.runner.query(translatePlaceholders(sql), params.map(p => p === undefined ? null : p));
    return { changes: result.affectedRows ?? 0 };
  }
  async exec(sql: string) { await this.runner.exec(sql); }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T> | T): Promise<T> {
    if (this.context.getStore()) return fn(this);
    return this.pg.transaction(tx => this.context.run(tx, async () => fn(this)));
  }
  async close() { await this.pg.close(); }
  async isAlive() { return Boolean(await this.queryOne('SELECT 1')); }
}
