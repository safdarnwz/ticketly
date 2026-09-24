import { Injectable } from '@nestjs/common';

import { ProviderRegistry } from '../../../notification';
import { OtpProvider, type OtpDeliveryContext } from './otp-provider';

/**
 * Delivers OTP codes by SMS through the notification module's SMS provider
 * (MSG91 once configured — env vars or Admin → Integrations; logged otherwise),
 * so there is one SMS gateway integration in the codebase.
 */
@Injectable()
export class SmsOtpProvider extends OtpProvider {
  constructor(private readonly providers: ProviderRegistry) {
    super();
  }

  async deliver(to: string, code: string, _ctx?: OtpDeliveryContext): Promise<void> {
    const result = await this.providers.forChannel('sms').send({
      channel: 'sms',
      recipient: to,
      body: `${code} is your Ticketly verification code. It expires in 5 minutes.`,
    });
    if (!result.ok) throw new Error(`SMS OTP not sent: ${result.error ?? 'unknown error'}`);
  }
}
