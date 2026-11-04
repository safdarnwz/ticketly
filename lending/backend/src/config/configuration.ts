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
  /** Which eKYC / e-sign provider to use. 'digio' calls Digio; 'sandbox' simulates it. */
  ekycProvider: 'sandbox' | 'digio';
  esignProvider: 'sandbox' | 'digio';
  digio: { env: 'sandbox' | 'production'; apiBase: string; sdkUrl: string; clientId: string; clientSecret: string; kycTemplate: string; webhookSecret: string };
  paymentWebhookSecret: string;
  /** Public URL of the customer website, used in SMS payment links. */
  publicWebUrl: string;
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
    ekycProvider: providerEnv('EKYC_PROVIDER'),
    esignProvider: providerEnv('ESIGN_PROVIDER'),
    digio: digioConfig(),
    paymentWebhookSecret: required('PAYMENT_WEBHOOK_SECRET', 'sandbox-only-payment-webhook'),
    publicWebUrl: process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function providerEnv(name: string): 'sandbox' | 'digio' {
  const v = (process.env[name] ?? 'sandbox').toLowerCase();
  if (v !== 'sandbox' && v !== 'digio') throw new Error(`${name} must be sandbox or digio`);
  return v;
}

/** Digio: sandbox API ext.digio.in:444, production api.digio.in. Credentials come from Digio. */
function digioConfig(): AppConfig['digio'] {
  const env = (process.env.DIGIO_ENV ?? 'sandbox') as 'sandbox' | 'production';
  if (env !== 'sandbox' && env !== 'production') throw new Error('DIGIO_ENV must be sandbox or production');
  const used = process.env.EKYC_PROVIDER === 'digio' || process.env.ESIGN_PROVIDER === 'digio';
  const need = (k: string) => {
    const v = process.env[k]?.trim();
    if (used && !v) throw new Error(`Missing ${k} (required when EKYC_PROVIDER or ESIGN_PROVIDER is digio)`);
    return v ?? '';
  };
  return {
    env,
    apiBase: env === 'sandbox' ? 'https://ext.digio.in:444' : 'https://api.digio.in',
    sdkUrl: env === 'sandbox' ? 'https://ext.digio.in/sdk/v11/digio.js' : 'https://app.digio.in/sdk/v11/digio.js',
    clientId: need('DIGIO_CLIENT_ID'),
    clientSecret: need('DIGIO_CLIENT_SECRET'),
    kycTemplate: process.env.DIGIO_KYC_TEMPLATE ?? 'DIGILOCKER_AADHAAR_PAN',
    webhookSecret: need('DIGIO_WEBHOOK_SECRET'),
  };
}
