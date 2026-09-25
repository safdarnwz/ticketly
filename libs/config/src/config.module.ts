import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Global, Module } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { ZodError } from 'zod';

import { AppConfig, buildAppConfig } from './app-config';
import { envSchema, productionConfigProblems, type Env } from './env.schema';

/**
 * Loads `.env` files (development/test only — in production configuration comes
 * from the process environment / systemd EnvironmentFile), validates the whole
 * environment against the zod schema, and exposes a single `AppConfig`
 * provider globally.
 *
 * Precedence, highest first:
 *   1. real process environment
 *   2. .env.<NODE_ENV>.local
 *   3. .env.<NODE_ENV>
 *   4. .env
 */
@Global()
@Module({
  providers: [
    {
      provide: AppConfig,
      useFactory: (): AppConfig => buildAppConfig(loadEnv()),
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}

let cached: Env | undefined;

export function loadEnv(options: { reload?: boolean; cwd?: string } = {}): Env {
  if (cached && !options.reload) return cached;

  const cwd = options.cwd ?? process.cwd();
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (nodeEnv !== 'production') {
    for (const file of [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env']) {
      const path = resolve(cwd, file);
      // `override: false` preserves the precedence order above.
      if (existsSync(path)) loadDotenv({ path, override: false });
    }
  }

  try {
    const parsed = envSchema.parse(process.env);
    const unsafe = productionConfigProblems(parsed);
    if (unsafe.length) {
      process.stderr.write(
        `\n✖ Unsafe production configuration:\n${unsafe.map((l) => `  • ${l}`).join('\n')}\n\n`,
      );
      process.exit(1);
    }
    cached = parsed;
    return cached;
  } catch (error) {
    if (error instanceof ZodError) {
      const lines = error.issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
      // Deliberately bypassing the logger: it is not constructed yet, and a
      // config failure must be readable in a bare terminal / journalctl.
      process.stderr.write(
        `\n✖ Invalid environment configuration:\n${lines.join('\n')}\n\n` +
          `Fix the values above (see .env.example) and restart.\n\n`,
      );
      process.exit(1);
    }
    throw error;
  }
}

/** Build an AppConfig from overrides — for unit tests, no env mutation. */
export function testConfig(overrides: Partial<Env> = {}): AppConfig {
  return buildAppConfig(envSchema.parse({ NODE_ENV: 'test', ...overrides }));
}
