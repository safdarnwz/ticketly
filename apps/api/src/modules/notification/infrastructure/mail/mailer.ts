import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

import { AppConfig } from '@config';
import { Logger } from '@observability';

import { IntegrationCredentialStore } from '../../../integrations';

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
 *
 * SMTP OVERRIDE (#18): when the platform admin has saved and enabled an
 * `smtp` integration, mail goes through THAT server and From address instead
 * of the Gmail env account. The transport is rebuilt only when the saved
 * settings change.
 */
@Injectable()
export class Mailer {
  private readonly log: Logger;
  private transporter?: Transporter;
  private readonly from: string;
  private readonly fromAddress: string;

  private smtp?: { key: string; transporter: Transporter; from: string; fromAddress: string };

  private readonly devPreview: boolean;

  constructor(
    logger: Logger,
    private readonly credentials: IntegrationCredentialStore,
    config: AppConfig,
  ) {
    this.log = logger.forContext('Mailer');
    this.devPreview = config.isDevelopment;
    const { gmailUser: user, gmailAppPassword: pass } = config.mail;
    this.from =
      config.mail.from || (user ? `Ticketly <${user}>` : 'Ticketly <no-reply@ticketly.com>');
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

  async send(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    fromName?: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
  }): Promise<void> {
    const saved = this.savedSmtp();
    const fromAddress = saved?.fromAddress ?? this.fromAddress;
    const defaultFrom = saved?.from ?? this.from;
    const from = input.fromName ? `${input.fromName} <${fromAddress}>` : defaultFrom;
    const transporter = saved?.transporter ?? this.transporter;
    if (!transporter) {
      this.log.info(
        {
          to: input.to,
          subject: input.subject,
          from,
          attachments: input.attachments?.length ?? 0,
          // Local development only, so sign-up codes and tickets can be
          // tried without a mail account. Never outside NODE_ENV=development.
          ...(this.devPreview
            ? {
                preview: (input.text ?? input.html.replace(/<[^>]+>/g, ' '))
                  .replace(/\s+/g, ' ')
                  .slice(0, 600),
              }
            : {}),
        },
        'Email (dev, not sent)',
      );
      return;
    }
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    });
    this.log.info(
      { to: input.to, subject: input.subject, from, attachments: input.attachments?.length ?? 0 },
      'Email sent',
    );
  }

  /**
   * Send one message through the given SMTP settings (saved but maybe not yet
   * enabled) — the admin "test email" (#21). Verifies the connection first so
   * a wrong host or password fails with the server's own error.
   */
  async sendTest(
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      fromAddress: string;
      fromName: string;
    },
    input: { to: string; subject: string; text: string },
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
    try {
      await transporter.verify();
      await transporter.sendMail({
        from: `${smtp.fromName} <${smtp.fromAddress}>`,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    } finally {
      transporter.close();
    }
  }

  /** The admin-configured SMTP transport, or undefined to use the Gmail env account. */
  private savedSmtp(): { transporter: Transporter; from: string; fromAddress: string } | undefined {
    const saved = this.credentials.active('smtp');
    if (!saved) return undefined;
    const { host, port, secure, user, fromAddress, fromName } = saved.config;
    const key = JSON.stringify([
      host,
      port,
      secure,
      user,
      fromAddress,
      fromName,
      saved.secrets.password,
    ]);
    if (this.smtp?.key !== key) {
      this.smtp = {
        key,
        transporter: nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user, pass: saved.secrets.password },
        }),
        from: `${fromName} <${fromAddress}>`,
        fromAddress,
      };
    }
    return this.smtp;
  }
}
