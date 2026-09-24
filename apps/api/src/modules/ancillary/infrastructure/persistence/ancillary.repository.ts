import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type BookingId, type TenantId, type Uuid } from '@kernel';

/** The operator's add-on catalogue (ancillary_services) and add-ons sold on bookings. */
@Injectable()
export class AncillaryRepository {
  constructor(private readonly db: DatabaseService) {}

  listActive(tenantId: TenantId): Promise<unknown[]> {
    return this.db.query(
      `SELECT id, code, name, kind, price_minor AS "priceMinor", per_passenger AS "perPassenger"
         FROM ancillary_services WHERE tenant_id = $1 AND is_active = true ORDER BY name`,
      [tenantId],
      { name: 'ancillary.list' },
    );
  }

  /** Create, or update by code; returns the id of the row written. */
  async upsert(
    tenantId: TenantId,
    s: { code: string; name: string; kind: string; priceMinor: number; perPassenger: boolean },
  ): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO ancillary_services (id, tenant_id, code, name, kind, price_minor, per_passenger)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, kind=EXCLUDED.kind,
         price_minor=EXCLUDED.price_minor, per_passenger=EXCLUDED.per_passenger, updated_at=now()
       RETURNING id`,
      [newId(), tenantId, s.code, s.name, s.kind, s.priceMinor, s.perPassenger],
      { name: 'ancillary.upsert', primary: true },
    );
    return row!.id;
  }

  /** Current price of an active catalogue item, or null. */
  async activePrice(tenantId: TenantId, ancillaryId: Uuid): Promise<number | null> {
    const row = await this.db.queryOne<{ price_minor: string }>(
      `SELECT price_minor FROM ancillary_services WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
      [tenantId, ancillaryId],
      { name: 'ancillary.price', primary: true },
    );
    return row ? Number(row.price_minor) : null;
  }

  /** Record an add-on sold on a booking, at the price captured now. */
  async addToBooking(l: {
    tenantId: TenantId;
    bookingId: BookingId;
    ancillaryId: Uuid;
    quantity: number;
    unitPriceMinor: number;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO booking_ancillaries (id, tenant_id, booking_id, ancillary_id, quantity, unit_price_minor, total_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId(),
        l.tenantId,
        l.bookingId,
        l.ancillaryId,
        l.quantity,
        l.unitPriceMinor,
        l.unitPriceMinor * l.quantity,
      ],
      { name: 'ancillary.addToBooking', primary: true },
    );
  }
}
