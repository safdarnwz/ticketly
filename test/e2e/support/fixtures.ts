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
 * (npm run db:seed && npm run db:seed:demo):
 *  - trips materialised for a date a few days out, and one open trip on it;
 *  - tokens for a fresh customer, the demo operator's admin and the platform admin;
 *  - a second operator (maharaja-yatra) for the tenant-isolation checks, provisioned
 *    here the first time — it is test data, not part of the demo.
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
const OTHER = {
  slug: 'maharaja-yatra',
  email: 'admin@maharaja-yatra.example',
  password: 'pass@123',
};

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
      await app.get(MaterializationService).materialiseService(svc.id, 40);
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
          WHERE t.tenant_id = $2 AND t.journey_date BETWEEN $1::date + 1 AND $1::date + 20 AND t.status = 'open'
            -- (the first of those days is left alone for the search tests, which search it)
            -- the demo's Delhi → Jaipur bus (the way back, JAI-DEL-01, is for round-trip tests)
            AND r.code = 'DEL-JAI-01'
            -- a route that is priced (a new route may still have no fares)
            AND EXISTS (SELECT 1 FROM fare_plans fp WHERE fp.route_id = r.id AND fp.status = 'active' AND fp.deleted_at IS NULL)
          -- a roomy trip of the next weeks: every run books seats, and the suites run side by
          -- side, so each picks at random among trips with 20+ free seats (else the emptiest)
          -- (seats a customer is still holding from an earlier run are not free either)
          ORDER BY LEAST(20, (SELECT count(*) FROM trip_seats ts WHERE ts.trip_id = t.id AND ts.is_bookable
                      AND NOT ts.ladies_only AND NOT ts.accessible AND ts.seat_type = 'seater' AND ts.occupied_legs = 0 AND ts.blocked_legs = 0
                      AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                                       WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                                         AND b.status = 'held' AND b.hold_expires_at > now()))) DESC, random()
          LIMIT 1`,
        [earliest, tenantId],
      );
      const row = r.rows[0];
      if (!row) throw new Error(`No open demo trip from ${earliest}`);
      const seats = await s.client.query<{ seat_number: string }>(
        `SELECT ts.seat_number FROM trip_seats ts
          WHERE ts.trip_id = $1 AND ts.is_bookable AND NOT ts.ladies_only AND NOT ts.accessible AND ts.seat_type = 'seater'
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

  const platformAdminToken = await login(
    app,
    {
      identifier: config.bootstrap.superAdminEmail,
      password: config.bootstrap.superAdminPassword,
    },
    { 'x-debug-surface': 'superAdmin' },
  );
  await ensureOtherOperator(app, platformAdminToken);

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
    platformAdminToken,
  };
}

/**
 * The second operator the isolation tests sign in as. Provisioned once, like any
 * operator, with a small network of its own on the same city pair as the demo —
 * Delhi → Jaipur, four cheaper daily buses — so search results mix operators and
 * per-operator rules (service codes, promotions) have someone to differ from.
 */
async function ensureOtherOperator(app: NestFastifyApplication, adminToken: string): Promise<void> {
  const call = async (
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
    idem?: string,
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...headers, ...(idem ? { 'idempotency-key': idem } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    const body = res.body ? JSON.parse(res.body) : null;
    return { status: res.statusCode, body };
  };
  const must = <T>(r: { status: number; body: T }, what: string): T => {
    if (r.status < 200 || r.status >= 300)
      throw new Error(`e2e: ${OTHER.slug} ${what}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };

  const provisioned = await call(
    'POST',
    '/admin/tenants',
    { authorization: `Bearer ${adminToken}`, 'x-debug-surface': 'superAdmin' },
    {
      slug: OTHER.slug,
      legalName: 'Maharaja Yatra Pvt Ltd',
      displayName: 'Maharaja Yatra',
      contactEmail: `ops@${OTHER.slug}.example`,
      owner: { fullName: 'Maharaja Yatra Admin', email: OTHER.email, password: OTHER.password },
    },
    `e2e-provision-${OTHER.slug}`,
  );
  // 201 the first time; 409 (slug taken) or the idempotent replay on later runs.
  if (provisioned.status >= 300 && provisioned.status !== 409)
    throw new Error(`e2e: could not provision ${OTHER.slug}: ${provisioned.status}`);

  const own = {
    authorization: `Bearer ${await login(app, { identifier: OTHER.email, password: OTHER.password }, { 'x-tenant-slug': OTHER.slug, 'x-debug-surface': 'tenantAdmin' })}`,
    'x-tenant-slug': OTHER.slug,
  };
  const routes = must(await call('GET', '/master-data/routes', own), 'routes');
  if ((routes.items ?? routes).length > 0) return;

  const cityId = async (slug: string) =>
    must(await call('GET', `/master-data/cities/by-slug/${slug}`, {}), `city ${slug}`).id as string;
  const [delhi, jaipur] = [await cityId('delhi'), await cityId('jaipur')];
  const stop = async (city: string, name: string) =>
    must(
      await call('POST', '/master-data/stops', own, { cityId: city, name, kind: 'both' }),
      `stop ${name}`,
    ).id as string;
  const from = await stop(delhi, 'Dhaula Kuan');
  const to = await stop(jaipur, 'Narayan Singh Circle');
  const seats = [];
  for (let n = 0; n < 40; n += 1)
    seats.push({
      number: String(n + 1),
      deck: 0,
      row: Math.floor(n / 4),
      column: [0, 1, 3, 4][n % 4],
      type: 'seater',
    });
  const layout = must(
    await call('POST', '/master-data/seat-layouts', own, {
      name: 'Seater 2+2 (40)',
      layout: { decks: 1, rows: 10, columns: 5, seats },
    }),
    'seat layout',
  );
  const type = must(
    await call('POST', '/master-data/vehicle-types', own, {
      name: 'Seater 2+2 (40)',
      code: 'S40',
      isAc: false,
      seatLayoutId: layout.id,
    }),
    'bus type',
  );
  const route = must(
    await call('POST', '/master-data/routes', own, {
      code: 'DEL-JAI-01',
      name: 'Delhi to Jaipur',
      originCityId: delhi,
      destCityId: jaipur,
      startTime: '05:00',
      stops: [
        {
          stopId: from,
          sequence: 0,
          distanceFromOriginM: 0,
          departOffsetMin: 0,
          canBoard: true,
          canAlight: false,
        },
        {
          stopId: to,
          sequence: 1,
          distanceFromOriginM: 280_000,
          departOffsetMin: 345,
          canBoard: false,
          canAlight: true,
        },
      ],
    }),
    'route',
  );
  must(await call('POST', `/master-data/routes/${route.id}/publish`, own, {}), 'publish');
  const today = new Date().toISOString().slice(0, 10);
  const plan = must(
    await call('POST', '/pricing/fare-plans', own, {
      routeId: route.id,
      name: 'Standard',
      effectiveFrom: today,
    }),
    'fare plan',
  );
  must(
    await call('POST', `/pricing/fare-plans/${plan.id}/rules/import`, own, {
      rows: [{ fromStopId: from, toStopId: to, seatType: 'seater', baseFareMinor: 30_000 }],
    }),
    'fares',
  );
  must(await call('POST', `/pricing/fare-plans/${plan.id}/activate`, own, {}), 'activate fares');
  const until = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  for (const start of ['05:00', '12:00', '18:00', '23:30']) {
    const svc = must(
      await call(
        'POST',
        '/scheduling/services',
        own,
        {
          routeId: route.id,
          vehicleTypeId: type.id,
          startTime: start,
          recurrence: { frequency: 'daily', startDate: today, endDate: until },
        },
        `e2e-${OTHER.slug}-service-${start}`,
      ),
      `service ${start}`,
    );
    must(await call('POST', `/scheduling/services/${svc.id}/activate`, own, {}), 'activate');
    must(await call('POST', `/scheduling/services/${svc.id}/materialise`, own, {}), 'trips');
  }
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
