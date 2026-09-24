import { Injectable } from '@nestjs/common';

import { Logger } from '@observability';

import { OtpProvider, type OtpDeliveryContext } from './otp-provider';

/**
 * SMS OTP delivery — FUTURE. Stubbed to log for now; swap the body for a real
 * SMS gateway (Twilio/MSG91/…) later with no change to the auth flow, since it
 * satisfies the same `OtpProvider` contract.
 */
@Injectable()
export class SmsOtpProvider extends OtpProvider {
  readonly channel = 'sms' as const;
  private readonly log: Logger;

  constructor(logger: Logger) {
    super();
    this.log = logger.forContext('SmsOtpProvider');
  }

  async deliver(to: string, code: string, _ctx?: OtpDeliveryContext): Promise<void> {
    this.log.info({ to, code }, 'SMS OTP (stub — not sent)');
  }
}
