import { z } from 'zod';

/** Provider-specific fields are validated by the catalogue (`validateIntegrationUpdate`). */
export const SaveIntegrationSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  /** Omit a secret (or send '') to keep the stored value. */
  secrets: z.record(z.string(), z.unknown()).optional(),
});
export type SaveIntegrationDto = z.infer<typeof SaveIntegrationSchema>;

export const EnableIntegrationSchema = z.object({ enabled: z.boolean() });
export type EnableIntegrationDto = z.infer<typeof EnableIntegrationSchema>;

export const TestIntegrationSchema = z.object({
  /** Mobile number (SMS / WhatsApp) or email address (SMTP) to send the test to. */
  to: z.string().trim().min(3).max(254).optional(),
});
export type TestIntegrationDto = z.infer<typeof TestIntegrationSchema>;
