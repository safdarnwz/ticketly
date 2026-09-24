import { z } from 'zod';

/**
 * The third-party integrations a platform admin configures (#11–#18).
 *
 * Each provider splits its settings into `config` (safe to show back, e.g. a
 * sender id or SMTP host) and `secrets` (API keys, passwords — encrypted at
 * rest, never returned, only reported as "set"). The schemas here are the
 * single source of truth for what each provider needs.
 *
 * `runtime` says whether the platform can actually USE the credentials yet:
 *  - 'live'   — the adapter reads these credentials on every call;
 *  - 'restart'— used, but picked up at process start (payment gateway choice);
 *  - 'none'   — stored for when an adapter exists; cannot be enabled today.
 */
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.-]+$/, 'must be a hostname');
const env = z.enum(['test', 'live']);

export const INTEGRATIONS = {
  razorpay: {
    kind: 'payment',
    label: 'Razorpay',
    runtime: 'restart',
    config: z.object({ keyId: z.string().trim().min(4).max(100) }),
    secrets: z.object({
      keySecret: z.string().min(4).max(200),
      webhookSecret: z.string().min(4).max(200),
    }),
  },
  payu: {
    kind: 'payment',
    label: 'PayU',
    runtime: 'none',
    config: z.object({ merchantKey: z.string().trim().min(2).max(100), environment: env }),
    secrets: z.object({ merchantSalt: z.string().min(4).max(200) }),
  },
  easebuzz: {
    kind: 'payment',
    label: 'Easebuzz',
    runtime: 'none',
    config: z.object({ merchantKey: z.string().trim().min(2).max(100), environment: env }),
    secrets: z.object({ salt: z.string().min(4).max(200) }),
  },
  paytm: {
    kind: 'payment',
    label: 'Paytm',
    runtime: 'none',
    config: z.object({
      merchantId: z.string().trim().min(2).max(100),
      websiteName: z.string().trim().min(2).max(60),
      environment: env,
    }),
    secrets: z.object({ merchantKey: z.string().min(4).max(200) }),
  },
  msg91_sms: {
    kind: 'sms',
    label: 'MSG91 SMS',
    runtime: 'live',
    config: z.object({
      senderId: z
        .string()
        .trim()
        .regex(/^[A-Z]{6}$/, 'must be a 6-letter DLT sender id'),
      route: z.string().trim().min(1).max(10).default('4'),
      dltTemplateId: z.string().trim().max(40).optional(),
    }),
    secrets: z.object({ authKey: z.string().min(8).max(200) }),
  },
  msg91_whatsapp: {
    kind: 'whatsapp',
    label: 'WhatsApp Business (MSG91)',
    runtime: 'live',
    config: z.object({
      integratedNumber: z
        .string()
        .trim()
        .regex(/^\d{10,15}$/, 'must be the full number with country code, digits only'),
      namespace: z.string().trim().max(100).optional(),
    }),
    secrets: z.object({ authKey: z.string().min(8).max(200) }),
  },
  smtp: {
    kind: 'email',
    label: 'Email (SMTP)',
    runtime: 'live',
    config: z.object({
      host: hostname,
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      user: z.string().trim().min(1).max(200),
      fromAddress: z.string().trim().email(),
      fromName: z.string().trim().min(1).max(80).default('Ticketly'),
    }),
    secrets: z.object({ password: z.string().min(1).max(500) }),
  },
} as const;

export type IntegrationProvider = keyof typeof INTEGRATIONS;
export type IntegrationKind = (typeof INTEGRATIONS)[IntegrationProvider]['kind'];
export const INTEGRATION_PROVIDERS = Object.keys(INTEGRATIONS) as IntegrationProvider[];

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return Object.prototype.hasOwnProperty.call(INTEGRATIONS, value);
}

export type IntegrationConfig<P extends IntegrationProvider> = z.infer<
  (typeof INTEGRATIONS)[P]['config']
>;
export type IntegrationSecrets<P extends IntegrationProvider> = z.infer<
  (typeof INTEGRATIONS)[P]['secrets']
>;

/**
 * Validate an update. Secrets are optional on update: an omitted secret keeps
 * the stored value (so an admin changing the SMTP port doesn't have to paste
 * the password again), but the MERGED result must be complete.
 */
export function validateIntegrationUpdate(
  provider: IntegrationProvider,
  input: { config: unknown; secrets?: Record<string, unknown> },
  storedSecrets: Record<string, unknown> | null,
):
  | { ok: true; config: Record<string, unknown>; secrets: Record<string, unknown> }
  | { ok: false; errors: string[] } {
  const def = INTEGRATIONS[provider];
  const config = def.config.safeParse(input.config);
  const merged = { ...(storedSecrets ?? {}), ...stripEmpty(input.secrets ?? {}) };
  const secrets = def.secrets.safeParse(merged);
  const errors = [
    ...(config.success
      ? []
      : config.error.issues.map((i) => `config.${i.path.join('.')}: ${i.message}`)),
    ...(secrets.success
      ? []
      : secrets.error.issues.map((i) => `secrets.${i.path.join('.')}: ${i.message}`)),
  ];
  if (errors.length > 0 || !config.success || !secrets.success) return { ok: false, errors };
  return { ok: true, config: config.data, secrets: secrets.data };
}

/** "abcd…wxyz" style hint so an admin can tell WHICH key is stored without seeing it. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 2)}${'•'.repeat(6)}${value.slice(-4)}`;
}

function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}
