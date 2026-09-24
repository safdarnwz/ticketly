import { Injectable } from '@nestjs/common';

import type { WebhookAudienceEvent, WebhookAudienceResolver } from '../domain/webhook-audience';

/** Channels owning platform-level webhook recipients (GDS) register a resolver here. */
@Injectable()
export class WebhookAudienceRegistry {
  private readonly resolvers: WebhookAudienceResolver[] = [];

  register(resolver: WebhookAudienceResolver): void {
    this.resolvers.push(resolver);
  }

  async gdsPartnersFor(event: WebhookAudienceEvent): Promise<string[]> {
    const ids = await Promise.all(this.resolvers.map((r) => r.gdsPartnersFor(event)));
    return [...new Set(ids.flat())];
  }
}
