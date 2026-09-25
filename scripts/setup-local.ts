/**
 * One-command local setup:  npm run setup
 *
 *   1. .env from .env.example (kept if it already exists), with a fresh
 *      JWT_SECRET and ENCRYPTION_KEY filled in where they are empty;
 *   2. the database, created if it does not exist;
 *   3. migrations;
 *   4. seed: permissions, roles, plans and the super admin.
 *
 * Safe to re-run. Demo operators and bookings are a separate, optional step:
 * `npm run db:seed:full` (drops everything first).
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

function step(msg: string): void {
  process.stdout.write(`\n▶ ${msg}\n`);
}

function prepareEnv(): void {
  if (!existsSync(envPath)) {
    copyFileSync(resolve(root, '.env.example'), envPath);
    process.stdout.write('  created .env from .env.example\n');
  } else process.stdout.write('  .env already exists — keeping it\n');

  let text = readFileSync(envPath, 'utf8');
  const fill = (key: string, value: string) => {
    const re = new RegExp(`^${key}=\\s*$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, `${key}=${value}`);
      process.stdout.write(`  generated ${key}\n`);
    }
  };
  fill('JWT_SECRET', randomBytes(48).toString('hex'));
  fill('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  writeFileSync(envPath, text);
}

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function ensureDatabase(env: Record<string, string>): Promise<void> {
  const name = env.DB_NAME || 'ticketly';
  const client = new Client({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    database: 'postgres',
  });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Cannot reach PostgreSQL at ${env.DB_HOST}:${env.DB_PORT} as ${env.DB_USER} — ` +
        `is it running, and are DB_* in .env right? (${(e as Error).message})`,
    );
  }
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (found.rowCount) process.stdout.write(`  database "${name}" exists\n`);
  else {
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    process.stdout.write(`  created database "${name}"\n`);
  }
  await client.end();
}

function run(script: string): void {
  execSync(`npm run -s ${script}`, { cwd: root, stdio: 'inherit' });
}

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 22)
    process.stdout.write(
      `⚠ Node ${process.versions.node} — this project is built and tested on Node 22 (see .nvmrc)\n`,
    );

  step('Environment (.env)');
  prepareEnv();
  const env = readEnv();

  step('Database');
  await ensureDatabase(env);

  step('Migrations');
  run('db:migrate');

  step('Seed (permissions, roles, plans, super admin)');
  run('db:seed');

  process.stdout.write(
    `\n✓ Setup complete.\n\n` +
      `  npm run dev          API    → http://localhost:${env.HTTP_PORT || 3000}/docs\n` +
      `  npm run dev:worker   worker (SMS / email / refunds / schedulers) — second terminal\n\n` +
      `  Super admin: ${env.SUPER_ADMIN_EMAIL} / ${env.SUPER_ADMIN_PASSWORD}\n` +
      `  Optional demo operators + bookings: npm run db:seed:full\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`\n✖ ${(e as Error).message}\n`);
  process.exit(1);
});
