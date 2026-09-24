import { Injectable } from '@nestjs/common';

import type { RefundCreditor } from '../../domain/refund-creditor';

/** Selling channels register their refund creditor here at startup (see RefundCreditor). */
@Injectable()
export class RefundCreditorRegistry {
  private readonly creditors = new Map<string, RefundCreditor>();

  register(creditor: RefundCreditor): void {
    if (this.creditors.has(creditor.gateway)) {
      throw new Error(`A refund creditor for gateway '${creditor.gateway}' is already registered`);
    }
    this.creditors.set(creditor.gateway, creditor);
  }

  for(gateway: string | null | undefined): RefundCreditor | undefined {
    return gateway ? this.creditors.get(gateway) : undefined;
  }
}
