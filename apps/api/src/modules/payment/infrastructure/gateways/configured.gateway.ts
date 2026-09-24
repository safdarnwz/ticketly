import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

import { IntegrationCredentialStore } from '../../../integrations';
import { PaymentGateway } from './gateway.interface';
import type {
  CreateIntentRequest,
  CreateIntentResult,
  RefundRequest,
  RefundResult,
  WebhookVerification,
} from './gateway.interface';
import { MockGateway } from './mock.gateway';
import { RazorpayGateway } from './razorpay.gateway';
import { TestGateway } from './test.gateway';

/**
 * The PaymentGateway the app injects. It picks the active PSP on every call:
 * Razorpay when its keys are configured (env vars, or the platform admin's
 * saved + enabled integration), otherwise the sandbox TestGateway while
 * PAYMENT_TEST_MODE is on, otherwise the reference MockGateway. Because the
 * choice is made per call, enabling or disabling Razorpay under Admin →
 * Integrations takes effect without a restart.
 */
@Injectable()
export class ConfiguredPaymentGateway extends PaymentGateway {
  private readonly test: TestGateway;
  private readonly mock: MockGateway;

  constructor(
    private readonly config: AppConfig,
    private readonly razorpay: RazorpayGateway,
    private readonly credentials: IntegrationCredentialStore,
  ) {
    super();
    this.test = new TestGateway(config);
    this.mock = new MockGateway(config);
  }

  get name(): string {
    return this.active().name;
  }

  createIntent(req: CreateIntentRequest): Promise<CreateIntentResult> {
    return this.active().createIntent(req);
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    return this.active().verifyWebhook(rawBody, headers);
  }

  refund(req: RefundRequest): Promise<RefundResult> {
    return this.active().refund(req);
  }

  override verifyClientCallback(payload: Record<string, string>) {
    return this.active().verifyClientCallback(payload);
  }

  private active(): PaymentGateway {
    if (this.config.payment.razorpay.enabled || this.credentials.active('razorpay') !== null)
      return this.razorpay;
    return this.config.payment.testMode ? this.test : this.mock;
  }
}
