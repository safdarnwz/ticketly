import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { InstantLoanService } from '../instant-loan/instant-loan.service';
import { RepaymentService } from '../repayment/repayment.service';
import { DisbursementService } from './disbursement.service';

function verifyHmac(raw: Buffer | undefined, sigHex: string | undefined, secret: string) {
  if (!raw || !sigHex || !secret) throw new UnauthorizedException();
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(sigHex.trim().toLowerCase(), 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException('Bad signature');
}

const ids = (...vals: unknown[]) => vals.filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v));

/** Provider callbacks. Every one is signature-checked and re-verified with the provider's API. */
@Controller('webhooks')
export class PayoutWebhookController {
  constructor(
    private readonly svc: DisbursementService,
    private readonly loans: InstantLoanService,
    private readonly repayments: RepaymentService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post('payout') @HttpCode(200)
  async payout(@Req() req: RawBodyRequest<Request>, @Headers('x-signature') sig: string | undefined, @Body() body: { providerRef?: string }) {
    verifyHmac(req.rawBody, sig, this.cfg.payoutWebhookSecret);
    if (!body.providerRef) throw new BadRequestException('providerRef missing');
    return this.svc.onWebhook(body.providerRef);
  }

  /** Repayment gateway callback. Body must carry the order id; status is re-read from the gateway. */
  @Post('payment') @HttpCode(200)
  async payment(@Req() req: RawBodyRequest<Request>, @Headers('x-signature') sig: string | undefined, @Body() body: { orderId?: string }) {
    verifyHmac(req.rawBody, sig, this.cfg.paymentWebhookSecret);
    if (!body.orderId) throw new BadRequestException('orderId missing');
    return this.repayments.onWebhook(body.orderId);
  }

  /**
   * Digio webhook (KYC and eSign events). X-Digio-Checksum = HMAC-SHA256 of the raw body.
   * We only take ids from the payload and re-read the real status from Digio's API.
   */
  @Post('digio') @HttpCode(200)
  async digio(@Req() req: RawBodyRequest<Request>, @Headers('x-digio-checksum') sig: string | undefined, @Body() body: { event?: string; payload?: Record<string, any> }) {
    verifyHmac(req.rawBody, sig, this.cfg.digio.webhookSecret);
    const event = String(body.event ?? '').toLowerCase();
    const p = body.payload ?? {};
    if (event.startsWith('kyc.')) {
      for (const id of ids(p.KYC_REQUEST?.id, p.kyc_request?.id, p.id)) {
        const app = await this.loans.findByKycRequest(id);
        if (app) return { matched: true, ...(await this.loans.finalizeKyc(app.id)) };
      }
    } else if (event.startsWith('doc.') || event.startsWith('document.')) {
      for (const id of ids(p.document?.id, p.DOCUMENT?.id, p.document_id, p.id)) {
        const app = await this.loans.findByEsignRequest(id);
        if (app) return { matched: true, loanId: await this.loans.finalizeEsign(app.id) };
      }
    }
    return { matched: false };
  }
}
