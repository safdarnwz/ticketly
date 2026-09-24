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

  upsert(input: {
    code: string;
    name: string;
    kind: string;
    priceMinor: number;
    perPassenger: boolean;
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
  ): Promise<{ totalMinor: number }> {
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

      let totalMinor = 0;
      for (const item of items) {
        const unitPriceMinor = await this.ancillaries.activePrice(tenantId, item.ancillaryId);
        if (unitPriceMinor === null)
          throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
            message: 'Ancillary service not found',
          });
        totalMinor += unitPriceMinor * item.quantity;
        await this.ancillaries.addToBooking({
          tenantId,
          bookingId,
          ancillaryId: item.ancillaryId,
          quantity: item.quantity,
          unitPriceMinor,
        });
      }

      // GST on ancillaries — insurance/meals/luggage are NOT "passenger
      // transport by road" (the ticket fare's own 5% rate); they're
      // ordinary taxable services, so they use the platform's general
      // services rate (the SAME 18% commissionGstRatePercent every other
      // non-transport service in this codebase is taxed at), not the
      // transport-specific rate. price_minor is treated as EXCLUSIVE of
      // tax — GST is computed and added on top, never silently absorbed
      // into it. A real deployment may want a DIFFERENT rate per
      // ancillary type (insurance in particular has its own IRDAI/GST
      // treatment) — this is a deliberate platform-wide simplification,
      // not a per-item lookup, and should be revisited before this
      // matters for a real GST return.
      const gstRatePct = await this.platformSettings.commissionGstRatePercent();
      const ancillaryGstMinor = Math.round((totalMinor * gstRatePct) / 100);
      const totalWithGstMinor = totalMinor + ancillaryGstMinor;

      // Fold into the booking's own total AND tax NOW, inside the SAME
      // transaction as the ancillary rows — the customer's payment
      // (created right after this call returns) is for the booking's
      // total_minor, so this MUST already include add-ons (tax included)
      // before that payment intent is created. Updating total_minor
      // without tax_minor here would have been the exact leak this fix
      // closes: ancillary revenue collected with NO GST ever charged,
      // remitted, or even visible on the eventual invoice.
      if (totalWithGstMinor > 0)
        await this.bookings.increaseTotals(bookingId, totalWithGstMinor, ancillaryGstMinor);
      return { totalMinor: totalWithGstMinor };
    });
  }
}
