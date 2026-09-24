/**
 * Creates the login for Demo Travels' operator-admin user. A SEPARATE script
 * from seed.ts/demo-operator.seed.sql for the same reason seedSuperAdmin()
 * in seed.ts is TypeScript and not raw SQL: email/phone need the app's REAL
 * FieldEncryptor (encrypted value + blind index), and a password needs the
 * REAL PasswordHasher — a hand-written SQL INSERT would silently drift from
 * whatever cost-parameters/keys this environment is actually configured
 * with. Run AFTER demo-operator.seed.sql (the tenant + operator_admin role
 * must already exist).
 *
 * Login: admin@demo-travels.example / pass@123
 * Console: app.demo-travels.ticketly.com (or whatever DEMO_TENANT_SLUG is)
 */
import { Pool } from 'pg';

import { buildAppConfig, loadEnv } from '@config';
import { FieldEncryptor, PasswordHasher } from '@security';

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

  const slug = process.env.DEMO_TENANT_SLUG ?? 'demo-travels';
  const email = (process.env.DEMO_ADMIN_EMAIL ?? 'admin@demo-travels.example').toLowerCase();
  const password = process.env.DEMO_ADMIN_PASSWORD ?? 'pass@123';
  const fullName = process.env.DEMO_ADMIN_NAME ?? 'Demo Operator Admin';

  try {
    const tenant = await client.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [
      slug,
    ]);
    if (!tenant.rows[0])
      throw new Error(`Tenant '${slug}' not found — run demo-operator.seed.sql first`);
    const tenantId = tenant.rows[0].id;

    const role = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND code = 'operator_admin' LIMIT 1`,
      [tenantId],
    );
    if (!role.rows[0])
      throw new Error(
        `'operator_admin' role not found for tenant '${slug}' — run demo-operator.seed.sql first`,
      );

    const encryptor = new FieldEncryptor(config);
    const hasher = new PasswordHasher(config);
    const emailEnc = encryptor.encrypt(email);
    const emailBlind = encryptor.blindIndex(email);
    const passwordHash = await hasher.hash(password);

    await client.query('BEGIN');
    // Tenant-scoped email uniqueness DOES work via the partial index here
    // (unlike the super-admin's tenant_id IS NULL case) — ON CONFLICT is
    // safe for a tenant-scoped user.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND email_blind = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, emailBlind],
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
        [tenantId, emailEnc, emailBlind, fullName, passwordHash],
      );
      userId = inserted.rows[0].id;
    }
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, role.rows[0].id],
    );
    await client.query('COMMIT');
    process.stdout.write(`✓ Demo operator-admin ready: ${email} / ${password}\n`);
    process.stdout.write(`  Console: app.${slug}.<your-domain>\n`);
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
