import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseAdapter, QueryResult } from './DatabaseAdapter.js';

const { Pool } = pg;

export interface TxContext {
  client: pg.PoolClient;
}

export const txStorage = new AsyncLocalStorage<TxContext>();

/**
 * Hardened deterministic SQL placeholder scanner.
 * Translates unquoted '?' to positional parameter placeholders ($1, $2, ...)
 * while preserving '?' inside:
 * 1. Single-quoted strings: 'What?' or 'O''Reilly ?'
 * 2. Double-quoted identifiers: "col?"
 * 3. Line comments: -- comment ?
 * 4. Block comments: /* comment ? * /
 * 5. Dollar-quoted strings: $$dollar ?$$
 */
export function translatePlaceholders(sql: string): string {
  let result = '';
  let paramIndex = 1;
  const len = sql.length;
  let i = 0;

  while (i < len) {
    const ch = sql[i];

    // 1. Single-quoted string literal: '...' (escaped as '')
    if (ch === "'") {
      result += ch;
      i++;
      while (i < len) {
        if (sql[i] === "'") {
          result += "'";
          i++;
          if (i < len && sql[i] === "'") {
            // Escaped single quote ''
            result += "'";
            i++;
          } else {
            // End of single-quoted string
            break;
          }
        } else {
          result += sql[i];
          i++;
        }
      }
      continue;
    }

    // 2. Double-quoted identifier: "..." (escaped as "")
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        if (sql[i] === '"') {
          result += '"';
          i++;
          if (i < len && sql[i] === '"') {
            result += '"';
            i++;
          } else {
            break;
          }
        } else {
          result += sql[i];
          i++;
        }
      }
      continue;
    }

    // 3. Line comment: -- ... (\n or EOF)
    if (ch === '-' && i + 1 < len && sql[i + 1] === '-') {
      result += '--';
      i += 2;
      while (i < len && sql[i] !== '\n') {
        result += sql[i];
        i++;
      }
      continue;
    }

    // 4. Block comment: /* ... */
    if (ch === '/' && i + 1 < len && sql[i + 1] === '*') {
      result += '/*';
      i += 2;
      while (i < len) {
        if (sql[i] === '*' && i + 1 < len && sql[i + 1] === '/') {
          result += '*/';
          i += 2;
          break;
        }
        result += sql[i];
        i++;
      }
      continue;
    }

    // 5. Dollar-quoted string in Postgres: $$...$$ or $tag$...$tag$
    if (ch === '$' && (i === 0 || /[\s,(=]/.test(sql[i - 1]))) {
      const match = sql.slice(i).match(/^\$([a-zA-Z0-9_]*)\$/);
      if (match) {
        const tag = match[0];
        result += tag;
        i += tag.length;
        const closeIdx = sql.indexOf(tag, i);
        if (closeIdx !== -1) {
          result += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
        }
        continue;
      }
    }

    // 6. Parameter placeholder: ?
    if (ch === '?') {
      result += `$${paramIndex++}`;
      i++;
      continue;
    }

    // 7. Auto-quote unquoted camelCase alias after AS: AS myColumn -> AS "myColumn"
    if ((ch === 'A' || ch === 'a') && (i + 1 < len && (sql[i + 1] === 'S' || sql[i + 1] === 's')) && (i === 0 || /[\s)]/.test(sql[i - 1]))) {
      const rest = sql.slice(i);
      const asMatch = rest.match(/^(AS\s+)([a-zA-Z_][a-zA-Z0-9_]*)/i);
      if (asMatch) {
        const alias = asMatch[2];
        if (/[A-Z]/.test(alias) && /[a-z]/.test(alias)) {
          result += `${asMatch[1]}"${alias}"`;
          i += asMatch[0].length;
          continue;
        }
      }
    }

    // Default: normal character
    result += ch;
    i++;
  }

  return result;
}

export interface PostgresAdapterOptions extends pg.PoolConfig {
  schema?: string;
}

export class PostgresAdapter implements DatabaseAdapter {
  public readonly provider = 'postgres' as const;
  public readonly pool: pg.Pool;
  public readonly schema?: string;

  constructor(connectionStringOrConfig?: string | PostgresAdapterOptions) {
    const defaultUrl = process.env.DATABASE_URL;
    let poolConfig: PostgresAdapterOptions;

    if (typeof connectionStringOrConfig === 'string') {
      poolConfig = { connectionString: connectionStringOrConfig };
    } else if (connectionStringOrConfig) {
      poolConfig = connectionStringOrConfig;
    } else {
      poolConfig = { connectionString: defaultUrl };
    }

    this.schema = poolConfig.schema;

    const connStr = typeof poolConfig.connectionString === 'string' ? poolConfig.connectionString : '';
    const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1');

    let sslConfig: pg.PoolConfig['ssl'] = false;
    if (poolConfig.ssl !== undefined) {
      sslConfig = poolConfig.ssl;
    } else if (process.env.DATABASE_SSL === 'false' || process.env.PGSSLMODE === 'disable' || isLocal) {
      sslConfig = false;
    } else {
      const rejectUnauth = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';
      sslConfig = { rejectUnauthorized: rejectUnauth };
    }

    const { schema: _extractedSchema, ...cleanPoolConfig } = poolConfig;

    this.pool = new Pool({
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
      ssl: sslConfig,
      ...cleanPoolConfig,
    });

    this.pool.on('error', (err) => {
      console.error('[PostgreSQL Pool Error]', err.message);
    });
  }

  private getRunner(): pg.Pool | pg.PoolClient {
    const tx = txStorage.getStore();
    return tx ? tx.client : this.pool;
  }

  private normalizeParams(params: any[]): any[] {
    return params.map(p => {
      // In JS, undefined causes errors in pg driver; map to null
      if (p === undefined) return null;
      return p;
    });
  }

  public async queryAll<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    const translatedSql = translatePlaceholders(sql);
    const normalizedParams = this.normalizeParams(params);
    const runner = this.getRunner();
    const res = normalizedParams.length > 0
      ? await runner.query(translatedSql, normalizedParams)
      : await runner.query(translatedSql);
    return res.rows as T[];
  }

  public async queryOne<T = any>(sql: string, ...params: any[]): Promise<T | null> {
    const rows = await this.queryAll<T>(sql, ...params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async run(sql: string, ...params: any[]): Promise<QueryResult> {
    const translatedSql = translatePlaceholders(sql);
    const normalizedParams = this.normalizeParams(params);
    const runner = this.getRunner();
    const res = normalizedParams.length > 0
      ? await runner.query(translatedSql, normalizedParams)
      : await runner.query(translatedSql);
    return {
      changes: res.rowCount ?? 0,
    };
  }

  public async exec(sql: string): Promise<void> {
    const runner = this.getRunner();
    await runner.query(sql);
  }

  public async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T> | T): Promise<T> {
    // If already inside an ambient transaction, reuse the active client
    const existingTx = txStorage.getStore();
    if (existingTx) {
      return await fn(this);
    }

    const client = await this.pool.connect();
    try {
      if (this.schema) {
        await client.query(`SET search_path TO "${this.schema}", public`);
      }
      await client.query('BEGIN');
      const result = await txStorage.run({ client }, async () => {
        return await fn(this);
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr: any) {
        console.error('[PostgreSQL Rollback Error]', rollbackErr.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async isAlive(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 AS alive');
      return res.rows.length > 0 && Number(res.rows[0].alive) === 1;
    } catch {
      return false;
    }
  }
}
