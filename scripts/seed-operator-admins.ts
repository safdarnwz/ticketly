/**
 * Creates the operator-admin login for EVERY tenant seeded by
 * multi-operator.seed.sql. Same reasoning as seed-demo-admin.ts: PII
 * encryption needs the app's real FieldEncryptor/PasswordHasher, so this is
 * TypeScript, not raw SQL. Every login uses the SAME password (pass@123)
 * per the spec — email is admin@<slug>.example.
 */
import { Pool } from 'pg';

import { buildAppConfig, loadEnv } from '@config';
import { FieldEncryptor, PasswordHasher } from '@security';

const PASSWORD = 'pass@123';

async function main(): Promise<void> {
  const env = loadEnv();
  const config = buildAppConfig(env);
  const pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: 1,
  });
  const client = await pool.connect();
  const encryptor = new FieldEncryptor(config);
  const hasher = new PasswordHasher(config);
  const passwordHash = await hasher.hash(PASSWORD);

  try {
    const tenants = await client.query<{ id: string; slug: string; display_name: string }>(
      `SELECT id, slug, display_name FROM tenants WHERE slug <> 'demo-travels' ORDER BY created_at`,
    );
    for (const t of tenants.rows) {
      const email = `admin@${t.slug}.example`;
      const emailEnc = encryptor.encrypt(email);
      const emailBlind = encryptor.blindIndex(email);

      const role = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = $1 AND code = 'operator_admin' LIMIT 1`,
        [t.id],
      );
      if (!role.rows[0]) {
        process.stderr.write(`⚠ no operator_admin role for ${t.slug} — skipping\n`);
        continue;
      }

      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND email_blind = $2 AND deleted_at IS NULL LIMIT 1`,
        [t.id, emailBlind],
      );
      let userId: string;
      if (existing.rows[0]) {
        userId = existing.rows[0].id;
        await client.query(`UPDATE users SET password_hash = $1, status = 'active' WHERE id = $2`, [
          passwordHash,
          userId,
        ]);
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (tenant_id, kind, status, email, email_blind, full_name, password_hash)
           VALUES ($1, 'staff', 'active', $2, $3, $4, $5) RETURNING id`,
          [t.id, emailEnc, emailBlind, `${t.display_name} Admin`, passwordHash],
        );
        userId = inserted.rows[0].id;
      }
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, role.rows[0].id],
      );
      await client.query('COMMIT');
      process.stdout.write(`✓ ${t.slug}: ${email} / ${PASSWORD}\n`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    process.stderr.write(`✖ failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
