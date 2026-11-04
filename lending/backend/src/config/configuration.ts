import { createHash } from 'crypto';

export interface AppConfig {
  port: number;
  corsOrigin: string;
  lenderName: string;
  grievanceOfficer: string;
  databaseUrl: string;
  jwtSecret: string;
  piiEncryptionKey: Buffer;
  piiHashPepper: string;
  payoutWebhookSecret: string;
  integrationsMode: 'sandbox' | 'live';
  sandboxLatencyMs: number;
  journeyTargetSeconds: number;
  offerValidityMinutes: number;
}

function required(name: string, fallbackForSandbox?: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (process.env.INTEGRATIONS_MODE !== 'live' && fallbackForSandbox !== undefined) return fallbackForSandbox;
  throw new Error(`Missing required environment variable ${name}`);
}

export function loadConfig(): AppConfig {
  const mode = (process.env.INTEGRATIONS_MODE ?? 'sandbox') as 'sandbox' | 'live';
  // Sandbox fallback is a fixed, public dev key so data survives restarts. Never use it with real data.
  const keyB64 = required('PII_ENCRYPTION_KEY', createHash('sha256').update('sandbox-only-pii-key').digest('base64'));
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('PII_ENCRYPTION_KEY must be 32 bytes (base64)');
  return {
    port: Number(process.env.PORT ?? 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    lenderName: process.env.LENDER_NAME ?? 'Lender (RBI CoR pending)',
    grievanceOfficer: process.env.GRIEVANCE_OFFICER ?? 'Grievance Officer (to be appointed)',
    databaseUrl: required('DATABASE_URL', 'postgres://lending:lending@localhost:5432/lending'),
    jwtSecret: required('JWT_SECRET', 'sandbox-only-jwt-secret'),
    piiEncryptionKey: key,
    piiHashPepper: required('PII_HASH_PEPPER', 'sandbox-only-pepper'),
    payoutWebhookSecret: required('PAYOUT_WEBHOOK_SECRET', 'sandbox-only-webhook'),
    integrationsMode: mode,
    sandboxLatencyMs: Number(process.env.SANDBOX_LATENCY_MS ?? 300),
    journeyTargetSeconds: Number(process.env.JOURNEY_TARGET_SECONDS ?? 300),
    offerValidityMinutes: Number(process.env.OFFER_VALIDITY_MINUTES ?? 15),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
