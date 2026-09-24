/** Scaffold a new migration: `npm run db:new create_bookings` */
import { writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const name = process.argv.slice(2).join('_').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  if (!name) {
    process.stderr.write('Usage: npm run db:new <name>\n');
    process.exit(1);
  }
  const dir = resolve(__dirname, '../db/migrations');
  const existing = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const next = String(existing.length + 1).padStart(4, '0');
  const file = resolve(dir, `${next}_${name}.sql`);
  await writeFile(
    file,
    `-- ${next}_${name}\n\n-- migrate:up\n\n\n-- migrate:down\n\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`Created db/migrations/${next}_${name}.sql\n`);
}

void main();
