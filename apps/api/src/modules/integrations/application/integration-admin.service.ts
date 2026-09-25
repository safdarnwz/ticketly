import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode } from '@kernel';

import {
  INTEGRATIONS,
  isIntegrationProvider,
  type IntegrationProvider,
} from '../domain/integration-catalog';
import type { IntegrationTestResult } from '../domain/integration-tester';
import {
  IntegrationCredentialStore,
  type IntegrationView,
} from '../infrastructure/integration-credential.store';
import { IntegrationTesterRegistry } from './integration-tester.registry';

/** Platform-admin management of integration credentials (#11–#21). */
@Injectable()
export class IntegrationAdminService {
  constructor(
    private readonly store: IntegrationCredentialStore,
    private readonly testers: IntegrationTesterRegistry,
  ) {}

  list(): Promise<IntegrationView[]> {
    return this.store.list();
  }

  get(provider: string): Promise<IntegrationView> {
    return this.store.get(known(provider));
  }

  save(
    provider: string,
    input: { config: unknown; secrets?: Record<string, unknown> },
    actorId: string | null,
  ): Promise<IntegrationView> {
    return this.store.save(known(provider), input, actorId);
  }

  setEnabled(provider: string, enabled: boolean, actorId: string | null): Promise<IntegrationView> {
    return this.store.setEnabled(known(provider), enabled, actorId);
  }

  /**
   * Send a test with the SAVED credentials (enabled or not) and record the
   * outcome on the integration, so the list shows when it last worked.
   */
  async test(provider: string, to: string | undefined): Promise<IntegrationTestResult> {
    const p = known(provider);
    const tester = this.testers.for(p);
    if (!tester)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `${INTEGRATIONS[p].label} has no test available`,
      });
    if (!(await this.store.stored(p)))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `Save ${INTEGRATIONS[p].label} credentials before testing them`,
      });
    const result = await tester.test(p, to).catch((err: unknown): IntegrationTestResult => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    await this.store.recordTest(p, result.ok, result.error ?? null);
    return result;
  }
}

function known(provider: string): IntegrationProvider {
  if (!isIntegrationProvider(provider))
    throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
      message: `Unknown integration '${provider}'`,
    });
  return provider;
}
