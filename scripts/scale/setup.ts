/**
 * ============================================================================
 *  Scale data set, part 1 — 100 operators, set up the way a real one is
 * ============================================================================
 *
 * Everything goes through the HTTP API (real validation, permissions,
 * idempotency, billing hooks), with the API and Postgres running under
 * libfaketime at the end of August 2026 (scripts/scale/run.sh), so the
 * operators exist before the September they trade in:
 *
 *   apply (company, GSTIN of the home state, PAN, bank, KYC files)
 *   → super admin approves (a few are put on hold first, then approved)
 *   → super admin sets each operator's plan and platform commission
 *   → owner signs in: stops, seat layouts, bus types, routes both ways
 *     (published), 10 buses with their six documents → submitted
 *   → super admin verifies every document and approves the buses (a few are
 *     rejected once for a document, fixed, and approved)
 *   → fare plans priced for every boarding/dropping pair and seat type,
 *     daily services on every route with its own bus, pickup/drop charges
 *   → branches, staff (500 over all operators), agents (prepaid with a
 *     top-up, postpaid with a credit limit), crew with licences, OTA
 *     partners, refund policy, concessions, round trip, luggage, add-ons,
 *     coupons, waitlist rules.
 *
 * Re-runnable: each operator is looked up by its owner email first, and each
 * step skips what already exists. State (ids, logins) is written to
 * scripts/scale/state.json for the booking generator.
 *
 * Run: npx tsx scripts/scale/setup.ts [from] [to]   (operator indexes, default 0..99)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { call, ok, pool, type Res } from './http';
import {
  BUS_TYPES,
  CORRIDORS,
  TYPE_FACTOR,
  operatorNames,
  prng,
  type BusType,
  type Corridor,
} from './catalogue';

const STATE_FILE = join(__dirname, 'state.json');
const SUPER = { identifier: 'admin@ticketly.local', password: 'Admin@12345' };
const OWNER_PASSWORD = 'Operator-pass-2026';
const STAFF_PASSWORD = 'Staff-pass-2026';
const AGENT_PASSWORD = 'Agent-pass-2026';
const CREW_PASSWORD = 'Crew-pass-2026';

/** Which state each corridor's first city is in — the operator's home (its GSTIN state). */
const HOME_STATE: Record<string, { gst: string; name: string; ifscBank: string }> = {
  Delhi: { gst: '07', name: 'Delhi', ifscBank: 'HDFC' },
  Mumbai: { gst: '27', name: 'Maharashtra', ifscBank: 'ICIC' },
  Pune: { gst: '27', name: 'Maharashtra', ifscBank: 'SBIN' },
  Bangalore: { gst: '29', name: 'Karnataka', ifscBank: 'KKBK' },
  Hyderabad: { gst: '36', name: 'Telangana', ifscBank: 'UTIB' },
  Chennai: { gst: '33', name: 'Tamil Nadu', ifscBank: 'IOBA' },
  Kolkata: { gst: '19', name: 'West Bengal', ifscBank: 'PUNB' },
  Ahmedabad: { gst: '24', name: 'Gujarat', ifscBank: 'BARB' },
  Jaipur: { gst: '08', name: 'Rajasthan', ifscBank: 'HDFC' },
  Lucknow: { gst: '09', name: 'Uttar Pradesh', ifscBank: 'SBIN' },
  Indore: { gst: '23', name: 'Madhya Pradesh', ifscBank: 'SBIN' },
  Coimbatore: { gst: '33', name: 'Tamil Nadu', ifscBank: 'CNRB' },
  Kochi: { gst: '32', name: 'Kerala', ifscBank: 'FDRL' },
  Patna: { gst: '10', name: 'Bihar', ifscBank: 'SBIN' },
  Nagpur: { gst: '27', name: 'Maharashtra', ifscBank: 'HDFC' },
  Guwahati: { gst: '18', name: 'Assam', ifscBank: 'SBIN' },
};
/** Registration-number state prefix by GST state code. */
const REG_PREFIX: Record<string, string> = {
  '07': 'DL',
  '27': 'MH',
  '29': 'KA',
  '36': 'TS',
  '33': 'TN',
  '19': 'WB',
  '24': 'GJ',
  '08': 'RJ',
  '09': 'UP',
  '23': 'MP',
  '32': 'KL',
  '10': 'BR',
  '18': 'AS',
};

export interface OperatorState {
  index: number;
  name: string;
  slug: string;
  tenantId: string;
  ownerEmail: string;
  plan: string;
  corridors: string[];
  routes: {
    id: string;
    code: string;
    corridor: string;
    reverse: boolean;
    stops: { stopId: string; city: string; km: number; min: number }[];
    busType: string;
    serviceId?: string;
    vehicleId?: string;
  }[];
  staff: { email: string; roles: string[]; branchId?: string }[];
  agents: { id: string; email: string; billingMode: string }[];
  crewLogins: { phone: string }[];
  done: string[];
}
interface State {
  operators: Record<string, OperatorState>;
  /** Edge cases tried on the way, with what the API answered. */
  checks?: { op: number; what: string; expected: string; got: number; pass: boolean }[];
}
const load = (): State =>
  existsSync(STATE_FILE)
    ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State)
    : { operators: {} };
const save = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));

const log = (m: string) => process.stdout.write(`${new Date().toISOString().slice(0, 19)} ${m}\n`);

/** A tiny PDF, enough for a document upload. */
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function login(
  identifier: string,
  password: string,
  slug?: string,
): Promise<Record<string, string>> {
  const h: Record<string, string> = slug
    ? { 'x-tenant-slug': slug, 'x-debug-surface': 'tenantAdmin' }
    : { 'x-debug-surface': 'superAdmin' };
  const r = ok(
    await call('POST', '/auth/login', { identifier, password }, h),
    `login ${identifier}`,
  );
  return slug
    ? { authorization: `Bearer ${r.accessToken}`, 'x-tenant-slug': slug }
    : { authorization: `Bearer ${r.accessToken}` };
}

/** A GSTIN-shaped id for a state code: 2 digits + PAN + entity + Z + check char. */
function panFor(i: number) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const a = L[i % 26],
    b = L[Math.floor(i / 26) % 26];
  return `AA${a}C${b}${String(1000 + i).slice(-4)}${L[(i * 7) % 26]}`;
}

function reverseCorridor(c: Corridor) {
  const total = c.stops[c.stops.length - 1];
  return [...c.stops]
    .reverse()
    .map((s) => ({ city: s.city, km: total.km - s.km, min: total.min - s.min }));
}

/** ₹ fare for a stretch, rounded to ₹5, never under ₹60. */
function fareMinor(km: number, bus: BusType, type: keyof typeof TYPE_FACTOR) {
  const rupees = Math.max(60, Math.round((km * bus.paisePerKm * TYPE_FACTOR[type]) / 100 / 5) * 5);
  return rupees * 100;
}

async function setupOperator(
  i: number,
  state: State,
  superH: Record<string, string>,
  cityIds: Map<string, string>,
) {
  const names = operatorNames();
  const name = names[i];
  const rnd = prng(1000 + i);
  const key = `op${i}`;
  const existing = state.operators[key];
  const st: OperatorState = existing ?? {
    index: i,
    name,
    slug: '',
    tenantId: '',
    ownerEmail: `owner${i}@scale.ticketly.test`,
    plan: '',
    corridors: [],
    routes: [],
    staff: [],
    agents: [],
    crewLogins: [],
    done: [],
  };
  const step = async (label: string, fn: () => Promise<void>) => {
    if (st.done.includes(label)) return;
    await fn();
    st.done.push(label);
    state.operators[key] = st;
    save(state);
  };

  // Corridors: 5 per operator, the busy ones shared by many operators.
  if (st.corridors.length === 0) {
    const weighted = CORRIDORS.flatMap((c, k) =>
      Array.from({ length: k < 16 ? 4 : k < 30 ? 2 : 1 }, () => c.code),
    );
    const chosen = new Set<string>();
    while (chosen.size < 5) chosen.add(weighted[Math.floor(rnd() * weighted.length)]);
    st.corridors = [...chosen];
  }
  const home = CORRIDORS.find((c) => c.code === st.corridors[0])!.stops[0].city;
  const hs = HOME_STATE[home] ?? HOME_STATE.Delhi;
  const pan = panFor(i);
  const gstin = `${hs.gst}${pan}1Z${'ABCDEFGHJ'[i % 9]}`;
  const plan = i < 20 ? 'starter' : i < 80 ? 'growth' : 'enterprise';
  const staffCount = plan === 'starter' ? 3 : plan === 'growth' ? 5 : 7;

  // 1) Application (with KYC files) and approval.
  await step('approved', async () => {
    const docs: Record<string, string> = {};
    for (const docType of [
      'gst_certificate',
      'pan_card',
      'cancelled_cheque',
      'business_registration',
    ]) {
      const up = ok(
        await call(
          'POST',
          `/operators/apply/documents?docType=${docType}&fileName=${docType}.pdf`,
          PDF,
          {},
        ),
        `doc ${docType}`,
      );
      docs[docType] = up.fileId ?? up.id;
    }
    const applied = ok(
      await call(
        'POST',
        '/operators/apply',
        {
          firstName: name.split(' ')[0],
          lastName: 'Owner',
          email: st.ownerEmail,
          mobile: `9${String(810000000 + i * 37).slice(-9)}`,
          password: OWNER_PASSWORD,
          designation: 'Managing Director',
          companyName: name,
          companyType:
            i % 3 === 0 ? 'Private Limited' : i % 3 === 1 ? 'Partnership' : 'Proprietorship',
          gstNumber: gstin,
          panNumber: pan,
          officialEmail: `accounts${i}@scale.ticketly.test`,
          addressLine1: `${10 + i} Transport Nagar`,
          city: home,
          state: hs.name,
          country: 'India',
          pinCode: String(110001 + i),
          business: {
            numberOfBuses: 10,
            busTypes: ['seater', 'sleeper'],
            cities: st.corridors,
            yearsInBusiness: 3 + (i % 20),
            dailyTrips: 10,
          },
          bankAccountHolder: name,
          bankAccountNumber: String(50100000000 + i * 1111),
          bankIfsc: `${hs.ifscBank}0${String(100000 + i).slice(-6)}`,
          bankName: `${hs.ifscBank} Bank`,
          documents: docs,
        },
        {},
        `scale-apply-${i}`,
      ),
      'apply',
    );
    // A few applications wait for more information first — the platform's hold / reopen.
    if (i % 17 === 0) {
      await call(
        'POST',
        `/admin/operator-applications/${applied.applicationId}/hold`,
        { reason: 'Please upload a clearer GST certificate.' },
        superH,
      );
      await call(
        'POST',
        `/admin/operator-applications/${applied.applicationId}/reopen`,
        { reason: 'Clear GST certificate received by email.' },
        superH,
      );
    }
    const approved = ok(
      await call(
        'POST',
        `/admin/operator-applications/${applied.applicationId}/approve`,
        { note: 'KYC checked' },
        superH,
        `scale-approve-${i}`,
      ),
      'approve',
    );
    st.slug = approved.slug;
    st.tenantId = approved.tenantId;
  });

  // 2) Plan and platform commission (super admin).
  await step('plan', async () => {
    const plans = ok(await call('GET', '/admin/tenants/plans', undefined, superH), 'plans')
      .items as { id: string; code: string }[];
    const p = plans.find((x) => x.code === plan)!;
    ok(await call('POST', `/admin/tenants/${st.tenantId}/plan`, { planId: p.id }, superH), 'plan');
    const pct = [8, 9, 10, 10, 12][i % 5];
    ok(
      await call(
        'POST',
        '/payments/admin/commission',
        i % 7 === 0
          ? { tenantId: st.tenantId, model: 'percent_plus', percent: pct - 2, flatMinor: 1000 }
          : { tenantId: st.tenantId, model: 'percent', percent: pct },
        superH,
      ),
      'commission',
    );
    st.plan = plan;
  });

  const own = await login(st.ownerEmail, OWNER_PASSWORD, st.slug);

  await setupNetwork(i, st, own, superH, cityIds, rnd, step);
  await setupPeople(i, st, own, staffCount, rnd, step);
  await setupSettings(i, own, rnd, step);
  await step('edge', () => edgeCases(i, st, own, state));
  state.operators[key] = st;
  save(state);
  return st;
}

type Step = (label: string, fn: () => Promise<void>) => Promise<void>;
type H = Record<string, string>;
const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24, 2)}:${pad(m % 60, 2)}`;
const STOP_KIND = ['Bus Stand', 'ISBT', 'Highway Point', 'Central Bus Station', 'Travels Office'];

function homeOf(st: OperatorState) {
  const home = CORRIDORS.find((c) => c.code === st.corridors[0])!.stops[0].city;
  return HOME_STATE[home] ?? HOME_STATE.Delhi;
}

/** Three bus types per operator, rotated so all 22 kinds are on the road. */
const typesFor = (i: number) => [0, 1, 2].map((k) => BUS_TYPES[(i * 3 + k) % BUS_TYPES.length]);

/* ───────────── network: stops, layouts, bus types, routes, buses, fares, services ───────────── */

async function setupNetwork(
  i: number,
  st: OperatorState,
  own: H,
  superH: H,
  cityIds: Map<string, string>,
  rnd: () => number,
  step: Step,
) {
  const hs = homeOf(st);
  const types = typesFor(i);
  const stopIds = new Map<string, string>();
  const typeIds = new Map<string, string>();

  await step('stops', async () => {
    const cities = [
      ...new Set(
        st.corridors.flatMap((c) => CORRIDORS.find((x) => x.code === c)!.stops.map((s) => s.city)),
      ),
    ];
    for (const [k, city] of cities.entries()) {
      const cityId = cityIds.get(city);
      if (!cityId) throw new Error(`city ${city} missing — run geography-india.seed.sql`);
      ok(
        await call(
          'POST',
          '/master-data/stops',
          {
            cityId,
            name: `${city} ${STOP_KIND[(i + k) % STOP_KIND.length]}`,
            kind: 'both',
            landmark: `Near ${city} main road`,
            address: `${city}, ${k + 1} Station Road`,
            contactPhone: `9${pad(700000000 + i * 1000 + k, 9)}`,
          },
          own,
        ),
        `stop ${city}`,
      );
    }
  });
  // Always read the stops back (a re-run skips creating them).
  const stops = ok(await call('GET', '/master-data/stops', undefined, own), 'stops');
  const list = Array.isArray(stops) ? stops : (stops.items ?? []);
  for (const s of list)
    stopIds.set(
      s.name.replace(/ (Bus Stand|ISBT|Highway Point|Central Bus Station|Travels Office)$/, ''),
      s.id,
    );

  await step('bus-types', async () => {
    for (const t of types) {
      const layout = ok(
        await call('POST', '/master-data/seat-layouts', { name: t.name, layout: t.layout }, own),
        `layout ${t.code}`,
      );
      ok(
        await call(
          'POST',
          '/master-data/vehicle-types',
          { name: t.name, code: t.code, isAc: t.ac, seatLayoutId: layout.id },
          own,
        ),
        `type ${t.code}`,
      );
    }
  });
  const vts = ok(await call('GET', '/master-data/vehicle-types', undefined, own), 'vehicle types');
  for (const v of (Array.isArray(vts) ? vts : vts.items) as { id: string; code: string }[])
    typeIds.set(v.code, v.id);

  // Routes both ways, published; fares for every pair; a bus each; a daily service each.
  await step('routes', async () => {
    st.routes = [];
    for (const [k, code] of st.corridors.entries()) {
      const c = CORRIDORS.find((x) => x.code === code)!;
      const bus = types[k % types.length];
      const total = c.stops[c.stops.length - 1].min;
      for (const reverse of [false, true]) {
        const legs = reverse ? reverseCorridor(c) : c.stops;
        // Long corridors run overnight, short ones by day.
        const start =
          total >= 480
            ? 19 * 60 + Math.floor(rnd() * 8) * 30
            : 6 * 60 + Math.floor(rnd() * 18) * 30;
        const routeCode = `${code}${reverse ? '-R' : '-F'}`;
        const from = legs[0].city,
          to = legs[legs.length - 1].city;
        const r = ok(
          await call(
            'POST',
            '/master-data/routes',
            {
              code: routeCode,
              name: `${from} to ${to}`,
              originCityId: cityIds.get(from),
              destCityId: cityIds.get(to),
              startTime: hhmm(start),
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
          `route ${routeCode}`,
        );
        ok(
          await call('POST', `/master-data/routes/${r.id}/publish`, {}, own),
          `publish ${routeCode}`,
        );
        st.routes.push({
          id: r.id,
          code: routeCode,
          corridor: code,
          reverse,
          busType: bus.code,
          stops: legs.map((s) => ({
            stopId: stopIds.get(s.city)!,
            city: s.city,
            km: s.km,
            min: s.min,
          })),
        });
        (st.routes[st.routes.length - 1] as { startTime?: string }).startTime = hhmm(start);
      }
    }
  });

  await step('fares', async () => {
    for (const r of st.routes) {
      const bus = BUS_TYPES.find((b) => b.code === r.busType)!;
      const seatTypes = [...new Set(bus.layout.seats.map((s) => s.type))];
      const plan = ok(
        await call(
          'POST',
          '/pricing/fare-plans',
          { routeId: r.id, name: `${r.code} standard`, effectiveFrom: '2026-08-25' },
          own,
        ),
        `plan ${r.code}`,
      );
      const rows: {
        fromStopId: string;
        toStopId: string;
        seatType: string;
        baseFareMinor: number;
      }[] = [];
      for (let a = 0; a < r.stops.length; a += 1)
        for (let b = a + 1; b < r.stops.length; b += 1)
          for (const t of seatTypes)
            rows.push({
              fromStopId: r.stops[a].stopId,
              toStopId: r.stops[b].stopId,
              seatType: t,
              baseFareMinor: fareMinor(Math.abs(r.stops[b].km - r.stops[a].km), bus, t),
            });
      ok(
        await call('POST', `/pricing/fare-plans/${plan.id}/rules/import`, { rows }, own),
        `fares ${r.code}`,
      );
      ok(
        await call('POST', `/pricing/fare-plans/${plan.id}/activate`, {}, own),
        `activate plan ${r.code}`,
      );
    }
  });

  // Pickup / drop charges on every fourth operator's first route: at the second stop, or at the
  // first / last stop of a two-stop route (a stop only takes the charge it can serve).
  await step('point-charges', async () => {
    if (i % 4 !== 1) return;
    const r = st.routes[0];
    const items =
      r.stops.length > 2
        ? [{ stopId: r.stops[1].stopId, boardChargeMinor: 3000, dropChargeMinor: 2000 }]
        : [
            { stopId: r.stops[0].stopId, boardChargeMinor: 3000, dropChargeMinor: 0 },
            { stopId: r.stops[1].stopId, boardChargeMinor: 0, dropChargeMinor: 2000 },
          ];
    ok(
      await call('PUT', `/master-data/routes/${r.id}/point-charges`, { items }, own),
      'point charges',
    );
  });

  // Ten buses, one per route, with their six documents; submitted for verification.
  const reg = REG_PREFIX[hs.gst] ?? 'DL';
  for (const [v, r] of st.routes.entries()) {
    await step(`bus-${v}`, async () => {
      const bus = BUS_TYPES.find((b) => b.code === r.busType)!;
      const regNo = `${reg}${pad(1 + (i % 98), 2)}${L[i % 26]}${L[Math.floor(i / 26) % 26]}${1001 + v}`;
      const res = await call(
        'POST',
        '/fleet/vehicles',
        {
          registrationNo: regNo,
          vehicleTypeId: typeIds.get(bus.code),
          make: ['Volvo', 'Ashok Leyland', 'Tata', 'BharatBenz', 'Eicher', 'Scania'][(i + v) % 6],
          model: bus.name.slice(0, 60),
          manufactureYear: 2016 + ((i + v) % 10),
          chassisNo: `MA${pad(i, 3)}${pad(v, 2)}CH${pad(i * 10 + v, 6)}`.slice(0, 17),
          engineNo: `EN${pad(i, 3)}${pad(v, 3)}`,
          fuelType: (i + v) % 17 === 0 ? 'cng' : 'diesel',
          registeredOwner: st.name,
          registrationState: hs.name,
          hasAc: bus.ac,
          registrationDate: `${2016 + ((i + v) % 10)}-0${1 + (v % 9)}-15`,
        },
        own,
      );
      let id: string;
      if (res.status === 409) {
        // A re-run: the bus is there from last time.
        const all = ok(await call('GET', '/fleet/vehicles?pageSize=100', undefined, own), 'buses');
        id = ((all.items ?? all) as { id: string; registrationNo: string }[]).find(
          (x) => x.registrationNo === regNo,
        )!.id;
      } else id = ok(res, `bus ${regNo}`).id;
      r.vehicleId = id;
      for (const docType of ['rc', 'insurance', 'permit', 'fitness', 'puc', 'road_tax']) {
        const f = ok(
          await call(
            'POST',
            `/fleet/vehicles/${id}/documents/file?docType=${docType}&fileName=${docType}.pdf`,
            PDF,
            own,
          ),
          `file ${docType}`,
        );
        // Every fifth bus has a PUC that runs out in October — the expiry alerts have something to show.
        const expiresOn =
          docType === 'puc' && (i + v) % 5 === 0
            ? '2026-10-20'
            : docType === 'rc'
              ? '2031-03-31'
              : '2027-08-31';
        ok(
          await call(
            'POST',
            `/fleet/vehicles/${id}/documents`,
            {
              docType,
              documentNo: docType === 'rc' ? regNo : `${docType.toUpperCase()}-${regNo}`,
              validFrom: '2026-04-01',
              expiresOn,
              issuer: `${hs.name} Transport Dept`,
              fileId: f.fileId,
            },
            own,
          ),
          `doc ${docType}`,
        );
      }
      // Interstate corridors need an All-India Tourist Permit; within a state a stage-carriage or state permit does.
      const c = CORRIDORS.find((x) => x.code === r.corridor)!;
      const states = new Set(c.stops.map((s) => HOME_STATE[s.city]?.gst ?? s.city));
      const permitType =
        states.size > 1 ? 'aitp' : (i + v) % 2 ? 'stage_carriage' : 'state_tourist_permit';
      ok(
        await call('POST', `/fleet/vehicles/${id}/permit-type`, { permitType }, own),
        `permit ${regNo}`,
      );
      ok(await call('POST', `/fleet/vehicles/${id}/submit`, {}, own), `submit ${regNo}`);
    });
  }

  // Super admin: verify every document, approve; a few buses have their insurance rejected once.
  await step('bus-approval', async () => {
    for (const [v, r] of st.routes.entries()) {
      const id = r.vehicleId!;
      const docsOf = async () => {
        const d = ok(await call('GET', `/admin/vehicles/${id}`, undefined, superH), 'bus detail');
        return (d.documents ?? d.vehicle?.documents ?? []) as {
          id: string;
          docType: string;
          status?: string;
          verificationStatus?: string;
        }[];
      };
      if ((i * 10 + v) % 13 === 0) {
        const ins = (await docsOf()).find((d) => d.docType === 'insurance')!;
        ok(
          await call(
            'POST',
            `/admin/vehicles/${id}/documents/${ins.id}/reject`,
            { reason: 'Insurance copy is unreadable, please upload again.' },
            superH,
          ),
          'reject doc',
        );
        const f = ok(
          await call(
            'POST',
            `/fleet/vehicles/${id}/documents/file?docType=insurance&fileName=insurance-clear.pdf`,
            PDF,
            own,
          ),
          'file again',
        );
        ok(
          await call(
            'POST',
            `/fleet/vehicles/${id}/documents`,
            {
              docType: 'insurance',
              documentNo: `INS-R-${id.slice(-6)}`,
              validFrom: '2026-04-01',
              expiresOn: '2027-08-31',
              fileId: f.fileId,
            },
            own,
          ),
          'doc again',
        );
        await call('POST', `/fleet/vehicles/${id}/submit`, {}, own);
      }
      for (const d of await docsOf()) {
        const s = d.status ?? d.verificationStatus;
        if (s === 'verified' || s === 'rejected' || s === 'superseded') continue;
        ok(
          await call('POST', `/admin/vehicles/${id}/documents/${d.id}/verify`, {}, superH),
          `verify ${d.docType}`,
        );
      }
      ok(
        await call(
          'POST',
          `/admin/vehicles/${id}/approve`,
          { reason: 'Documents verified' },
          superH,
        ),
        'approve bus',
      );
    }
  });

  await step('services', async () => {
    for (const [k, r] of st.routes.entries()) {
      const start = (r as { startTime?: string }).startTime!;
      // One route of every ninth operator runs weekends only (Fri–Sun).
      const weekly = i % 9 === 0 && k === 2;
      const svc = ok(
        await call(
          'POST',
          '/scheduling/services',
          {
            code: `${r.code}-${start.replace(':', '')}`,
            routeId: r.id,
            vehicleTypeId: typeIds.get(r.busType),
            defaultVehicleId: r.vehicleId,
            startTime: start,
            recurrence: weekly
              ? {
                  frequency: 'weekly',
                  weekdays: [5, 6, 7],
                  startDate: '2026-09-01',
                  endDate: '2026-10-10',
                }
              : { frequency: 'daily', startDate: '2026-09-01', endDate: '2026-10-10' },
          },
          own,
          `service-${r.id}-${start}`,
        ),
        `service ${r.code}`,
      );
      r.serviceId = svc.id;
      ok(
        await call('POST', `/scheduling/services/${svc.id}/activate`, {}, own),
        'activate service',
      );
      ok(await call('POST', `/scheduling/services/${svc.id}/materialise`, {}, own), 'materialise');
    }
  });
}

/* ───────────── people: branches, staff, agents, crew ───────────── */

/** Counter clerks (from the platform's role template), the built-in manager / support / viewer, and two custom roles. */
const STAFF_ROLES = [
  'booking_clerk',
  'manager',
  'ops',
  'finance',
  'support',
  'booking_clerk',
  'viewer',
];
const CUSTOM_ROLES = [
  {
    code: 'finance',
    name: 'Finance',
    description: 'Payments, refunds, settlements and reports',
    permissions: [
      'booking:read',
      'payment:read',
      'payment:refund',
      'settlement:manage',
      'report:read',
      'report:export',
    ],
  },
  {
    code: 'ops',
    name: 'Operations',
    description: 'Trips, seats, buses and crew on the day',
    permissions: [
      'booking:read',
      'route:read',
      'service:read',
      'service:manage',
      'trip:manage',
      'trip:operate',
      'inventory:manage',
      'vehicle:read',
      'crew:manage',
      'tracking:read',
    ],
  },
];

async function setupPeople(
  i: number,
  st: OperatorState,
  own: H,
  staffCount: number,
  rnd: () => number,
  step: Step,
) {
  const cities = [...new Set(st.routes.map((r) => r.stops[0].city))];
  const branchIds: string[] = [];
  await step('branches', async () => {
    const n = st.plan === 'starter' ? 1 : st.plan === 'growth' ? 2 : 3;
    for (let b = 0; b < n; b += 1) {
      const city = cities[b % cities.length];
      ok(
        await call(
          'POST',
          '/branches',
          {
            name: `${city} booking counter`,
            code: `${city.slice(0, 3).toUpperCase()}-${b + 1}`,
            address: `${b + 3} Bus Stand Road, ${city}`,
            phone: `0${pad(1123450000 + i * 10 + b, 10)}`,
          },
          own,
        ),
        `branch ${city}`,
      );
    }
  });
  const br = ok(await call('GET', '/branches', undefined, own), 'branches');
  for (const b of (Array.isArray(br) ? br : br.items) as { id: string }[]) branchIds.push(b.id);

  await step('roles', async () => {
    const templates = ok(await call('GET', '/roles/templates', undefined, own), 'role templates')
      .items as { id: string; code: string }[];
    const clerk = templates.find((t) => t.code === 'booking_clerk');
    if (!clerk) throw new Error('role template booking_clerk missing');
    ok(await call('POST', `/roles/templates/${clerk.id}/apply`, {}, own), 'apply clerk');
    for (const r of CUSTOM_ROLES) ok(await call('POST', '/roles', r, own), `role ${r.code}`);
  });

  await step('staff', async () => {
    st.staff = [];
    for (let k = 0; k < staffCount; k += 1) {
      const role = STAFF_ROLES[k % STAFF_ROLES.length];
      const email = `staff${i}-${k}@scale.ticketly.test`;
      const u = ok(
        await call(
          'POST',
          '/users',
          {
            fullName: `${['Ravi', 'Priya', 'Amit', 'Sunita', 'Karan', 'Neha', 'Vikram', 'Pooja'][(i + k) % 8]} ${['Sharma', 'Verma', 'Iyer', 'Reddy', 'Patel', 'Das', 'Singh', 'Nair'][(i * 3 + k) % 8]}`,
            email,
            phone: `7${pad(i, 3)}1${pad(k, 5)}`,
            password: STAFF_PASSWORD,
            roles: [role],
          },
          own,
        ),
        `staff ${email}`,
      );
      const branchId =
        role === 'booking_clerk' || role === 'manager'
          ? branchIds[k % branchIds.length]
          : undefined;
      if (branchId)
        ok(await call('PUT', `/users/${u.id}/branch`, { branchId }, own), 'staff branch');
      st.staff.push({ email, roles: [role], branchId });
    }
  });

  // A staff member leaves: enterprise operators switch off their last hire (viewer) — the login stops, the history stays.
  await step('offboard', async () => {
    if (st.plan !== 'enterprise') return;
    const leaver = st.staff[st.staff.length - 1];
    const found = ok(
      await call('GET', `/users?q=${encodeURIComponent(leaver.email)}`, undefined, own),
      'find leaver',
    ).items as { id: string }[];
    ok(await call('PATCH', `/users/${found[0].id}`, { status: 'disabled' }, own), 'disable leaver');
    (leaver as { disabled?: boolean }).disabled = true;
  });

  await step('agents', async () => {
    st.agents = [];
    const n = st.plan === 'enterprise' ? 3 : 2;
    for (let k = 0; k < n; k += 1) {
      const prepaid = k % 2 === 0;
      const email = `agent${i}-${k}@scale.ticketly.test`;
      const city = cities[k % cities.length];
      const a = ok(
        await call(
          'POST',
          '/agents',
          {
            name: `${city} ${['Tours', 'Travel Point', 'Holidays'][k]}`,
            code: `AG${i}-${k}`,
            contactName: `Agent ${i}-${k}`,
            contactPhone: `7${pad(i, 3)}2${pad(k, 5)}`,
            contactEmail: email,
            city,
            branchId: branchIds[k % branchIds.length],
            billingMode: prepaid ? 'prepaid' : 'postpaid',
            commissionPct: [5, 7, 8][k],
            ...(prepaid ? {} : { creditLimitMinor: 20_000_000, paymentTermsDays: 15 }),
            lowBalanceAlertMinor: 500_000,
            loginEmail: email,
            password: AGENT_PASSWORD,
            activate: k < 2,
          },
          own,
          `scale-agent-${i}-${k}`,
        ),
        `agent ${email}`,
      );
      if (prepaid && k < 2)
        ok(
          await call(
            'POST',
            `/agents/${a.agentId}/receipts`,
            {
              amountMinor: 5_000_000 + Math.floor(rnd() * 10) * 500_000,
              reference: `UTR${pad(i, 3)}${k}0001`,
              note: 'Opening top-up',
            },
            own,
            `scale-topup-${i}-${k}`,
          ),
          'top-up',
        );
      st.agents.push({ id: a.agentId, email, billingMode: prepaid ? 'prepaid' : 'postpaid' });
    }
  });

  await step('crew', async () => {
    st.crewLogins = [];
    for (const [v, r] of st.routes.entries()) {
      const bus = BUS_TYPES.find((b) => b.code === r.busType)!;
      const roles = bus.layout.seats.some((s) => s.type === 'sleeper')
        ? ['driver', 'driver', 'conductor']
        : ['driver', 'conductor'];
      for (const [c, role] of roles.entries()) {
        const phone = `8${pad(i, 3)}${pad(v * 10 + c, 6)}`;
        const cr = ok(
          await call(
            'POST',
            '/fleet/crew',
            {
              role,
              fullName: `${['Ramesh', 'Suresh', 'Mahesh', 'Dinesh', 'Rajesh', 'Mukesh'][(v + c) % 6]} ${['Yadav', 'Kumar', 'Gowda', 'Pillai', 'Rathod'][(i + c) % 5]}`,
              phone,
              employeeCode: `E${i}-${v}-${c}`,
              ...(role === 'driver'
                ? {
                    licenceNo: `DL${pad(i, 3)}${pad(v, 2)}${c}20${pad(10 + v, 2)}`,
                    licenceExpiresOn: (i + v) % 11 === 0 ? '2026-10-25' : '2030-12-31',
                  }
                : {}),
            },
            own,
          ),
          `crew ${phone}`,
        );
        if (v < 2) {
          ok(
            await call('PUT', `/fleet/crew/${cr.id}/login`, { password: CREW_PASSWORD }, own),
            'crew login',
          );
          st.crewLogins.push({ phone });
        }
      }
    }
  });
}

/* ───────────── settings: OTAs, refunds, concessions, luggage, add-ons, coupons, waitlist ───────────── */

const REFUND_TIERS = [
  [
    { minHoursBeforeDeparture: 48, refundPct: 90 },
    { minHoursBeforeDeparture: 24, refundPct: 75 },
    { minHoursBeforeDeparture: 6, refundPct: 50 },
    { minHoursBeforeDeparture: 0, refundPct: 0 },
  ],
  [
    { minHoursBeforeDeparture: 24, refundPct: 85 },
    { minHoursBeforeDeparture: 12, refundPct: 60 },
    { minHoursBeforeDeparture: 0, refundPct: 0 },
  ],
  [
    { minHoursBeforeDeparture: 72, refundPct: 100 },
    { minHoursBeforeDeparture: 24, refundPct: 80 },
    { minHoursBeforeDeparture: 4, refundPct: 40 },
    { minHoursBeforeDeparture: 0, refundPct: 0 },
  ],
];

async function setupSettings(i: number, own: H, rnd: () => number, step: Step) {
  await step('settings', async () => {
    const partners = ok(await call('GET', '/gds-partners', undefined, own), 'partners').items as {
      partnerId: string;
      code: string;
    }[];
    for (const p of partners) {
      const join = p.code === 'redbus-demo' ? i % 10 < 7 : p.code === 'abhibus' ? i % 5 < 2 : false;
      if (join)
        ok(
          await call(
            'PUT',
            `/gds-partners/${p.partnerId}`,
            { status: 'active', commissionPct: 6 + (i % 5) },
            own,
          ),
          `ota ${p.code}`,
        );
    }
    ok(
      await call(
        'PATCH',
        '/operator/refund-policy',
        {
          tiers: REFUND_TIERS[i % 3],
          flatFeeMinor: i % 4 === 0 ? 0 : 2500 + (i % 3) * 2500,
          cutoffHours: i % 6 === 0 ? 2 : 0,
          partialCancellation: i % 8 !== 0,
        },
        own,
      ),
      'refund policy',
    );
    ok(
      await call(
        'PUT',
        '/concessions/rules',
        {
          category: 'senior',
          discountPct: 10 + (i % 3) * 5,
          minAge: 60,
          maxAge: 120,
          requiresIdProof: true,
          active: true,
        },
        own,
      ),
      'senior',
    );
    if (i % 2 === 0)
      ok(
        await call(
          'PUT',
          '/concessions/rules',
          {
            category: 'student',
            discountPct: 10,
            minAge: 12,
            maxAge: 30,
            requiresIdProof: true,
            maxPerBooking: 4,
            active: true,
          },
          own,
        ),
        'student',
      );
    if (i % 3 === 0)
      ok(
        await call(
          'PUT',
          '/concessions/rules',
          { category: 'child', discountPct: 25, minAge: 5, maxAge: 12, active: true },
          own,
        ),
        'child',
      );
    ok(
      await call('PUT', '/concessions/round-trip', { discountPct: [0, 5, 10, 0, 15][i % 5] }, own),
      'round trip',
    );
    ok(
      await call(
        'PUT',
        '/operator/luggage-policy',
        {
          freeKg: 15 + (i % 3) * 5,
          freePieces: 2,
          extraPerKgMinor: i % 4 === 0 ? null : 1500 + (i % 3) * 500,
          note: 'No gas cylinders, fuel or live animals.',
        },
        own,
      ),
      'luggage',
    );
    ok(
      await call(
        'PUT',
        '/operator/waitlist-rules',
        {
          maxPerTrip: 20 + (i % 5) * 10,
          maxSeatsPerEntry: 4,
          closeMinutesBefore: 60,
          entryExpiryHours: i % 2 ? 48 : null,
        },
        own,
      ),
      'waitlist',
    );
    ok(
      await call('PATCH', '/operator/invoice-prefix', { prefix: `SC${i}` }, own),
      'invoice prefix',
    );
    const addOns = [
      {
        code: 'meal',
        name: 'Dinner meal box',
        kind: 'meal',
        priceMinor: 12000 + (i % 4) * 2000,
        perPassenger: true,
      },
      {
        code: 'insurance',
        name: 'Travel insurance',
        kind: 'insurance',
        priceMinor: 4900,
        perPassenger: true,
      },
      {
        code: 'extra-bag',
        name: 'Extra bag (up to 15 kg)',
        kind: 'luggage',
        priceMinor: 15000,
        perPassenger: false,
      },
    ];
    for (const a of addOns.slice(0, 1 + (i % 3)))
      ok(
        await call('POST', '/me/ancillaries/catalogue', { ...a, active: true }, own),
        `add-on ${a.code}`,
      );
    ok(
      await call(
        'POST',
        '/pricing/coupons',
        {
          code: `OP${i}SAVE10`,
          kind: 'percent',
          value: 10,
          maxDiscountMinor: 15000,
          validTo: '2026-10-31T18:29:59Z',
          perUserLimit: 2,
          description: '10% off, up to ₹150',
        },
        own,
      ),
      'coupon save10',
    );
    ok(
      await call(
        'POST',
        '/pricing/coupons',
        {
          code: `OP${i}FLAT50`,
          kind: 'flat',
          value: 5000,
          minFareMinor: 50000,
          maxRedemptions: 300,
          validTo: '2026-10-31T18:29:59Z',
        },
        own,
      ),
      'coupon flat50',
    );
    if (i % 3 === 0)
      ok(
        await call(
          'POST',
          '/pricing/coupons',
          {
            code: `OP${i}FIRST`,
            kind: 'percent',
            value: 15,
            maxDiscountMinor: 20000,
            firstBookingOnly: true,
            validTo: '2026-12-31T18:29:59Z',
          },
          own,
        ),
        'coupon first',
      );
    if (i % 5 === 1)
      ok(
        await call(
          'PUT',
          '/concessions/booking-window',
          { maxAdvanceDays: 30, minMinutesBeforeDeparture: 15 },
          own,
        ),
        'booking window',
      );
    void rnd;
  });
}

/* ───────────── edge cases: what must be refused, is ───────────── */

async function edgeCases(i: number, st: OperatorState, own: H, state: State) {
  const record = (what: string, res: Res, expected: number[]) => {
    const pass = expected.includes(res.status);
    (state.checks ??= []).push({
      op: i,
      what,
      expected: expected.join('|'),
      got: res.status,
      pass,
    });
    if (!pass)
      log(`op${i} CHECK FAILED ${what}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  };
  const r0 = st.routes[0];
  const bus = BUS_TYPES.find((b) => b.code === r0.busType)!;
  const vt = ok(await call('GET', '/master-data/vehicle-types', undefined, own), 'types');
  const typeId = ((Array.isArray(vt) ? vt : vt.items) as { id: string; code: string }[]).find(
    (t) => t.code === bus.code,
  )!.id;
  const detail = ok(await call('GET', `/fleet/vehicles/${r0.vehicleId}`, undefined, own), 'bus');
  // The same registration number twice.
  record(
    'duplicate bus registration',
    await call(
      'POST',
      '/fleet/vehicles',
      {
        registrationNo: detail.registrationNo ?? detail.vehicle?.registrationNo,
        vehicleTypeId: typeId,
      },
      own,
    ),
    [409],
  );
  // A malformed registration number.
  record(
    'bad registration number',
    await call('POST', '/fleet/vehicles', { registrationNo: 'XX-12', vehicleTypeId: typeId }, own),
    [400, 422],
  );
  // A free (₹0) fare.
  record(
    'zero fare',
    await call(
      'POST',
      '/pricing/fare-plans/rules',
      {
        farePlanId: r0.id,
        fromStopId: r0.stops[0].stopId,
        toStopId: r0.stops[1].stopId,
        seatType: 'seater',
        baseFareMinor: 0,
      },
      own,
    ),
    [400],
  );
  // A coupon that has already ended, and one over 100%.
  record(
    'expired coupon',
    await call(
      'POST',
      '/pricing/coupons',
      { code: `OP${i}OLD`, kind: 'percent', value: 10, validTo: '2026-08-01T00:00:00Z' },
      own,
    ),
    [400],
  );
  record(
    'coupon over 100%',
    await call(
      'POST',
      '/pricing/coupons',
      { code: `OP${i}HUGE`, kind: 'percent', value: 150 },
      own,
    ),
    [400],
  );
  // The same coupon code again.
  record(
    'duplicate coupon code',
    await call(
      'POST',
      '/pricing/coupons',
      { code: `OP${i}SAVE10`, kind: 'percent', value: 5, validTo: '2026-10-31T18:29:59Z' },
      own,
    ),
    [409, 422],
  );
  // Round-trip discount over the 50% cap.
  record(
    'round trip 60%',
    await call('PUT', '/concessions/round-trip', { discountPct: 60 }, own),
    [400],
  );
  // A driver without a licence.
  record(
    'driver without licence',
    await call('POST', '/fleet/crew', { role: 'driver', fullName: 'No Licence' }, own),
    [400],
  );
  // Staff with an email that is already taken.
  if (st.staff[0])
    record(
      'duplicate staff email',
      await call(
        'POST',
        '/users',
        {
          fullName: 'Copy Cat',
          email: st.staff[0].email,
          password: STAFF_PASSWORD,
          roles: ['viewer'],
        },
        own,
      ),
      st.plan === 'starter' ? [403, 409] : [409],
    );
  // The starter plan's staff limit (5): the fifth is fine, the sixth is refused.
  if (st.plan === 'starter') {
    const fifth = await call(
      'POST',
      '/users',
      {
        fullName: 'Fifth Clerk',
        email: `staff${i}-extra@scale.ticketly.test`,
        password: STAFF_PASSWORD,
        roles: ['booking_clerk'],
      },
      own,
    );
    if (fifth.status === 201)
      st.staff.push({ email: `staff${i}-extra@scale.ticketly.test`, roles: ['booking_clerk'] });
    record('starter plan: 5th staff', fifth, [201, 409]);
    record(
      'starter plan: 6th staff refused',
      await call(
        'POST',
        '/users',
        {
          fullName: 'Sixth Clerk',
          email: `staff${i}-over@scale.ticketly.test`,
          password: STAFF_PASSWORD,
          roles: ['booking_clerk'],
        },
        own,
      ),
      [402, 403, 409, 422],
    );
  }
  // Another operator's bus, route and agent are not visible (tenant isolation).
  const other = Object.values(state.operators).find(
    (o) => o.index !== i && o.routes[0]?.vehicleId && o.agents[0],
  );
  if (other) {
    record(
      "another operator's bus",
      await call('GET', `/fleet/vehicles/${other.routes[0].vehicleId}`, undefined, own),
      [404],
    );
    record(
      "another operator's route",
      await call('GET', `/master-data/routes/${other.routes[0].id}`, undefined, own),
      [404],
    );
    record(
      "top up another operator's agent",
      await call(
        'POST',
        `/agents/${other.agents[0].id}/receipts`,
        { amountMinor: 100000, reference: `X${i}-steal` },
        own,
        `scale-steal-${i}`,
      ),
      [404],
    );
  }
  save(state);
}

/* ───────────── main ───────────── */

async function main() {
  const from = Number(process.argv[2] ?? 0);
  const to = Number(process.argv[3] ?? 99);
  const conc = Number(process.env.SCALE_CONC ?? 4);
  const state = load();
  const superH = await login(SUPER.identifier, SUPER.password);
  const cityIds = new Map<string, string>();
  const names = [...new Set(CORRIDORS.flatMap((c) => c.stops.map((s) => s.city)))];
  await pool(names, 8, async (name) => {
    const r = ok(
      await call(
        'GET',
        `/master-data/cities/search?q=${encodeURIComponent(name)}`,
        undefined,
        superH,
      ),
      `city ${name}`,
    );
    const items = (Array.isArray(r) ? r : r.items) as { id: string; name: string }[];
    const hit = items.find((c) => c.name === name);
    if (!hit) throw new Error(`city ${name} not found — run db/seeds/geography-india.seed.sql`);
    cityIds.set(name, hit.id);
  });
  log(`cities ${cityIds.size}; operators ${from}..${to}`);
  const idx = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  let failed = 0;
  await pool(idx, conc, async (i) => {
    try {
      const st = await setupOperator(i, state, superH, cityIds);
      log(`op${i} ${st.name} (${st.slug}) ready`);
    } catch (e) {
      failed += 1;
      log(`op${i} FAILED: ${(e as Error).message}`);
    }
  });
  log(`done, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

export {
  setupOperator,
  login,
  fareMinor,
  reverseCorridor,
  load,
  save,
  log,
  PDF,
  REG_PREFIX,
  OWNER_PASSWORD,
  STAFF_PASSWORD,
  AGENT_PASSWORD,
  CREW_PASSWORD,
  SUPER,
};
export type { State, Step };

if (process.argv[1]?.endsWith('setup.ts')) void main();
