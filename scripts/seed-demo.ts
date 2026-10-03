/**
 * Seed 2 of 2 — one demo operator with everything it runs, for trying the
 * platform end to end. Run after the system seed (npm run db:seed):
 *
 *   npm run db:seed:demo
 *
 * Demo Travels (console slug `demo-travels`):
 *   - its admin, a manager, a booking clerk and a support agent, a Delhi
 *     booking counter;
 *   - 10 buses (6 AC seaters, 4 AC sleepers) with their six documents,
 *     verified and approved by the super admin;
 *   - Delhi → Alwar → Jaipur and back (DEL-JAI-01 / JAI-DEL-01), fares for
 *     every stretch and seat type, 10 daily services — one per bus — with
 *     trips for the next 60 days;
 *   - drivers and conductors (two of them with a crew-app login);
 *   - 5 customers, each with a paid booking on one of the next days' trips.
 *
 * Everything goes through the real API, booted inside this process (no
 * server needed): the same validation, permissions, encryption and service
 * codes as the consoles. Only the operator's GSTIN and bank account — which
 * the platform verifies during KYC — are written directly.
 *
 * Runs once on a database: if Demo Travels already exists it stops. To start
 * again: npm run db:reset && npm run db:migrate && npm run db:seed && npm run db:seed:demo
 */
import { UnitOfWork } from '@database';
import { addDays, createContext, newId, runWithContext, todayIn, type UserId } from '@kernel';
import { PasswordHasher } from '@security';

import { User, UserRepository } from '@api/modules/iam';

import { ok, startInProcessApi, type Headers, type InProcessApi } from './lib/in-process-api';

/* ───────────── the demo, in one place ───────────── */

const SLUG = 'demo-travels';
const ADMIN = { name: 'Rajesh Kumar', email: 'admin@demo-travels.example', password: 'pass@123' };
const STAFF_PASSWORD = 'Staff-pass-2026';
const CREW_PASSWORD = 'Crew-pass-2026';
const CUSTOMER_PASSWORD = 'Customer-pass-2026';
const DAYS_AHEAD = 60;

const STAFF = [
  {
    fullName: 'Priya Sharma',
    email: 'manager@demo-travels.example',
    phone: '9810000101',
    role: 'manager',
    counter: true,
  },
  {
    fullName: 'Amit Verma',
    email: 'clerk@demo-travels.example',
    phone: '9810000102',
    role: 'booking_clerk',
    counter: true,
  },
  {
    fullName: 'Neha Iyer',
    email: 'support@demo-travels.example',
    phone: '9810000103',
    role: 'support',
    counter: false,
  },
];

const CUSTOMERS = [
  {
    fullName: 'Aarav Mehta',
    email: 'aarav.mehta@example.com',
    phone: '9820000201',
    gender: 'male',
    age: 29,
  },
  {
    fullName: 'Sneha Reddy',
    email: 'sneha.reddy@example.com',
    phone: '9820000202',
    gender: 'female',
    age: 34,
  },
  {
    fullName: 'Vikram Singh',
    email: 'vikram.singh@example.com',
    phone: '9820000203',
    gender: 'male',
    age: 41,
  },
  {
    fullName: 'Pooja Nair',
    email: 'pooja.nair@example.com',
    phone: '9820000204',
    gender: 'female',
    age: 26,
  },
  {
    fullName: 'Karan Patel',
    email: 'karan.patel@example.com',
    phone: '9820000205',
    gender: 'male',
    age: 38,
  },
] as const;

/** Delhi → Alwar → Jaipur: kilometres and minutes from Delhi. */
const CORRIDOR = [
  {
    city: 'Delhi',
    stop: 'Kashmere Gate ISBT',
    landmark: 'Near Kashmere Gate Metro',
    km: 0,
    min: 0,
  },
  { city: 'Alwar', stop: 'Alwar Bus Stand', landmark: 'Near Hope Circus', km: 160, min: 175 },
  { city: 'Jaipur', stop: 'Sindhi Camp Bus Stand', landmark: 'Station Road', km: 270, min: 330 },
];

type SeatType = 'seater' | 'sleeper';
interface Seat {
  number: string;
  deck: 0 | 1;
  row: number;
  column: number;
  rowSpan?: number;
  type: SeatType;
  ladiesOnly?: boolean;
  accessible?: boolean;
  position?: 'window' | 'aisle';
}

/** 2+2 seater: 10 rows of four; seat 1 accessible, 3 and 4 for women. */
function seaterLayout() {
  const seats: Seat[] = [];
  let n = 1;
  for (let row = 0; row < 10; row += 1)
    for (const column of [0, 1, 3, 4])
      seats.push({
        number: String(n++),
        deck: 0,
        row,
        column,
        type: 'seater',
        position: column === 0 || column === 4 ? 'window' : 'aisle',
      });
  seats[0].accessible = true;
  seats[2].ladiesOnly = true;
  seats[3].ladiesOnly = true;
  return { decks: 1, rows: 10, columns: 5, seats };
}

/** 2+1 sleeper on two decks, five rows of berths each (L1–L15, U1–U15); L1 and L2 for women. */
function sleeperLayout() {
  const seats: Seat[] = [];
  for (const deck of [0, 1] as const) {
    let n = 1;
    for (let r = 0; r < 5; r += 1)
      for (const column of [0, 2, 3])
        seats.push({
          number: `${deck === 0 ? 'L' : 'U'}${n++}`,
          deck,
          row: r * 2,
          rowSpan: 2,
          column,
          type: 'sleeper',
          position: column === 2 ? 'aisle' : 'window',
        });
  }
  seats[0].ladiesOnly = true;
  seats[1].ladiesOnly = true;
  return { decks: 2, rows: 10, columns: 4, seats };
}

const BUS_TYPES = [
  {
    code: 'AC-S40',
    name: 'AC Seater 2+2 (40)',
    layout: seaterLayout(),
    seat: 'seater' as const,
    paisePerKm: 150,
  },
  {
    code: 'AC-SL30',
    name: 'AC Sleeper 2+1 (30)',
    layout: sleeperLayout(),
    seat: 'sleeper' as const,
    paisePerKm: 230,
  },
];

/** One bus per service: start time, which way, which kind of bus. */
const SERVICES = [
  { start: '06:00', reverse: false, type: 'AC-S40' },
  { start: '09:30', reverse: false, type: 'AC-S40' },
  { start: '14:00', reverse: false, type: 'AC-S40' },
  { start: '21:30', reverse: false, type: 'AC-SL30' },
  { start: '23:00', reverse: false, type: 'AC-SL30' },
  { start: '06:30', reverse: true, type: 'AC-S40' },
  { start: '10:00', reverse: true, type: 'AC-S40' },
  { start: '15:00', reverse: true, type: 'AC-S40' },
  { start: '21:00', reverse: true, type: 'AC-SL30' },
  { start: '22:30', reverse: true, type: 'AC-SL30' },
];

const DOCS = ['rc', 'insurance', 'permit', 'fitness', 'puc', 'road_tax'] as const;
/** A tiny PDF — enough for a document upload. */
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const log = (m: string) => process.stdout.write(`${m}\n`);
const fare = (km: number, paisePerKm: number) =>
  Math.max(100, Math.round((km * paisePerKm) / 100 / 5) * 5) * 100;

/* ───────────── steps ───────────── */

async function main(): Promise<void> {
  const api = await startInProcessApi();
  try {
    await runWithContext(createContext({ actorType: 'system' }), () => seed(api));
  } finally {
    await api.close();
  }
}

async function seed(api: InProcessApi): Promise<void> {
  const call: InProcessApi['call'] = (...args) => api.call(...args);
  const uow = api.nest.get(UnitOfWork);
  const sql = <T>(text: string, params: unknown[] = []) =>
    uow.run(
      { name: 'seed.demo', bypassRls: true },
      async (s) => (await s.client.query(text, params)).rows as T[],
    );

  if ((await sql(`SELECT 1 FROM tenants WHERE slug = $1`, [SLUG])).length) {
    log(`✓ ${SLUG} is already seeded — nothing to do (npm run db:reset to start over)`);
    return;
  }
  const today = todayIn(api.config.domain.timezone);

  // 1) The super admin provisions the operator and its admin; plan and commission.
  const superH = await login(
    api,
    api.config.bootstrap.superAdminEmail,
    api.config.bootstrap.superAdminPassword,
  );
  const provisioned = ok(
    await call(
      'POST',
      '/admin/tenants',
      {
        slug: SLUG,
        legalName: 'Demo Travels Pvt Ltd',
        displayName: 'Demo Travels',
        contactEmail: 'ops@demo-travels.example',
        contactPhone: '+919810000100',
        planCode: 'growth',
        owner: { fullName: ADMIN.name, email: ADMIN.email, password: ADMIN.password },
      },
      superH,
      'seed-demo-provision',
    ),
    'provision operator',
  );
  const tenantId = provisioned.tenantId;
  // KYC-verified details the platform keeps (no console endpoint writes these).
  await sql(
    `UPDATE tenants SET gstin = '07AAACD1234F1Z5', registered_address = '12 Transport Nagar, Kashmere Gate, Delhi 110006',
            bank_account_holder = 'Demo Travels Pvt Ltd', bank_account_number = '50100012345678',
            bank_ifsc = 'HDFC0000123', bank_name = 'HDFC Bank', bank_details_updated_at = now()
      WHERE id = $1`,
    [tenantId],
  );
  ok(
    await call(
      'POST',
      '/payments/admin/commission',
      { tenantId, model: 'percent', percent: 10 },
      superH,
    ),
    'platform commission',
  );
  log(`→ operator Demo Travels (${SLUG}), admin ${ADMIN.email}`);

  const own = await login(api, ADMIN.email, ADMIN.password, SLUG);

  // 2) Stops, seat layouts and bus types.
  const cities = new Map<string, string>();
  for (const c of await sql<{ id: string; name: string }>(
    `SELECT DISTINCT ON (name) id, name FROM cities WHERE name = ANY($1) ORDER BY name, created_at`,
    [CORRIDOR.map((c) => c.city)],
  ))
    cities.set(c.name, c.id);
  const stopIds = new Map<string, string>();
  for (const [k, c] of CORRIDOR.entries()) {
    const cityId = cities.get(c.city);
    if (!cityId) throw new Error(`city ${c.city} missing — run npm run db:seed first`);
    const s = ok(
      await call(
        'POST',
        '/master-data/stops',
        {
          cityId,
          name: c.stop,
          kind: 'both',
          landmark: c.landmark,
          address: `${c.stop}, ${c.city}`,
          contactPhone: `981000030${k}`,
        },
        own,
      ),
      `stop ${c.stop}`,
    );
    stopIds.set(c.city, s.id);
  }
  const typeIds = new Map<string, string>();
  for (const t of BUS_TYPES) {
    const layout = ok(
      await call('POST', '/master-data/seat-layouts', { name: t.name, layout: t.layout }, own),
      `seat layout ${t.code}`,
    );
    const vt = ok(
      await call(
        'POST',
        '/master-data/vehicle-types',
        { name: t.name, code: t.code, isAc: true, seatLayoutId: layout.id },
        own,
      ),
      `bus type ${t.code}`,
    );
    typeIds.set(t.code, vt.id);
  }

  // 3) Both routes, published, with fares for every stretch and seat type.
  const routes = new Map<boolean, { id: string; code: string }>();
  for (const reverse of [false, true]) {
    const legs = reverse
      ? [...CORRIDOR].reverse().map((c) => ({ ...c, km: 270 - c.km, min: 330 - c.min }))
      : CORRIDOR;
    const code = reverse ? 'JAI-DEL-01' : 'DEL-JAI-01';
    const r = ok(
      await call(
        'POST',
        '/master-data/routes',
        {
          code,
          name: `${legs[0].city} to ${legs[legs.length - 1].city}`,
          originCityId: cities.get(legs[0].city),
          destCityId: cities.get(legs[legs.length - 1].city),
          startTime: reverse ? '06:30' : '06:00',
          stops: legs.map((s, n) => ({
            stopId: stopIds.get(s.city),
            sequence: n,
            distanceFromOriginM: s.km * 1000,
            departOffsetMin: s.min,
            dwellMin: n === 0 || n === legs.length - 1 ? 0 : 10,
            canBoard: n < legs.length - 1,
            canAlight: n > 0,
          })),
        },
        own,
      ),
      `route ${code}`,
    );
    ok(await call('POST', `/master-data/routes/${r.id}/publish`, {}, own), `publish ${code}`);
    const plan = ok(
      await call(
        'POST',
        '/pricing/fare-plans',
        { routeId: r.id, name: `${code} standard`, effectiveFrom: today },
        own,
      ),
      `fare plan ${code}`,
    );
    const rows = [];
    for (let a = 0; a < legs.length; a += 1)
      for (let b = a + 1; b < legs.length; b += 1)
        for (const t of BUS_TYPES)
          rows.push({
            fromStopId: stopIds.get(legs[a].city),
            toStopId: stopIds.get(legs[b].city),
            seatType: t.seat,
            baseFareMinor: fare(Math.abs(legs[b].km - legs[a].km), t.paisePerKm),
          });
    ok(
      await call('POST', `/pricing/fare-plans/${plan.id}/rules/import`, { rows }, own),
      `fares ${code}`,
    );
    ok(
      await call('POST', `/pricing/fare-plans/${plan.id}/activate`, {}, own),
      `activate fares ${code}`,
    );
    routes.set(reverse, { id: r.id, code });
  }
  log('→ routes DEL-JAI-01 and JAI-DEL-01 with fares');

  // 4) Ten buses with their documents; the super admin verifies and approves them.
  const busIds: string[] = [];
  for (const [v, svc] of SERVICES.entries()) {
    const t = BUS_TYPES.find((b) => b.code === svc.type)!;
    const regNo = `DL01PA${1001 + v}`;
    const bus = ok(
      await call(
        'POST',
        '/fleet/vehicles',
        {
          registrationNo: regNo,
          vehicleTypeId: typeIds.get(t.code),
          make: t.seat === 'sleeper' ? 'Volvo' : 'Ashok Leyland',
          model: t.name,
          manufactureYear: 2020 + (v % 5),
          chassisNo: `MA3DTL${1001 + v}CH${String(v).padStart(4, '0')}`.slice(0, 17),
          engineNo: `EN3DTL${1001 + v}`,
          fuelType: 'diesel',
          registeredOwner: 'Demo Travels Pvt Ltd',
          registrationState: 'Delhi',
          hasAc: true,
          registrationDate: `${2020 + (v % 5)}-04-15`,
        },
        own,
      ),
      `bus ${regNo}`,
    );
    for (const docType of DOCS) {
      const f = ok(
        await call(
          'POST',
          `/fleet/vehicles/${bus.id}/documents/file?docType=${docType}&fileName=${docType}.pdf`,
          PDF,
          own,
        ),
        `${regNo} ${docType} file`,
      );
      ok(
        await call(
          'POST',
          `/fleet/vehicles/${bus.id}/documents`,
          {
            docType,
            documentNo: docType === 'rc' ? regNo : `${docType.toUpperCase()}-${regNo}`,
            validFrom: addDays(today, -180),
            expiresOn: docType === 'rc' ? addDays(today, 5 * 365) : addDays(today, 365),
            issuer: 'Delhi Transport Department',
            fileId: f.fileId,
          },
          own,
        ),
        `${regNo} ${docType}`,
      );
    }
    // Delhi ↔ Jaipur crosses a state line: an All-India Tourist Permit.
    ok(
      await call('POST', `/fleet/vehicles/${bus.id}/permit-type`, { permitType: 'aitp' }, own),
      `${regNo} permit`,
    );
    ok(await call('POST', `/fleet/vehicles/${bus.id}/submit`, {}, own), `${regNo} submit`);
    const detail = ok(
      await call('GET', `/admin/vehicles/${bus.id}`, undefined, superH),
      `${regNo} review`,
    );
    for (const d of detail.documents ?? detail.vehicle?.documents ?? [])
      ok(
        await call('POST', `/admin/vehicles/${bus.id}/documents/${d.id}/verify`, {}, superH),
        `${regNo} verify`,
      );
    ok(
      await call(
        'POST',
        `/admin/vehicles/${bus.id}/approve`,
        { reason: 'Documents verified' },
        superH,
      ),
      `${regNo} approve`,
    );
    busIds.push(bus.id);
  }
  log('→ 10 buses, documents verified, approved');

  // 5) Ten daily services, one bus each, with trips for the next weeks.
  for (const [v, s] of SERVICES.entries()) {
    const route = routes.get(s.reverse)!;
    const svc = ok(
      await call(
        'POST',
        '/scheduling/services',
        {
          routeId: route.id,
          vehicleTypeId: typeIds.get(s.type),
          defaultVehicleId: busIds[v],
          startTime: s.start,
          recurrence: { frequency: 'daily', startDate: today, endDate: addDays(today, DAYS_AHEAD) },
        },
        own,
        `seed-demo-service-${v}`,
      ),
      `service ${route.code} ${s.start}`,
    );
    ok(await call('POST', `/scheduling/services/${svc.id}/activate`, {}, own), 'activate service');
    ok(await call('POST', `/scheduling/services/${svc.id}/materialise`, {}, own), 'create trips');
  }
  log(`→ 10 daily services, trips for ${DAYS_AHEAD} days`);

  // 6) People: a booking counter, staff, crew.
  const branch = ok(
    await call(
      'POST',
      '/branches',
      {
        name: 'Delhi booking counter',
        code: 'DEL-1',
        address: 'Kashmere Gate ISBT, Delhi',
        phone: '01123450001',
      },
      own,
    ),
    'branch',
  );
  // The counter clerk's role: sell, look up, cancel and move bookings — nothing else.
  ok(
    await call(
      'POST',
      '/roles',
      {
        code: 'booking_clerk',
        name: 'Booking clerk',
        description: 'Sells tickets at the counter and looks after bookings',
        permissions: [
          'booking:read',
          'booking:create',
          'booking:cancel',
          'booking:reschedule',
          'fare:read',
          'route:read',
          'service:read',
          'payment:read',
        ],
      },
      own,
    ),
    'booking clerk role',
  );
  for (const p of STAFF) {
    const u = ok(
      await call(
        'POST',
        '/users',
        {
          fullName: p.fullName,
          email: p.email,
          phone: p.phone,
          password: STAFF_PASSWORD,
          roles: [p.role],
        },
        own,
      ),
      `staff ${p.email}`,
    );
    if (p.counter)
      ok(await call('PUT', `/users/${u.id}/branch`, { branchId: branch.id }, own), 'staff counter');
  }
  const CREW = [
    {
      role: 'driver',
      fullName: 'Ramesh Yadav',
      phone: '9830000301',
      licenceNo: 'DL0120150012345',
      login: true,
    },
    { role: 'driver', fullName: 'Suresh Kumar', phone: '9830000302', licenceNo: 'DL0120160023456' },
    { role: 'driver', fullName: 'Mahesh Gowda', phone: '9830000303', licenceNo: 'DL0120170034567' },
    {
      role: 'driver',
      fullName: 'Dinesh Rathod',
      phone: '9830000304',
      licenceNo: 'DL0120180045678',
    },
    { role: 'conductor', fullName: 'Rajesh Pillai', phone: '9830000305', login: true },
    { role: 'conductor', fullName: 'Mukesh Das', phone: '9830000306' },
  ];
  for (const [k, c] of CREW.entries()) {
    const cr = ok(
      await call(
        'POST',
        '/fleet/crew',
        {
          role: c.role,
          fullName: c.fullName,
          phone: c.phone,
          employeeCode: `DT-${String(k + 1).padStart(3, '0')}`,
          ...(c.licenceNo
            ? { licenceNo: c.licenceNo, licenceExpiresOn: addDays(today, 4 * 365) }
            : {}),
        },
        own,
      ),
      `crew ${c.fullName}`,
    );
    if (c.login)
      ok(
        await call('PUT', `/fleet/crew/${cr.id}/login`, { password: CREW_PASSWORD }, own),
        'crew login',
      );
  }
  log('→ counter, 3 staff, 6 crew');

  // 7) Five customers, each with a paid booking on the next days' trips.
  const hasher = api.nest.get(PasswordHasher);
  const users = api.nest.get(UserRepository);
  const hash = await hasher.hash(CUSTOMER_PASSWORD);
  for (const [k, c] of CUSTOMERS.entries()) {
    const user = User.create(newId() as UserId, {
      tenantId: null,
      kind: 'customer',
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      passwordHash: hash,
      status: 'active',
    });
    await uow.run({ name: 'seed.demo.customer' }, async () => users.insert(user));
    const custH = {
      ...(await login(api, c.email, CUSTOMER_PASSWORD, undefined, 'customer')),
      'x-tenant-id': tenantId,
    };

    // Alternate the two directions and the next five days; two of them travel with someone.
    const routeCode = k % 2 === 0 ? 'DEL-JAI-01' : 'JAI-DEL-01';
    const trip = (
      await sql<{ id: string; seat_type: SeatType; from_stop: string; to_stop: string }>(
        `SELECT t.id,
                (SELECT ts.seat_type FROM trip_seats ts WHERE ts.trip_id = t.id LIMIT 1) AS seat_type,
                (SELECT stop_id FROM route_stops WHERE route_id = r.id ORDER BY sequence ASC LIMIT 1) AS from_stop,
                (SELECT stop_id FROM route_stops WHERE route_id = r.id ORDER BY sequence DESC LIMIT 1) AS to_stop
           FROM trips t JOIN routes r ON r.id = t.route_id
          WHERE t.tenant_id = $1 AND r.code = $2 AND t.status = 'open' AND t.journey_date = $3::date
          ORDER BY t.departs_at
          OFFSET $4 LIMIT 1`,
        [tenantId, routeCode, addDays(today, 1 + k), k % 3],
      )
    )[0];
    if (!trip) throw new Error(`no open ${routeCode} trip on ${addDays(today, 1 + k)}`);
    const count = k === 1 || k === 4 ? 2 : 1;
    const seats = (
      await sql<{ seat_number: string }>(
        `SELECT seat_number FROM trip_seats
          WHERE trip_id = $1 AND is_bookable AND NOT ladies_only AND NOT accessible
            AND occupied_legs = 0 AND blocked_legs = 0
          ORDER BY length(seat_number), seat_number LIMIT $2 OFFSET 4`,
        [trip.id, count],
      )
    ).map((s) => s.seat_number);
    const quote = ok(
      await call(
        'POST',
        '/pricing/quote',
        {
          tripId: trip.id,
          fromStopId: trip.from_stop,
          toStopId: trip.to_stop,
          seatType: trip.seat_type,
          seatNumbers: seats,
        },
        custH,
      ),
      `quote for ${c.email}`,
    );
    const companion = {
      fullName: k === 1 ? 'Rohan Reddy' : 'Anita Patel',
      age: 31,
      gender: k === 1 ? 'male' : 'female',
    };
    const held = ok(
      await call(
        'POST',
        '/bookings/hold',
        {
          quoteId: quote.quoteId,
          seatNumbers: seats,
          passengers: seats.map((seatNumber, n) =>
            n === 0
              ? { seatNumber, fullName: c.fullName, age: c.age, gender: c.gender }
              : { seatNumber, ...companion },
          ),
          contactPhone: c.phone,
          contactEmail: c.email,
          channel: 'direct_web',
        },
        custH,
        `seed-demo-hold-${k}`,
      ),
      `hold for ${c.email}`,
    );
    ok(
      await call(
        'POST',
        '/payments/charge',
        { bookingId: held.bookingId, method: 'upi', vpa: 'success@ticketly' },
        custH,
        `seed-demo-pay-${k}`,
      ),
      `payment for ${c.email}`,
    );
    log(
      `→ ${c.fullName}: PNR ${held.pnr}, ${routeCode} on ${addDays(today, 1 + k)}, seat ${seats.join(', ')}`,
    );
  }

  log('');
  log('✓ demo seed complete');
  log(`  operator console  slug ${SLUG} · ${ADMIN.email} / ${ADMIN.password}`);
  log(`  staff             ${STAFF.map((s) => s.email).join(', ')} / ${STAFF_PASSWORD}`);
  log(`  crew app          9830000301, 9830000305 / ${CREW_PASSWORD}`);
  log(`  customers         ${CUSTOMERS.map((c) => c.email).join(', ')} / ${CUSTOMER_PASSWORD}`);
}

/** Bearer headers for a login: the super admin, an operator's staff (with its slug), or a customer. */
async function login(
  api: InProcessApi,
  identifier: string,
  password: string,
  slug?: string,
  surface: 'customer' | 'staff' = 'staff',
): Promise<Headers> {
  const h: Headers =
    surface === 'customer'
      ? { 'x-debug-surface': 'customer' }
      : slug
        ? { 'x-tenant-slug': slug, 'x-debug-surface': 'tenantAdmin' }
        : { 'x-debug-surface': 'superAdmin' };
  const r = ok(
    await api.call('POST', '/auth/login', { identifier, password }, h),
    `login ${identifier}`,
  );
  return slug
    ? { authorization: `Bearer ${r.accessToken}`, 'x-tenant-slug': slug }
    : surface === 'customer'
      ? { authorization: `Bearer ${r.accessToken}` }
      : { authorization: `Bearer ${r.accessToken}`, 'x-debug-surface': 'superAdmin' };
}

main().catch((e: unknown) => {
  process.stderr.write(`✖ demo seed failed: ${(e as Error).message}\n`);
  process.exit(1);
});
