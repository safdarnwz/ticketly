import { Injectable } from '@nestjs/common';

import { type PermissionValue } from '@contracts';
import {
  getContext,
  getUserId,
  hasPermission,
  NotFoundError,
  runAsTenant,
  type TenantId,
} from '@kernel';

import { BookingRepository } from '../../infrastructure/persistence/booking.repository';

/**
 * Who may change one booking from a self-service screen: the operator's staff
 * holding `permission` (their own operator's bookings only — the services read
 * the booking in the caller's tenant), the signed-in customer who booked it,
 * or anyone who gives the mobile number it was booked with. Everyone else
 * gets the same 404 as an unknown id, so a guessed id tells them nothing.
 */
@Injectable()
export class BookingAccess {
  constructor(private readonly bookings: BookingRepository) {}

  async run<T>(
    bookingId: string,
    mobile: string | undefined,
    permission: PermissionValue,
    fn: (asStaff: boolean) => Promise<T>,
  ): Promise<T> {
    if (getContext()?.tenantId && hasPermission(permission)) return fn(true);
    const info = await this.bookings.accessInfo(bookingId);
    const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').slice(-10);
    const owner = Boolean(info?.customerId) && info?.customerId === getUserId();
    const byPhone =
      digits(mobile).length === 10 && digits(mobile) === digits(info?.contactPhone ?? null);
    if (!info || (!owner && !byPhone)) throw new NotFoundError('Booking', bookingId);
    return runAsTenant(info.tenantId as TenantId, () => fn(false));
  }
}
