import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, requireTenantId, type BookingId, type Uuid } from '@kernel';

import { BookingRepository } from '../../../booking';
import { PlatformSettingsRepository } from '../../../platform-settings';
import { AncillaryRepository } from '../../infrastructure/persistence/ancillary.repository';

/**
 * Ancillary add-on services — travel insurance, meals, extra luggage, priority
 * boarding. The operator maintains a catalogue with prices; passengers attach
 * add-ons to a booking. The unit price is CAPTURED at purchase time on the
 * booking so a later catalogue price change never rewrites what was charged.
 */
@Injectable()
export class AncillaryService {
  constructor(
    private readonly ancillaries: AncillaryRepository,
    private readonly bookings: BookingRepository,
    private readonly uow: UnitOfWork,
    private readonly platformSettings: PlatformSettingsRepository,
  ) {}

  listCatalogue(): Promise<unknown[]> {
    return this.ancillaries.listActive(requireTenantId());
  }

  /** The operator's own view: every add-on, on sale or stopped. */
  listAll(): Promise<unknown[]> {
    return this.ancillaries.listAll(requireTenantId());
  }

  upsert(input: {
    code: string;
    name: string;
    kind: string;
    priceMinor: number;
    perPassenger: boolean;
    active: boolean;
  }): Promise<string> {
    return this.ancillaries.upsert(requireTenantId(), input);
  }

  /**
   * Attach add-ons to a booking. Returns the total ancillary charge, which
   * this method ALSO folds directly into the booking's own total_minor —
   * without this, the add-on rows would exist in booking_ancillaries while
   * the actual payment captured (and everything downstream: the ledger,
   * refund-clawback math, the customer's e-ticket total) would never
   * reflect them, silently giving away insurance/meals/luggage for free.
   *
   * Only allowed while the booking is still 'held' (pre-payment) — the
   * total_minor bump becomes part of the SAME quote the customer is about
   * to pay for. A booking that's already 'confirmed' needs an INCREMENTAL
   * capture instead (the same problem seat-upgrade solves), which this
   * endpoint does not attempt; it fails clearly rather than silently
   * under-charging for a post-confirm add-on.
   */
  async attach(
    bookingId: BookingId,
    items: { ancillaryId: Uuid; quantity: number }[],
  ): Promise<{ totalMinor: number; bookingTotalMinor: number }> {
    return this.uow.run({ name: 'ancillary.attach', tenantId: requireTenantId() }, async () => {
      const tenantId = requireTenantId();
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'held') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message:
            'Add-ons can only be attached to a booking that is still awaiting payment — this one is already ' +
            booking.status,
        });
      }
      if (booking.holdExpiresAt && booking.holdExpiresAt < new Date())
        throw new AppError(ErrorCode.INVENTORY_HOLD_EXPIRED, 422, {
          message: 'Your seat hold has expired — please choose your seats again',
        });

      // The same add-on twice in one request is one line with the quantities added.
      const merged = new Map<Uuid, number>();
      for (const i of items)
        merged.set(i.ancillaryId, (merged.get(i.ancillaryId) ?? 0) + i.quantity);

      // Price every line first, so a bad id changes nothing.
      const gstRatePct = await this.platformSettings.commissionGstRatePercent();
      const lines: {
        ancillaryId: Uuid;
        quantity: number;
        unitPriceMinor: number;
        gstMinor: number;
      }[] = [];
      for (const [ancillaryId, quantity] of merged) {
        const item = await this.ancillaries.activeItem(tenantId, ancillaryId);
        if (!item)
          throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
            message: 'Ancillary service not found',
          });
        if (item.perPassenger && quantity > booking.seatCount)
          throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
            message: `${item.name} is per passenger — at most ${booking.seatCount} on this booking`,
          });
        // GST on add-ons: they are not passenger transport, so they carry the
        // platform's general services rate (price is exclusive of tax).
        const net = item.priceMinor * quantity;
        lines.push({
          ancillaryId,
          quantity,
          unitPriceMinor: item.priceMinor,
          gstMinor: Math.round((net * gstRatePct) / 100),
        });
      }

      // Replace, not append: the request is the booking's full set of add-ons.
      // A retry, a double click or a changed mind never charges twice, and an
      // empty list removes them. What was added before comes off exactly as
      // it was charged (stored per line), even if the tax rate changed since.
      const previous = await this.ancillaries.bookingLines(bookingId);
      if (previous.count) await this.ancillaries.clearBooking(bookingId);
      for (const l of lines) await this.ancillaries.addToBooking({ tenantId, bookingId, ...l });

      const netMinor = lines.reduce((a, l) => a + l.unitPriceMinor * l.quantity, 0);
      const gstMinor = lines.reduce((a, l) => a + l.gstMinor, 0);
      const totalMinor = netMinor + gstMinor;
      const deltaTotal = totalMinor - (previous.totalMinor + previous.gstMinor);
      const deltaTax = gstMinor - previous.gstMinor;
      if (deltaTotal !== 0 || deltaTax !== 0)
        await this.bookings.increaseTotals(bookingId, deltaTotal, deltaTax);
      return { totalMinor, bookingTotalMinor: booking.totalMinor + deltaTotal };
    });
  }
}
