import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * End-to-end tests boot the real Nest app, so the TypeScript must be compiled
 * by SWC (esbuild — vitest's default — emits no decorator metadata, and Nest
 * dependency injection depends on it). Needs a migrated + seeded Postgres:
 *   npm run db:migrate && npm run db:seed && npm run db:seed:demo
 */
export default defineConfig({
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e-spec.ts', 'apps/**/*.e2e-spec.ts'],
    // Integration tests share a database; run serially to keep them legible.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
