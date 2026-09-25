import { Injectable } from '@nestjs/common';

import type { PaymentIntent } from '../../infrastructure/persistence/payment.repository';

/**
 * A payment for a change to an existing booking — a seat upgrade, a
 * reschedule that costs more. The intent carries `metadata.kind` and whatever
 * the change needs; the module that owns the change applies it once the money
 * is captured.
 */
export interface AdjustmentCaptureHandler {
  readonly kind: string;
  /**
   * Apply the change the payment was for. Runs inside the capture's
   * transaction with the operator's tenant bound; throw if it can no longer
   * be applied (the capture is then logged for a manual refund). Returns the
   * fare part of the amount — what platform commission is charged on.
   */
  apply(intent: PaymentIntent): Promise<{ fareMinor: number }>;
}

/**
 * Where modules register their adjustment handlers (at onModuleInit), so the
 * payment module completes a reschedule without importing amendments — which
 * itself imports payment.
 */
@Injectable()
export class AdjustmentCaptureRegistry {
  private readonly handlers = new Map<string, AdjustmentCaptureHandler>();

  register(handler: AdjustmentCaptureHandler): void {
    if (this.handlers.has(handler.kind))
      throw new Error(`An adjustment handler for '${handler.kind}' is already registered`);
    this.handlers.set(handler.kind, handler);
  }

  forIntent(intent: Pick<PaymentIntent, 'metadata'>): AdjustmentCaptureHandler | null {
    const kind = intent.metadata?.kind;
    return typeof kind === 'string' ? (this.handlers.get(kind) ?? null) : null;
  }
}
