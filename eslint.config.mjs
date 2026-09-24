// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config.
 *
 * Beyond the usual TS rules, this enforces the two ARCHITECTURAL invariants the
 * codebase depends on:
 *
 *  1. The kernel stays pure. `libs/kernel` may not import Nest, pg, fastify,
 *     redis or any infrastructure — that is what keeps the domain testable in
 *     milliseconds and portable. A violation is a build error, not a code-review
 *     nicety.
 *
 *  2. No raw process.env outside the config lib. All configuration flows through
 *     the validated AppConfig, so a typo fails at boot, not at 8pm.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.js', '**/*.mjs', '**/*.cjs', 'vitest*.config.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['libs/kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', 'pg', 'fastify', 'ioredis', '@database', '@cache', '@http'],
              message:
                'The kernel must stay dependency-free. Move infrastructure code into an infrastructure lib.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    // tracing.bootstrap runs before Nest/AppConfig exist (it must patch modules at require time).
    ignores: ['libs/config/**', 'scripts/**', 'libs/observability/src/tracing.bootstrap.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration from AppConfig, not process.env directly.',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'libs/testing/**', 'test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
