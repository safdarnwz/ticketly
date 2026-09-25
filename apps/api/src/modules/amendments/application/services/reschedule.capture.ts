import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  AdjustmentCaptureRegistry,
  type AdjustmentCaptureHandler,
  type PaymentIntent,
} from '../../../payment';
import { AmendmentService, type RescheduleMetadata } from './amendment.service';

/** Moves a booking once the difference for a dearer reschedule has been paid. */
@Injectable()
export class RescheduleCapture implements AdjustmentCaptureHandler, OnModuleInit {
  readonly kind = 'reschedule';

  constructor(
    private readonly registry: AdjustmentCaptureRegistry,
    private readonly amendments: AmendmentService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(intent: PaymentIntent): Promise<{ fareMinor: number }> {
    const m = intent.metadata as unknown as RescheduleMetadata;
    await this.amendments.completePaidReschedule(intent.bookingId, m);
    // Commission applies to the fare difference; the reschedule fee is the operator's.
    return { fareMinor: Math.max(0, m.fareDiffMinor) };
  }
}
