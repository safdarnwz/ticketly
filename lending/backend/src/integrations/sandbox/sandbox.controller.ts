import { Body, CanActivate, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { InstantLoanService } from '../../instant-loan/instant-loan.service';
import { SandboxEsignDto, SandboxKycDto, SandboxPayDto } from '../../instant-loan/dto';
import { RepaymentService } from '../../repayment/repayment.service';
import { SANDBOX } from '../integrations.module';
import { SandboxEkyc, SandboxEsign, SandboxPayments, SandboxSms } from './sandbox.adapters';

@Injectable()
class SandboxOnly implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}
  canActivate() {
    if (this.cfg.integrationsMode !== 'sandbox') throw new NotFoundException();
    return true;
  }
}

/**
 * Stand-ins for the provider-hosted pages (Digio DigiLocker, Digio eSign, payment gateway).
 * Each one then behaves like the provider's webhook, so the journey continues on its own.
 * Only available with INTEGRATIONS_MODE=sandbox.
 */
@Controller('sandbox')
@UseGuards(SandboxOnly)
export class SandboxController {
  constructor(
    @Inject(SANDBOX.EKYC) private readonly ekyc: SandboxEkyc,
    @Inject(SANDBOX.ESIGN) private readonly esign: SandboxEsign,
    @Inject(SANDBOX.PAYMENTS) private readonly payments: SandboxPayments,
    @Inject(SANDBOX.SMS) private readonly sms: SandboxSms,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly loans: InstantLoanService,
    private readonly repayments: RepaymentService,
  ) {}

  @Post('ekyc/:requestId/complete') @HttpCode(200)
  async kyc(@Param('requestId') requestId: string, @Body() dto: SandboxKycDto) {
    if (this.cfg.ekycProvider !== 'sandbox' || !this.ekyc.simulate(requestId, dto)) throw new NotFoundException('No open sandbox KYC request');
    const app = await this.loans.findByKycRequest(requestId);
    return app ? this.loans.finalizeKyc(app.id) : { ok: true };
  }

  @Post('esign/:requestId/sign') @HttpCode(200)
  async sign(@Param('requestId') requestId: string, @Body() dto: SandboxEsignDto) {
    if (this.cfg.esignProvider !== 'sandbox' || !this.esign.simulate(requestId, dto.otp)) throw new NotFoundException('Wrong OTP or no open sandbox e-sign request');
    const app = await this.loans.findByEsignRequest(requestId);
    if (app) await this.loans.finalizeEsign(app.id);
    return { signed: true };
  }

  @Get('payments/:orderId')
  order(@Param('orderId') orderId: string) {
    const o = this.payments.order(orderId);
    if (!o) throw new NotFoundException();
    return { orderId, amountPaise: o.amountPaise, state: o.state };
  }

  @Post('payments/:orderId/pay') @HttpCode(200)
  async pay(@Param('orderId') orderId: string, @Body() dto: SandboxPayDto) {
    if (!this.payments.simulate(orderId, dto.outcome, dto.method)) throw new NotFoundException('No open sandbox payment');
    await this.repayments.onWebhook(orderId);
    return this.payments.status(orderId);
  }

  @Get('sms')
  sentSms() {
    return this.sms.sent.slice(-50).reverse();
  }
}
