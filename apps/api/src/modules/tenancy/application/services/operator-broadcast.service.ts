import { Injectable } from '@nestjs/common';

import { Logger } from '@observability';

import { Mailer } from '../../../notification';
import {
  OperatorBroadcastRepository,
  type BroadcastAudience,
  type OperatorBroadcast,
} from '../../infrastructure/persistence/operator-broadcast.repository';

/**
 * Email every operator (or the active / suspended ones) at its contact
 * address (#108); maintenance notices (#110) go out the same way. One failed
 * address never stops the rest; the counts are kept with the message.
 */
@Injectable()
export class OperatorBroadcastService {
  private readonly log: Logger;

  constructor(
    private readonly broadcasts: OperatorBroadcastRepository,
    private readonly mailer: Mailer,
    logger: Logger,
  ) {
    this.log = logger.forContext('OperatorBroadcast');
  }

  async send(
    input: {
      subject: string;
      body: string;
      audience: BroadcastAudience;
      source?: 'manual' | 'maintenance';
    },
    actorId: string | null,
  ): Promise<{ id: string; recipients: number; sent: number; failed: number }> {
    const recipients = await this.broadcasts.recipients(input.audience);
    let sent = 0;
    for (const r of recipients) {
      try {
        await this.mailer.send({
          to: r.email,
          subject: input.subject,
          text: input.body,
          html: `<p>Dear ${escapeHtml(r.name)},</p>${input.body
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
            .join('')}<p>— Team Ticketly</p>`,
        });
        sent++;
      } catch (err) {
        this.log.warn({ err, tenantId: r.tenantId }, 'operator broadcast email failed');
      }
    }
    const result = {
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      source: input.source ?? 'manual',
      recipients: recipients.length,
      sent,
      failed: recipients.length - sent,
    };
    const id = await this.broadcasts.record(result, actorId);
    return { id, recipients: result.recipients, sent, failed: result.failed };
  }

  list(limit = 50): Promise<OperatorBroadcast[]> {
    return this.broadcasts.list(Math.min(limit, 200));
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
