import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PostgresAdapter } from '../db/postgresAdapter.js';
import { config, validateConfig, sanitizeDatabaseUrl } from '../config.js';

export const runPostgresMigrations = async (customAdapter?: PostgresAdapter): Promise<void> => {
  const adapter = customAdapter || new PostgresAdapter();
  try {
    await applyPostgresMigrations(adapter);
  } finally {
    if (!customAdapter) await adapter.close();
  }
};

const applyPostgresMigrations = async (adapter: PostgresAdapter): Promise<void> => {

  console.log(`[LilyBeta PostgreSQL] Connecting to ${sanitizeDatabaseUrl(config.databaseUrl)}...`);
  console.log('[LilyBeta PostgreSQL] Initializing versioned migration engine...');

  // 1. Ensure schema_migrations table exists
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Discover migrations from server/migrations/postgres/
  const migrationsDir = path.join(process.cwd(), 'server', 'migrations', 'postgres');
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.match(/^\d+_.+\.(sql|ts|js)$/))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const appliedRows = await adapter.queryAll<{ version: string }>('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(appliedRows.map(r => r.version));

  let appliedCount = 0;

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.(sql|ts|js)$/);
    if (!match) continue;

    const version = match[1];
    if (appliedVersions.has(version)) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    console.log(`[LilyBeta PostgreSQL] Applying migration ${version}: ${file}...`);

    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(filePath, 'utf8');

      await adapter.transaction(async (tx) => {
        // Execute SQL script via simple query protocol
        await tx.exec(sql);
        await tx.run(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          version,
          file,
          new Date().toISOString()
        );
      });
    } else {
      const migrationMod = await import(`file://${filePath}`);
      await adapter.transaction(async (tx) => {
        if (typeof migrationMod.up === 'function') {
          await migrationMod.up({ adapter: tx });
        }
        await tx.run(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          version,
          file,
          new Date().toISOString()
        );
      });
    }

    console.log(`[LilyBeta PostgreSQL] ✓ Applied ${file} successfully.`);
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log('[LilyBeta PostgreSQL] Schema is already up to date (no pending migrations).');
  } else {
    console.log(`[LilyBeta PostgreSQL] Successfully applied ${appliedCount} migration(s).`);
  }

  // 3. Admin Account Seeding Security
  const existingAdmin = await adapter.queryOne('SELECT id FROM profiles WHERE role = ?', 'ADMIN');
  if (!existingAdmin) {
    const isProduction = config.nodeEnv === 'production';
    const allowBootstrap = config.bootstrapAdmin;

    if (isProduction && !allowBootstrap) {
      console.warn(
        '[LilyBeta PostgreSQL Seed] PRODUCTION MODE: Admin bootstrapping is disabled. ' +
        'Set BOOTSTRAP_ADMIN=true with BOOTSTRAP_ADMIN_PASSWORD to seed initial admin.'
      );
      return;
    }

    const adminUsername = config.bootstrapAdminUsername || 'admin';
    const adminPassword = config.bootstrapAdminPassword || 'admin123456';

    if (isProduction && adminPassword === 'admin123456') {
      throw new Error('FATAL SECURITY ERROR: In production mode, default password admin123456 cannot be used for admin bootstrap.');
    }

    const adminId = 'admin-root-id';
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(adminPassword, salt);
    const now = new Date().toISOString();

    await adapter.run(
      `INSERT INTO profiles (id, username, password_hash, display_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ADMIN', TRUE, ?, ?)`,
      adminId,
      adminUsername,
      passwordHash,
      'LilyBeta Admin',
      now,
      now
    );

    console.log(`[LilyBeta PostgreSQL Seed] Initial admin account bootstrapped:`);
    console.log(`   Username: ${adminUsername}`);
    if (!isProduction) {
      console.log(`   Password: ${adminPassword}`);
    } else {
      console.log(`   Password: [REDACTED]`);
    }
  }

};
