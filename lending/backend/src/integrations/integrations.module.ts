import { Global, Module, Provider } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { DigioEkyc, DigioEsign } from './digio/digio.adapters';
import { DigioClient } from './digio/digio.client';
import { BANK_VERIFICATION, CREDIT_BUREAU, EKYC, ESIGN, NOTIFY, PAYMENT_GATEWAY, PAYOUT, RECONCILIATION } from './ports';
import {
  SandboxBankVerification, SandboxBureau, SandboxEkyc, SandboxEsign, SandboxLatency, SandboxPayments, SandboxPayouts, SandboxSms,
} from './sandbox/sandbox.adapters';

export const SANDBOX = {
  LATENCY: Symbol('SANDBOX_LATENCY'),
  PAYOUTS: Symbol('SANDBOX_PAYOUTS'),
  EKYC: Symbol('SANDBOX_EKYC'),
  ESIGN: Symbol('SANDBOX_ESIGN'),
  PAYMENTS: Symbol('SANDBOX_PAYMENTS'),
  SMS: Symbol('SANDBOX_SMS'),
  BUREAU: Symbol('SANDBOX_BUREAU'),
  BANK: Symbol('SANDBOX_BANK'),
};

function liveNotConfigured(name: string): never {
  throw new Error(
    `INTEGRATIONS_MODE=live but no live ${name} adapter is configured. Implement the port in src/integrations/ports.ts ` +
      `for your contracted provider and register it in IntegrationsModule.`,
  );
}

const sandboxOrLive = (token: symbol, name: string, sandboxToken: symbol): Provider => ({
  provide: token,
  inject: [APP_CONFIG, sandboxToken],
  useFactory: (c: AppConfig, s: unknown) => (c.integrationsMode === 'live' ? liveNotConfigured(name) : s),
});

const digioClient = (c: AppConfig) => new DigioClient(c.digio);

@Global()
@Module({
  providers: [
    { provide: SANDBOX.LATENCY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new SandboxLatency(c.sandboxLatencyMs) },
    { provide: SANDBOX.PAYOUTS, inject: [APP_CONFIG, SANDBOX.LATENCY], useFactory: (c: AppConfig, l: SandboxLatency) => new SandboxPayouts(l, c.sandboxLatencyMs * 3) },
    { provide: SANDBOX.EKYC, inject: [SANDBOX.LATENCY], useFactory: (l: SandboxLatency) => new SandboxEkyc(l) },
    { provide: SANDBOX.ESIGN, inject: [SANDBOX.LATENCY], useFactory: (l: SandboxLatency) => new SandboxEsign(l) },
    { provide: SANDBOX.PAYMENTS, inject: [APP_CONFIG, SANDBOX.LATENCY], useFactory: (c: AppConfig, l: SandboxLatency) => new SandboxPayments(l, c.publicWebUrl) },
    { provide: SANDBOX.SMS, useFactory: () => new SandboxSms() },
    { provide: SANDBOX.BUREAU, inject: [SANDBOX.LATENCY], useFactory: (l: SandboxLatency) => new SandboxBureau(l) },
    { provide: SANDBOX.BANK, inject: [SANDBOX.LATENCY], useFactory: (l: SandboxLatency) => new SandboxBankVerification(l) },

    // eKYC and e-sign: Digio or its simulator, chosen independently of the other providers.
    { provide: EKYC, inject: [APP_CONFIG, SANDBOX.EKYC], useFactory: (c: AppConfig, s: SandboxEkyc) => (c.ekycProvider === 'digio' ? new DigioEkyc(digioClient(c), c.digio.kycTemplate) : s) },
    { provide: ESIGN, inject: [APP_CONFIG, SANDBOX.ESIGN], useFactory: (c: AppConfig, s: SandboxEsign) => (c.esignProvider === 'digio' ? new DigioEsign(digioClient(c)) : s) },

    sandboxOrLive(CREDIT_BUREAU, 'credit bureau', SANDBOX.BUREAU),
    sandboxOrLive(BANK_VERIFICATION, 'bank verification', SANDBOX.BANK),
    sandboxOrLive(PAYOUT, 'payout', SANDBOX.PAYOUTS),
    sandboxOrLive(RECONCILIATION, 'reconciliation', SANDBOX.PAYOUTS),
    sandboxOrLive(PAYMENT_GATEWAY, 'payment gateway', SANDBOX.PAYMENTS),
    sandboxOrLive(NOTIFY, 'SMS', SANDBOX.SMS),
  ],
  exports: [EKYC, CREDIT_BUREAU, BANK_VERIFICATION, ESIGN, PAYOUT, RECONCILIATION, PAYMENT_GATEWAY, NOTIFY, ...Object.values(SANDBOX)],
})
export class IntegrationsModule {}
