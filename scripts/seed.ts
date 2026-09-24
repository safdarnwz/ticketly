/**
 * Complete DB seed — structural/system data + the ONE super-admin account.
 * Deliberately does NOT seed any demo tenant, operator, route, or booking —
 * "remove everything, seed only the super admin" per how this project runs.
 *
 * Order matters: permissions → roles (grants reference permissions) → plans
 * → super-admin user + role grant. Runs as ONE transaction — partial seeding
 * is impossible; either everything above exists or nothing does.
 *
 * The user/role step reuses the app's REAL `PasswordHasher` and
 * `FieldEncryptor` (constructed directly from the same `AppConfig` the app
 * boots with) instead of a hand-crafted SQL `INSERT` — email/phone are
 * encrypted with a blind index and the password cost parameters come from
 * env, so a raw SQL guess would silently drift from whatever this
 * environment is actually configured with. This script IS that source of
 * truth, so it always matches.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';

import { AppConfig, buildAppConfig, loadEnv } from '@config';
import { FieldEncryptor, PasswordHasher } from '@security';

const SEEDS_DIR = join(__dirname, '..', 'db', 'seeds');

async function runSqlFile(client: PoolClient, filename: string): Promise<void> {
  const sql = readFileSync(join(SEEDS_DIR, filename), 'utf8');
  process.stdout.write(`→ ${filename}\n`);
  await client.query(sql);
}

/** Mirrors AdminBootstrapService, but as a one-shot script step. */
async function seedSuperAdmin(client: PoolClient, config: AppConfig): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    process.stdout.write('… SUPER_ADMIN_EMAIL/PASSWORD not set — skipping super-admin seed\n');
    return;
  }

  const hasher = new PasswordHasher(config);
  const encryptor = new FieldEncryptor(config);
  const fullName = process.env.SUPER_ADMIN_NAME ?? 'Super Admin';

  const emailEnc = encryptor.encrypt(email);
  const emailBlind = encryptor.blindIndex(email);
  const passwordHash = await hasher.hash(password);

  // NOTE: the (tenant_id, email_blind) partial unique index does NOT catch
  // duplicates when tenant_id IS NULL — Postgres treats every NULL as
  // distinct from every other NULL for uniqueness purposes (see the comment
  // in 0002_tenancy_and_iam.sql). So, exactly like AdminBootstrapService,
  // this checks explicitly instead of relying on ON CONFLICT.
  process.stdout.write(`→ super-admin user (${email})\n`);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id IS NULL AND email_blind = $1 AND deleted_at IS NULL LIMIT 1`,
    [emailBlind],
  );
  let userId: string;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await client.query(`UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`, [passwordHash, userId]);
  } else {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, kind, status, email, email_blind, full_name, password_hash)
       VALUES (NULL, 'staff', 'active', $1, $2, $3, $4)
       RETURNING id`,
      [emailEnc, emailBlind, fullName, passwordHash],
    );
    userId = inserted.rows[0].id;
  }

  const role = await client.query<{ id: string }>(
    `SELECT id FROM roles WHERE code = 'super_admin' AND tenant_id IS NULL AND deleted_at IS NULL LIMIT 1`,
  );
  if (!role.rows[0]) {
    throw new Error("'super_admin' role not found — roles.seed.sql must run before this step");
  }
  await client.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, role.rows[0].id],
  );
  process.stdout.write(`✓ super-admin ready: ${email}\n`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const config = buildAppConfig(env);
  const pool = new Pool({
    host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
    user: env.DB_USER, password: env.DB_PASSWORD, max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await runSqlFile(client, 'permissions.seed.sql');
    await runSqlFile(client, 'roles.seed.sql');
    await runSqlFile(client, 'platform.seed.sql');
    await seedSuperAdmin(client, config);
    await client.query('COMMIT');
    process.stdout.write('✓ seed complete — permissions, roles, plans + super admin only\n');
  } catch (error) {
    await client.query('ROLLBACK');
    process.stderr.write(`✖ seed failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
