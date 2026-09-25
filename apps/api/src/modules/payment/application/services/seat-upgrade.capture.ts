import { Injectable, type OnModuleInit } from '@nestjs/common';

import { SeatUpgradeRepository } from '../../../booking';
import type { PaymentIntent } from '../../infrastructure/persistence/payment.repository';
import {
  AdjustmentCaptureRegistry,
  type AdjustmentCaptureHandler,
} from './adjustment-capture.registry';

export interface SeatUpgradeMetadata {
  kind: 'seat_upgrade';
  ticketId: string;
  tripId: string;
  fromSeq: number;
  toSeq: number;
  stopCount: number;
  fromSeatNumber: string;
  toSeatNumber: string;
  fromSeatType: string;
  toSeatType: string;
  differentialFareMinor: number;
  differentialTaxMinor: number;
  routeId: string;
}

/**
 * Completes a paid seat upgrade: the new seat was NOT reserved while the
 * customer paid (as with a fresh booking's hold-then-pay), so swapSeat
 * re-checks it is still free (row-locked) and throws if it was taken.
 */
@Injectable()
export class SeatUpgradeCapture implements AdjustmentCaptureHandler, OnModuleInit {
  readonly kind = 'seat_upgrade';

  constructor(
    private readonly registry: AdjustmentCaptureRegistry,
    private readonly seatUpgrades: SeatUpgradeRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async apply(intent: PaymentIntent): Promise<{ fareMinor: number }> {
    const m = intent.metadata as unknown as SeatUpgradeMetadata;
    await this.seatUpgrades.swapSeat(
      m.tripId as never,
      m.stopCount,
      m.fromSeq,
      m.toSeq,
      m.fromSeatNumber,
      m.toSeatNumber,
    );
    await this.seatUpgrades.updateTicketSeat(m.ticketId, m.toSeatNumber);
    await this.seatUpgrades.recordUpgrade({
      bookingId: intent.bookingId,
      ticketId: m.ticketId,
      fromSeatNumber: m.fromSeatNumber,
      toSeatNumber: m.toSeatNumber,
      fromSeatType: m.fromSeatType,
      toSeatType: m.toSeatType,
      differentialFareMinor: m.differentialFareMinor,
      differentialTaxMinor: m.differentialTaxMinor,
    });
    return { fareMinor: m.differentialFareMinor };
  }
}
