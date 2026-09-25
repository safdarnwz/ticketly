import { describe, expect, it } from 'vitest';

import { DEV_JWT_SECRET, envSchema, productionConfigProblems } from '../env.schema';

const prod = (over: Record<string, string>) =>
  envSchema.parse({
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(48),
    PAYMENT_TEST_MODE: 'false',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    ...over,
  });

describe('productionConfigProblems', () => {
  it('passes a correctly configured production', () => {
    expect(productionConfigProblems(prod({}))).toEqual([]);
  });
  it('refuses the public default JWT secret', () => {
    expect(productionConfigProblems(prod({ JWT_SECRET: DEV_JWT_SECRET }))[0]).toMatch(/JWT_SECRET/);
  });
  it('refuses the test payment gateway (it confirms bookings without money)', () => {
    expect(productionConfigProblems(prod({ PAYMENT_TEST_MODE: 'true' }))[0]).toMatch(
      /PAYMENT_TEST_MODE/,
    );
  });
  it('refuses running without PII encryption', () => {
    expect(productionConfigProblems(prod({ ENCRYPTION_KEY: '' }))[0]).toMatch(/ENCRYPTION_KEY/);
  });
  it('does not apply to development', () => {
    expect(productionConfigProblems(envSchema.parse({ NODE_ENV: 'development' }))).toEqual([]);
  });
});
