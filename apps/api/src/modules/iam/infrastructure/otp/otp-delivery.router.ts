import { Injectable } from '@nestjs/common';

import { EmailOtpProvider } from './email-otp.provider';
import { OtpProvider, type OtpDeliveryContext } from './otp-provider';
import { SmsOtpProvider } from './sms-otp.provider';

/** Sends a code to an email address by email, and to anything else by SMS. */
@Injectable()
export class OtpDeliveryRouter extends OtpProvider {
  constructor(
    private readonly email: EmailOtpProvider,
    private readonly sms: SmsOtpProvider,
  ) {
    super();
  }

  deliver(to: string, code: string, ctx?: OtpDeliveryContext): Promise<void> {
    return (to.includes('@') ? this.email : this.sms).deliver(to, code, ctx);
  }
}
