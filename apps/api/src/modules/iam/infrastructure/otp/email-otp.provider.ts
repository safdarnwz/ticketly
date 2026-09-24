import { Injectable } from '@nestjs/common';

import { renderOtpEmail } from '../../domain/email-template';
import { Mailer } from '../mail/mailer';
import { OtpProvider, type OtpDeliveryContext } from './otp-provider';

/** Delivers OTP codes by email, using the themed email template. */
@Injectable()
export class EmailOtpProvider extends OtpProvider {
  readonly channel = 'email' as const;

  constructor(private readonly mailer: Mailer) {
    super();
  }

  async deliver(to: string, code: string, ctx?: OtpDeliveryContext): Promise<void> {
    await this.mailer.send({
      to,
      subject: `${code} is your Ticketly code`,
      html: renderOtpEmail({ code, name: ctx?.name, purpose: ctx?.purpose, brandName: ctx?.brandName }),
      text: `Your Ticketly verification code is ${code}. It expires in 5 minutes.`,
    });
  }
}
