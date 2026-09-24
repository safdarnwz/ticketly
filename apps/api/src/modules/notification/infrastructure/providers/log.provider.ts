import { Injectable } from '@nestjs/common';

import { Logger } from '@observability';

import type { Channel, NotificationProvider, SendRequest, SendResult } from '../provider.interface';

/**
 * Reference provider that "delivers" by logging. Stands in for the real SMS/
 * email/WhatsApp/push adapters so the whole event → template → deliver pipeline
 * is exercisable end-to-end in dev and test. A production adapter swaps the
 * body of `send` for the provider HTTP call; the contract is unchanged.
 *
 * One instance is registered per channel (see the module), so channel routing
 * is just a lookup.
 */
@Injectable()
export class LogProviderFactory {
  constructor(private readonly logger: Logger) {}

  forChannel(channel: Channel): NotificationProvider {
    const log = this.logger.forContext(`Notify:${channel}`);
    return {
      channel,
      name: 'log',
      async send(req: SendRequest): Promise<SendResult> {
        log.info({ to: req.recipient, subject: req.subject }, `[${channel}] ${req.body.slice(0, 120)}`);
        return { ok: true, providerRef: `log_${Date.now()}` };
      },
    };
  }
}
