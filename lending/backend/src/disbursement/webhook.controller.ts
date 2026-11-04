import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { DisbursementService } from './disbursement.service';

/** Payout provider callback. Signature = hex HMAC-SHA256 of the raw body with PAYOUT_WEBHOOK_SECRET. */
@Controller('webhooks')
export class PayoutWebhookController {
  constructor(private readonly svc: DisbursementService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  @Post('payout') @HttpCode(200)
  async payout(@Req() req: RawBodyRequest<Request>, @Headers('x-signature') sig: string | undefined, @Body() body: { providerRef?: string }) {
    const raw = req.rawBody;
    if (!raw || !sig) throw new UnauthorizedException();
    const expected = createHmac('sha256', this.cfg.payoutWebhookSecret).update(raw).digest();
    const given = Buffer.from(sig, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException('Bad signature');
    if (!body.providerRef) throw new BadRequestException('providerRef missing');
    return this.svc.onWebhook(body.providerRef);
  }
}
