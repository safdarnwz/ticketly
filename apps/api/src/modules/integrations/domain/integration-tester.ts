import type { IntegrationProvider } from './integration-catalog';

export interface IntegrationTestResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends one real message (or makes one authenticated call) with a provider's
 * saved credentials, so an admin can prove they work BEFORE enabling them.
 * The module that owns the adapter implements it and registers it with
 * `IntegrationTesterRegistry` — integrations itself knows no gateway.
 */
export interface IntegrationTester {
  readonly providers: readonly IntegrationProvider[];
  test(provider: IntegrationProvider, to: string | undefined): Promise<IntegrationTestResult>;
}
