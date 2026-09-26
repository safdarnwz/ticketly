import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import {
  addDays,
  createContext,
  newId,
  runAsTenant,
  runWithContext,
  todayIn,
  type ServiceId,
  type TenantId,
  type UserId,
} from '@kernel';
import { PasswordHasher } from '@security';

import { User, UserRepository } from '@api/modules/iam';
import { MaterializationService } from '@api/modules/scheduling/application/services/materialization.service';

/**
 * Fixtures for e2e tests, built on the seeded demo operator
 * (npm run db:seed && npm run db:seed:geography && npm run db:seed:demo):
 *  - trips materialised for a date a few days out, and one open trip on it;
 *  - tokens for a fresh customer, the demo operator's admin and the platform admin.
 * Every run uses new identities, so runs never collide with each other.
 */
export interface E2eFixtures {
  tenantId: string;
  tenantSlug: string;
  originCityId: string;
  destCityId: string;
  journeyDate: string;
  tripId: string;
  fromStopId: string;
  toStopId: string;
  seatNumbers: string[];
  customer: { token: string; email: string; phone: string };
  operatorToken: string;
  platformAdminToken: string;
}

const DEMO_SLUG = 'demo-travels';
const DEMO_ADMIN = { identifier: 'admin@demo-travels.example', password: 'pass@123' };

export function seedFixtures(app: NestFastifyApplication): Promise<E2eFixtures> {
  return runWithContext(createContext({ actorType: 'system' }), () => build(app));
}

async function build(app: NestFastifyApplication): Promise<E2eFixtures> {
  const uow = app.get(UnitOfWork);
  const config = app.get(AppConfig);

  const tenant = await uow.run(
    { name: 'e2e.tenant', bypassRls: true, readOnly: true },
    async (s) => {
      const r = await s.client.query<{ id: TenantId }>(`SELECT id FROM tenants WHERE slug = $1`, [
        DEMO_SLUG,
      ]);
      return r.rows[0];
    },
  );
  if (!tenant)
    throw new Error(`Demo operator '${DEMO_SLUG}' not found — run npm run db:seed:demo first`);
  const tenantId = tenant.id;

  const earliest = addDays(todayIn(config.domain.timezone), 3);
  const trip = await runAsTenant(tenantId, async () => {
    const services = await uow.run(
      { name: 'e2e.services', readOnly: true },
      async (s) =>
        (
          await s.client.query<{ id: ServiceId }>(
            `SELECT id FROM services WHERE tenant_id = $1 AND status = 'active'`,
            [tenantId],
          )
        ).rows,
    );
    for (const svc of services)
      await app.get(MaterializationService).materialiseService(svc.id, 14);
    return uow.run({ name: 'e2e.trip', readOnly: true }, async (s) => {
      const r = await s.client.query<{
        id: string;
        origin_city_id: string;
        dest_city_id: string;
        from_stop: string;
        to_stop: string;
        journey_date: string;
      }>(
        `SELECT t.id, t.journey_date::text AS journey_date, r.origin_city_id, r.dest_city_id,
                (SELECT stop_id FROM route_stops WHERE route_id = r.id ORDER BY sequence ASC LIMIT 1) AS from_stop,
                (SELECT stop_id FROM route_stops WHERE route_id = r.id ORDER BY sequence DESC LIMIT 1) AS to_stop
           FROM trips t JOIN routes r ON r.id = t.route_id
          WHERE t.tenant_id = $2 AND t.journey_date BETWEEN $1::date AND $1::date + 9 AND t.status = 'open'
            -- a route that is priced (a new route may still have no fares)
            AND EXISTS (SELECT 1 FROM fare_plans fp WHERE fp.route_id = r.id AND fp.status = 'active' AND fp.deleted_at IS NULL)
          -- the emptiest trip of the next days: every run books seats, so one trip fills up
          -- (seats a customer is still holding from an earlier run are not free either)
          ORDER BY (SELECT count(*) FROM trip_seats ts WHERE ts.trip_id = t.id AND ts.is_bookable
                      AND NOT ts.ladies_only AND ts.occupied_legs = 0 AND ts.blocked_legs = 0
                      AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                                       WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                                         AND b.status = 'held' AND b.hold_expires_at > now())) DESC, t.departs_at
          LIMIT 1`,
        [earliest, tenantId],
      );
      const row = r.rows[0];
      if (!row) throw new Error(`No open demo trip from ${earliest}`);
      const seats = await s.client.query<{ seat_number: string }>(
        `SELECT ts.seat_number FROM trip_seats ts
          WHERE ts.trip_id = $1 AND ts.is_bookable AND NOT ts.ladies_only
            AND ts.occupied_legs = 0 AND ts.blocked_legs = 0
            AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                             WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                               AND b.status = 'held' AND b.hold_expires_at > now())
          ORDER BY ts.seat_number LIMIT 4`,
        [row.id],
      );
      return { ...row, seats: seats.rows.map((x) => x.seat_number) };
    });
  });

  // A fresh central customer account.
  const suffix = Date.now().toString().slice(-9);
  const customer = {
    email: `e2e+${suffix}@ticketly.test`,
    phone: `9${suffix}`,
    password: 'E2e-pass-123',
  };
  const hash = await app.get(PasswordHasher).hash(customer.password);
  const user = User.create(newId() as UserId, {
    tenantId: null,
    kind: 'customer',
    fullName: 'E2E Customer',
    email: customer.email,
    phone: customer.phone,
    passwordHash: hash,
    status: 'active',
  });
  await uow.run({ name: 'e2e.customer' }, async () => app.get(UserRepository).insert(user));

  return {
    tenantId,
    tenantSlug: DEMO_SLUG,
    originCityId: trip.origin_city_id,
    destCityId: trip.dest_city_id,
    journeyDate: trip.journey_date,
    tripId: trip.id,
    fromStopId: trip.from_stop,
    toStopId: trip.to_stop,
    seatNumbers: trip.seats,
    customer: {
      token: await login(
        app,
        { identifier: customer.email, password: customer.password },
        { 'x-debug-surface': 'customer' },
      ),
      email: customer.email,
      phone: customer.phone,
    },
    operatorToken: await login(app, DEMO_ADMIN, { 'x-tenant-slug': DEMO_SLUG }),
    platformAdminToken: await login(
      app,
      {
        identifier: config.bootstrap.superAdminEmail,
        password: config.bootstrap.superAdminPassword,
      },
      { 'x-debug-surface': 'superAdmin' },
    ),
  };
}

async function login(
  app: NestFastifyApplication,
  body: { identifier: string; password: string },
  headers: Record<string, string>,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers,
    payload: body,
  });
  const json = JSON.parse(res.body) as { accessToken?: string; detail?: string };
  if (!json.accessToken)
    throw new Error(
      `e2e login failed for ${body.identifier}: ${res.statusCode} ${json.detail ?? res.body}`,
    );
  return json.accessToken;
}
