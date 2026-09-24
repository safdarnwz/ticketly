import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { Logger } from '@observability';

/**
 * SMTP mailer backed by Gmail (an app-password account).
 *
 * Configured from the environment so no secret is hard-coded:
 *   GMAIL_USER          the sending Gmail address
 *   GMAIL_APP_PASSWORD  a Google "app password" (not the account password)
 *   MAIL_FROM           optional friendly From (defaults to "Ticketly <GMAIL_USER>")
 *
 * If credentials are absent (local dev), it degrades to logging the email
 * instead of sending, so the flow is fully exercisable without a mailbox.
 *
 * PER-OPERATOR BRANDING: the underlying email ADDRESS is fixed (it's the
 * one authenticated Gmail account this whole platform sends through — SPF/
 * DKIM would flag anything claiming to be from a different address), but
 * the DISPLAY NAME half of a From header is free-form and can legitimately
 * differ per send. send()'s optional fromName lets each operator's mail
 * show up as "Shyamoli Paribahan <same-address>" rather than every single
 * operator's customers seeing "Ticketly" regardless of who they actually
 * booked with — the platform's own name is the right fallback only when no
 * tenant context applies (a platform-wide email, or fromName omitted).
 */
@Injectable()
export class Mailer {
  private readonly log: Logger;
  private transporter?: Transporter;
  private readonly from: string;
  private readonly fromAddress: string;

  constructor(logger: Logger) {
    this.log = logger.forContext('Mailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    this.from = process.env.MAIL_FROM ?? (user ? `Ticketly <${user}>` : 'Ticketly <no-reply@ticketly.com>');
    // Pull just the address out of "Name <addr>" (or use it as-is if it's
    // already a bare address) — this is what a per-operator fromName gets
    // recombined with below.
    this.fromAddress = this.from.match(/<([^>]+)>/)?.[1] ?? this.from;
    if (user && pass) {
      this.transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    } else {
      this.log.warn({}, 'GMAIL_USER/GMAIL_APP_PASSWORD not set — emails will be logged, not sent');
    }
  }

  async send(input: { to: string; subject: string; html: string; text?: string; fromName?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }): Promise<void> {
    const from = input.fromName ? `${input.fromName} <${this.fromAddress}>` : this.from;
    if (!this.transporter) {
      this.log.info({ to: input.to, subject: input.subject, from, attachments: input.attachments?.length ?? 0 }, 'Email (dev, not sent)');
      return;
    }
    await this.transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    });
    this.log.info({ to: input.to, subject: input.subject, from, attachments: input.attachments?.length ?? 0 }, 'Email sent');
  }
}
