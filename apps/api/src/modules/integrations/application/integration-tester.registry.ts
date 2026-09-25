import { Injectable } from '@nestjs/common';

import type { IntegrationProvider } from '../domain/integration-catalog';
import type { IntegrationTester } from '../domain/integration-tester';

/** Modules owning an adapter (notifications, payments) register its tester here. */
@Injectable()
export class IntegrationTesterRegistry {
  private readonly testers = new Map<IntegrationProvider, IntegrationTester>();

  register(tester: IntegrationTester): void {
    for (const provider of tester.providers) this.testers.set(provider, tester);
  }

  for(provider: IntegrationProvider): IntegrationTester | undefined {
    return this.testers.get(provider);
  }
}
