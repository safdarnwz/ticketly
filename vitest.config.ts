import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['libs/**/*.spec.ts', 'apps/**/*.spec.ts', 'test/unit/**/*.spec.ts', 'test/architecture/**/*.spec.ts'],
    exclude: ['**/*.e2e-spec.ts', 'node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['libs/**/*.ts', 'apps/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/index.ts', '**/*.module.ts', 'libs/testing/**'],
      // The kernel is the foundation everything else trusts; hold it to a high bar.
      thresholds: { 'libs/kernel/**': { statements: 80, branches: 70 } },
    },
  },
});
