import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

import { MockGateway } from './mock.gateway';

/**
 * TEST / SANDBOX gateway.
 *
 * Reuses MockGateway's full contract (idempotent intent, HMAC-signed webhook
 * verification, refund) so the server-to-server path keeps working, but reports
 * `name = 'test'` so captured rows are clearly tagged as sandbox and are easy
 * to find and purge once a real PSP is integrated.
 *
 * The actual "does this test credential succeed?" decision is NOT here — it
 * lives in the pure `domain/test-gateway.ts` validator, exercised by
 * PaymentService.chargeTest. This class is only the DI-bound adapter identity.
 */
@Injectable()
export class TestGateway extends MockGateway {
  override readonly name = 'test';

  constructor(config: AppConfig) {
    super(config);
  }
}
