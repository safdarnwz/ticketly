import { Global, Module, Provider } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { BANK_VERIFICATION, CKYC, CREDIT_BUREAU, ESIGN, PAN_KYC, PAYOUT, RECONCILIATION } from './ports';
import {
  SandboxBankVerification, SandboxBureau, SandboxCkyc, SandboxEsign, SandboxLatency, SandboxPanKyc, SandboxPayouts,
} from './sandbox/sandbox.adapters';

const LATENCY = Symbol('SANDBOX_LATENCY');
const PAYOUT_SANDBOX = Symbol('PAYOUT_SANDBOX');

function liveNotConfigured(name: string): never {
  throw new Error(
    `INTEGRATIONS_MODE=live but no live ${name} adapter is configured. Implement the port in src/integrations/ports.ts ` +
      `for your contracted provider and register it in IntegrationsModule.`,
  );
}

const pick = (token: symbol, name: string, sandbox: (l: SandboxLatency, c: AppConfig, p: SandboxPayouts) => unknown): Provider => ({
  provide: token,
  inject: [APP_CONFIG, LATENCY, PAYOUT_SANDBOX],
  useFactory: (c: AppConfig, l: SandboxLatency, p: SandboxPayouts) => (c.integrationsMode === 'live' ? liveNotConfigured(name) : sandbox(l, c, p)),
});

@Global()
@Module({
  providers: [
    { provide: LATENCY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => new SandboxLatency(c.sandboxLatencyMs) },
    { provide: PAYOUT_SANDBOX, inject: [APP_CONFIG, LATENCY], useFactory: (c: AppConfig, l: SandboxLatency) => new SandboxPayouts(l, c.sandboxLatencyMs * 3) },
    pick(PAN_KYC, 'PAN/KYC', (l) => new SandboxPanKyc(l)),
    pick(CKYC, 'CKYC', (l) => new SandboxCkyc(l)),
    pick(CREDIT_BUREAU, 'credit bureau', (l) => new SandboxBureau(l)),
    pick(BANK_VERIFICATION, 'bank verification', (l) => new SandboxBankVerification(l)),
    pick(ESIGN, 'eSign', (l) => new SandboxEsign(l)),
    pick(PAYOUT, 'payout', (_l, _c, p) => p),
    pick(RECONCILIATION, 'reconciliation', (_l, _c, p) => p),
  ],
  exports: [PAN_KYC, CKYC, CREDIT_BUREAU, BANK_VERIFICATION, ESIGN, PAYOUT, RECONCILIATION],
})
export class IntegrationsModule {}
