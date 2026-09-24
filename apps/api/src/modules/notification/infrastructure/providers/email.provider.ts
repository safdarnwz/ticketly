import { Injectable } from '@nestjs/common';

import { Mailer } from '../../../iam/infrastructure/mail/mailer';
import type { NotificationProvider, SendRequest, SendResult } from '../provider.interface';

/**
 * Email channel — thin adapter over the existing `Mailer` (Gmail SMTP via
 * nodemailer, see apps/api/src/modules/iam/infrastructure/mail/mailer.ts).
 * That class already degrades to logging when GMAIL_USER/GMAIL_APP_PASSWORD
 * aren't set, so this provider needs no separate on/off switch — it's
 * "real" the moment those two env vars are.
 */
@Injectable()
export class EmailNotificationProvider implements NotificationProvider {
  readonly channel = 'email' as const;
  readonly name = 'gmail_smtp';

  constructor(private readonly mailer: Mailer) {}

  async send(req: SendRequest): Promise<SendResult> {
    try {
      await this.mailer.send({ to: req.recipient, subject: req.subject ?? '(no subject)', html: req.body, text: req.body, fromName: req.fromName });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
    }
  }
}
