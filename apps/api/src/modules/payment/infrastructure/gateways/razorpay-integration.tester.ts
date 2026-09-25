import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  IntegrationCredentialStore,
  IntegrationTesterRegistry,
  type IntegrationTestResult,
  type IntegrationTester,
} from '../../../integrations';

/**
 * "Test" for the Razorpay integration: one authenticated read (the latest
 * order) with the saved key id + secret. No money moves; a wrong key pair
 * fails with Razorpay's own 401 message.
 */
@Injectable()
export class RazorpayIntegrationTester implements IntegrationTester, OnModuleInit {
  readonly providers = ['razorpay'] as const;

  constructor(
    private readonly registry: IntegrationTesterRegistry,
    private readonly credentials: IntegrationCredentialStore,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async test(): Promise<IntegrationTestResult> {
    const saved = await this.credentials.stored('razorpay');
    if (!saved) return { ok: false, error: 'No saved credentials' };
    const auth = Buffer.from(`${saved.config.keyId}:${saved.secrets.keySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders?count=1', {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: { description?: string };
    } | null;
    return { ok: false, error: body?.error?.description ?? `HTTP ${res.status}` };
  }
}
