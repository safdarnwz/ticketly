import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';

export type ConnectionStatus = 'active' | 'leg1_cancelled' | 'leg2_cancelled' | 'both_cancelled';

export interface JourneyConnection {
  id: string;
  leg1TenantId: string;
  leg1BookingId: string;
  leg2TenantId: string;
  leg2BookingId: string;
  status: ConnectionStatus;
}

const COLUMNS = `id, leg1_tenant_id AS "leg1TenantId", leg1_booking_id AS "leg1BookingId",
  leg2_tenant_id AS "leg2TenantId", leg2_booking_id AS "leg2BookingId", status`;

/**
 * journey_connections — two bookings, possibly with two different operators,
 * sold as one connecting journey. The link is platform-level (it spans
 * tenants), so every access runs with RLS bypassed and filters by id.
 */
@Injectable()
export class JourneyConnectionRepository {
  constructor(private readonly uow: UnitOfWork) {}

  private run<T>(name: string, sql: string, params: unknown[]): Promise<T[]> {
    return this.uow.run({ name, bypassRls: true }, async (scope) => {
      const r = await scope.client.query(sql, params);
      return r.rows as T[];
    });
  }

  /**
   * Link two held bookings. The connection city is leg 1's destination; the
   * layover is leg 2's departure from its boarding stop minus leg 1's arrival
   * at its dropping stop.
   */
  async create(c: {
    id: string;
    customerId: string | null;
    leg1: { tenantId: string; bookingId: string };
    leg2: { tenantId: string; bookingId: string };
  }): Promise<void> {
    await this.run(
      'connections.create',
      `INSERT INTO journey_connections (id, customer_id, leg1_tenant_id, leg1_booking_id,
                                        leg2_tenant_id, leg2_booking_id, connection_city_id, layover_minutes)
       SELECT $1, $2, $3, $4, $5, $6, r.dest_city_id,
              greatest(0, round(extract(epoch FROM (s2.departs_at - s1.arrives_at)) / 60))::int
         FROM bookings b1
         JOIN routes r ON r.id = b1.route_id
         JOIN trip_stops s1 ON s1.trip_id = b1.trip_id AND s1.sequence = b1.to_seq
         JOIN bookings b2 ON b2.tenant_id = $5 AND b2.id = $6
         JOIN trip_stops s2 ON s2.trip_id = b2.trip_id AND s2.sequence = b2.from_seq
        WHERE b1.tenant_id = $3 AND b1.id = $4`,
      [c.id, c.customerId, c.leg1.tenantId, c.leg1.bookingId, c.leg2.tenantId, c.leg2.bookingId],
    );
  }

  async find(id: string): Promise<JourneyConnection | null> {
    const rows = await this.run<JourneyConnection>(
      'connections.load',
      `SELECT ${COLUMNS} FROM journey_connections WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** The active connection this booking is one leg of, if any. */
  async findActiveByLeg(tenantId: string, bookingId: string): Promise<JourneyConnection | null> {
    const rows = await this.run<JourneyConnection>(
      'connections.findByLeg',
      `SELECT ${COLUMNS} FROM journey_connections
        WHERE status = 'active'
          AND ((leg1_tenant_id = $1 AND leg1_booking_id = $2)
            OR (leg2_tenant_id = $1 AND leg2_booking_id = $2))`,
      [tenantId, bookingId],
    );
    return rows[0] ?? null;
  }

  listActive(): Promise<JourneyConnection[]> {
    return this.run<JourneyConnection>(
      'connections.listActive',
      `SELECT ${COLUMNS} FROM journey_connections WHERE status = 'active'`,
      [],
    );
  }

  async setStatus(id: string, status: ConnectionStatus): Promise<void> {
    await this.run(
      'connections.setStatus',
      `UPDATE journey_connections SET status = $2, updated_at = now() WHERE id = $1`,
      [id, status],
    );
  }

  async touch(id: string): Promise<void> {
    await this.run(
      'connections.touch',
      `UPDATE journey_connections SET updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  /**
   * Claim the right to send one alert about a connection: true the first
   * time only, so an at-risk / broken alert is never sent twice.
   */
  async claimAlert(id: string, kind: 'at_risk' | 'broken'): Promise<boolean> {
    const sql =
      kind === 'broken'
        ? `UPDATE journey_connections SET broken_notified_at = now(), updated_at = now()
            WHERE id = $1 AND broken_notified_at IS NULL RETURNING id`
        : `UPDATE journey_connections SET at_risk_notified_at = now(), updated_at = now()
            WHERE id = $1 AND at_risk_notified_at IS NULL RETURNING id`;
    const rows = await this.run(`connections.claimAlert.${kind}`, sql, [id]);
    return rows.length > 0;
  }

  /**
   * What decides whether the connection is still makeable: leg 1's scheduled
   * arrival at the passenger's DROPPING stop (not the trip's last stop), its
   * live delay, and leg 2's departure from the passenger's BOARDING stop (not
   * the trip's origin) — plus leg 1's contact details for the alert.
   */
  async timing(id: string): Promise<{
    pnr: string;
    contactPhone: string | null;
    contactEmail: string | null;
    leg1ArrivesAt: Date;
    leg1DelayMinutes: number;
    leg2DepartsAt: Date;
  } | null> {
    const rows = await this.run<{
      pnr: string;
      contactPhone: string | null;
      contactEmail: string | null;
      leg1ArrivesAt: Date;
      leg1DelayMinutes: number;
      leg2DepartsAt: Date;
    }>(
      'connections.timing',
      `SELECT b1.pnr, b1.contact_phone AS "contactPhone", b1.contact_email AS "contactEmail",
              s1.arrives_at AS "leg1ArrivesAt", coalesce(tl.delay_minutes, 0) AS "leg1DelayMinutes",
              s2.departs_at AS "leg2DepartsAt"
         FROM journey_connections jc
         JOIN bookings b1 ON b1.tenant_id = jc.leg1_tenant_id AND b1.id = jc.leg1_booking_id
         JOIN trip_stops s1 ON s1.trip_id = b1.trip_id AND s1.sequence = b1.to_seq
         LEFT JOIN trip_live tl ON tl.trip_id = b1.trip_id
         JOIN bookings b2 ON b2.tenant_id = jc.leg2_tenant_id AND b2.id = jc.leg2_booking_id
         JOIN trip_stops s2 ON s2.trip_id = b2.trip_id AND s2.sequence = b2.from_seq
        WHERE jc.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
}
