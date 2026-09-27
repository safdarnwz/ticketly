/**
 * ============================================================================
 *  Scale data set, part 2 — a month of trading, one day at a time
 * ============================================================================
 *
 * Run with the clock set by scripts/scale/timeshift.sh (Postgres, API and
 * worker under libfaketime). Every write goes through the HTTP API; the
 * timetable (which trips run on a date) is read from the database, the way a
 * customer would already know which buses run.
 *
 *   npx tsx scripts/scale/history.ts init            (once, clock 31 Aug, LOG_LEVEL=info)
 *   npx tsx scripts/scale/history.ts sales 2026-09-01 (clock 00:30 that day)
 *   npx tsx scripts/scale/history.ts ops   2026-09-01 (clock 23:50 that day)
 *
 * Sales: web (guest, signed in, app), counter (cash), phone bookings (paid at a
 * branch or left to lapse), agents (prepaid / postpaid, top-ups on 402), OTA
 * partners through the GDS API; coupons, concessions, add-ons, ladies seats,
 * round trips, failed and abandoned payments. Each booking gets a fate decided
 * up front (cancel, partial cancel, reschedule, seat / name / point change)
 * that is carried out on its day. Ops: conductor and driver duties, departure,
 * boarding, no-shows, arrival, a few incidents and lost items, cancelled trips,
 * reviews and replies, support tickets, postpaid agents paying up.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

import { BUS_TYPES, prng, type Seat } from './catalogue';
import { call, ok, pool, type Res } from './http';
import {
  AGENT_PASSWORD,
  CREW_PASSWORD,
  OWNER_PASSWORD,
  STAFF_PASSWORD,
  SUPER,
  load,
  log,
  login,
  type OperatorState,
} from './setup';

type H = Record<string, string>;
const DIR = __dirname;
const HIST_FILE = join(DIR, 'history.json');
const BOOKINGS_FILE = join(DIR, 'bookings.ndjson');
const CUSTOMER_PASSWORD = 'Customer-pass-2026';
const CONC = Number(process.env.SCALE_CONC ?? 48);
const CUSTOMERS = Number(process.env.SCALE_CUSTOMERS ?? 6000);

/* ───────────── persisted state ───────────── */

interface Crew {
  id: string;
  phone: string;
  role: string;
}
interface Hist {
  otaKeys: Record<string, { partnerId: string; key: string }>;
  customers: { email: string; mobile: string; name: string }[];
  crew: Record<string, Record<number, Crew[]>>; // op → route index → crew
  addOns: Record<string, { id: string; perPassenger: boolean }[]>;
  days: string[];
  stats: Record<string, number>;
  /** trip → the conductor's duty id (assigned the morning the trip runs). */
  duties?: Record<string, string>;
}
const loadHist = (): Hist =>
  existsSync(HIST_FILE)
    ? (JSON.parse(readFileSync(HIST_FILE, 'utf8')) as Hist)
    : { otaKeys: {}, customers: [], crew: {}, addOns: {}, days: [], stats: {} };
const saveHist = (h: Hist) => writeFileSync(HIST_FILE, JSON.stringify(h));

type Channel = 'web' | 'app' | 'customer' | 'counter' | 'phone' | 'agent' | 'ota';
type Fate = 'keep' | 'cancel' | 'partial' | 'reschedule' | 'seats' | 'name' | 'points';
interface BookingRec {
  id: string;
  pnr: string;
  op: number;
  route: number;
  tripId: string;
  journeyDate: string;
  soldOn: string;
  channel: Channel;
  phone: string;
  seats: string[];
  seatType: string;
  from: string;
  to: string;
  customer?: number;
  agent?: number;
  ota?: string;
  total: number;
  fate: Fate;
  fateOn?: string;
  names?: string[];
}

const stat = (h: Hist, k: string, n = 1) => {
  h.stats[k] = (h.stats[k] ?? 0) + n;
};

/* ───────────── small helpers ───────────── */

const FIRST_M = [
  'Rahul',
  'Amit',
  'Suresh',
  'Vikram',
  'Arjun',
  'Rohan',
  'Manoj',
  'Sanjay',
  'Imran',
  'Joseph',
  'Harpreet',
  'Karthik',
  'Anil',
  'Deepak',
  'Nitin',
  'Farhan',
];
const FIRST_F = [
  'Priya',
  'Anjali',
  'Sneha',
  'Pooja',
  'Kavita',
  'Meera',
  'Ayesha',
  'Divya',
  'Lakshmi',
  'Neha',
  'Simran',
  'Fatima',
  'Ritu',
  'Swati',
  'Nandini',
  'Maria',
];
const LAST = [
  'Sharma',
  'Verma',
  'Gupta',
  'Iyer',
  'Reddy',
  'Patel',
  'Khan',
  'Das',
  'Singh',
  'Nair',
  'Joshi',
  'Mehta',
  'Rao',
  'Bose',
  'Gill',
  'Fernandes',
];
const pick = <T>(rnd: () => number, xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const weighted = <T>(rnd: () => number, items: [T, number][]) => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items[items.length - 1][0];
};
const errText = (r: Res) =>
  `${r.status} ${(r.body as { detail?: string })?.detail ?? JSON.stringify(r.body).slice(0, 160)}`;

/** The services run on a shifted clock (libfaketime); this script does not — ask the database. */
let clockOffset = 0;
const now = () => Date.now() + clockOffset;

async function db(): Promise<Client> {
  const c = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();
  const r = await c.query<{ now: Date }>('SELECT now() AS now');
  clockOffset = r.rows[0].now.getTime() - Date.now();
  return c;
}

/* ───────────── sign-ins, cached and renewed on 401 ───────────── */

class Sessions {
  private cache = new Map<string, Promise<H>>();
  get(key: string, make: () => Promise<H>): Promise<H> {
    let p = this.cache.get(key);
    if (!p) {
      p = make();
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }
  drop(key: string) {
    this.cache.delete(key);
  }
}
const sessions = new Sessions();

/** Call with a signed-in principal; sign in again once if the token has lapsed. */
async function as(
  key: string,
  make: () => Promise<H>,
  method: string,
  path: string,
  body?: unknown,
  extra: H = {},
  idem?: string,
): Promise<Res> {
  let h = await sessions.get(key, make);
  let r = await call(method, path, body, { ...h, ...extra }, idem);
  if (r.status === 401) {
    sessions.drop(key);
    h = await sessions.get(key, make);
    r = await call(method, path, body, { ...h, ...extra }, idem);
  }
  return r;
}

const superLogin = () => login(SUPER.identifier, SUPER.password);
const ownerOf = (o: OperatorState) => (m: string, p: string, b?: unknown, idem?: string) =>
  as(`owner${o.index}`, () => login(o.ownerEmail, OWNER_PASSWORD, o.slug), m, p, b, {}, idem);
const clerkOf = (o: OperatorState) => {
  const clerks = o.staff.filter(
    (s) => s.roles.includes('booking_clerk') && !(s as { disabled?: boolean }).disabled,
  );
  const s = clerks[Math.floor(Math.random() * clerks.length)] ?? o.staff[0];
  return (m: string, p: string, b?: unknown, idem?: string) =>
    as(`staff:${s.email}`, () => login(s.email, STAFF_PASSWORD, o.slug), m, p, b, {}, idem);
};
/** A branch manager (cancellations need booking:cancel, which counter clerks do not have); the owner if none. */
const managerOf = (o: OperatorState) => {
  const m = o.staff.find(
    (s) => s.roles.includes('manager') && !(s as { disabled?: boolean }).disabled,
  );
  if (!m) return ownerOf(o);
  return (mt: string, p: string, b?: unknown, idem?: string) =>
    as(`staff:${m.email}`, () => login(m.email, STAFF_PASSWORD, o.slug), mt, p, b, {}, idem);
};
const agentOf =
  (o: OperatorState, k: number) => (m: string, p: string, b?: unknown, idem?: string) =>
    as(
      `agent:${o.agents[k].email}`,
      () => login(o.agents[k].email, AGENT_PASSWORD, o.slug),
      m,
      p,
      b,
      {},
      idem,
    );
const crewOf = (o: OperatorState, c: Crew) => (m: string, p: string, b?: unknown, idem?: string) =>
  as(`crew:${c.phone}`, () => login(c.phone, CREW_PASSWORD, o.slug), m, p, b, {}, idem);
const customerOf =
  (h: Hist, n: number, tenantId: string) => (m: string, p: string, b?: unknown, idem?: string) =>
    as(
      `cust:${n}`,
      async () => {
        const r = ok(
          await call('POST', '/auth/login', {
            identifier: h.customers[n].email,
            password: CUSTOMER_PASSWORD,
          }),
          'customer login',
        );
        return { authorization: `Bearer ${r.accessToken}` };
      },
      m,
      p,
      b,
      { 'x-tenant-id': tenantId },
      idem,
    );

/* ───────────── init: OTA keys, crew logins, customers ───────────── */

async function init() {
  const state = load();
  const h = loadHist();
  const superH = await superLogin();
  const ops = Object.values(state.operators).sort((a, b) => a.index - b.index);

  // OTA partners: a live key each, prepaid wallets topped up by the platform.
  const partners = ok(await call('GET', '/admin/gds/partners', undefined, superH), 'partners')
    .items as { id: string; code: string }[];
  for (const p of partners.filter((x) => ['redbus-demo', 'abhibus'].includes(x.code))) {
    if (!h.otaKeys[p.code]) {
      const k = ok(
        await call('POST', `/admin/gds/partners/${p.id}/keys`, { label: 'Scale live key' }, superH),
        'issue key',
      );
      h.otaKeys[p.code] = { partnerId: p.id, key: (k.key ?? k.apiKey ?? k.secret) as string };
    }
    ok(
      await call(
        'POST',
        `/admin/gds/partners/${p.id}/receipts`,
        { amountMinor: 500_000_000, reference: `NEFT-${p.code}-OPENING` },
        superH,
        `scale-gds-open-${p.code}`,
      ),
      'gds top-up',
    );
  }
  saveHist(h);
  log(`OTA keys: ${Object.keys(h.otaKeys).join(', ')}`);

  // Every bus's crew; every conductor gets a crew-app login.
  await pool(ops, 8, async (o) => {
    if (h.crew[o.index]) return;
    const own = ownerOf(o);
    const list = ok(await own('GET', '/fleet/crew'), 'crew').items as {
      id: string;
      phone: string;
      role: string;
      employeeCode: string;
    }[];
    const byRoute: Record<number, Crew[]> = {};
    for (const c of list) {
      const m = /^E\d+-(\d+)-(\d+)$/.exec(c.employeeCode ?? '');
      if (!m) continue;
      (byRoute[Number(m[1])] ??= []).push({ id: c.id, phone: c.phone, role: c.role });
      if (c.role === 'conductor')
        ok(
          await own('PUT', `/fleet/crew/${c.id}/login`, { password: CREW_PASSWORD }),
          'conductor login',
        );
    }
    h.crew[o.index] = byRoute;
    const addOns = ok(await own('GET', '/me/ancillaries/catalogue'), 'add-ons').items as {
      id: string;
      active: boolean;
      perPassenger: boolean;
    }[];
    h.addOns[o.index] = addOns
      .filter((a) => a.active)
      .map((a) => ({ id: a.id, perPassenger: a.perPassenger }));
  });
  saveHist(h);
  log(`crew mapped for ${Object.keys(h.crew).length} operators`);

  // Customers who sign up (the rest of the traffic is guest checkout).
  const rnd = prng(77);
  const want = Array.from({ length: CUSTOMERS }, (_, n) => n).filter((n) => !h.customers[n]);
  const pending: { n: number; email: string; mobile: string; name: string }[] = [];
  await pool(want, 16, async (n) => {
    const female = rnd() < 0.45;
    const name = `${pick(rnd, female ? FIRST_F : FIRST_M)} ${pick(rnd, LAST)}`;
    const email = `cust${n}@scale.ticketly.test`;
    const mobile = `6${String(300000000 + n * 7).padStart(9, '0')}`;
    const r = await call('POST', '/auth/register', {
      fullName: name,
      email,
      mobile,
      password: CUSTOMER_PASSWORD,
    });
    if (r.status === 202) pending.push({ n, email, mobile, name });
    else if (r.status !== 409) log(`register ${email}: ${errText(r)}`);
  });
  // The sign-up codes: dev mail is logged (LOG_LEVEL=info), newest code per address wins.
  const logFile = process.env.API_LOG ?? join(process.cwd(), 'api.out');
  const codes = new Map<string, string>();
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.includes('Email (dev, not sent)') || !line.includes('@scale.ticketly.test')) continue;
    try {
      const j = JSON.parse(line) as { to?: string; preview?: string };
      const code = /\b(\d{6})\b/.exec(j.preview ?? '')?.[1];
      if (j.to && code) codes.set(j.to, code);
    } catch {
      /* not a JSON line */
    }
  }
  await pool(pending, 16, async (c) => {
    const code = codes.get(c.email);
    if (!code) return log(`no code for ${c.email}`);
    const r = await call('POST', '/auth/register/verify', { email: c.email, code });
    if (r.status === 200) h.customers[c.n] = { email: c.email, mobile: c.mobile, name: c.name };
    else log(`verify ${c.email}: ${errText(r)}`);
  });
  h.customers = h.customers.filter(Boolean);
  saveHist(h);
  log(`customers: ${h.customers.length}`);
}

/* ───────────── the timetable (read-only) ───────────── */

interface TripRow {
  id: string;
  tenant_id: string;
  service_id: string;
  journey_date: string;
  departs_at: Date;
  arrives_at: Date;
  status: string;
  vehicle_id: string | null;
}

async function tripsBetween(c: Client, from: string, to: string): Promise<TripRow[]> {
  const r = await c.query<TripRow>(
    `SELECT id, tenant_id, service_id, to_char(journey_date, 'YYYY-MM-DD') AS journey_date, departs_at, arrives_at, status::text, vehicle_id
       FROM trips WHERE journey_date BETWEEN $1::date AND $2::date AND tenant_id = ANY($3::uuid[])`,
    [from, to, opTenantIds()],
  );
  return r.rows;
}

let _state: ReturnType<typeof load> | undefined;
const state = () => (_state ??= load());
const opTenantIds = () => Object.values(state().operators).map((o) => o.tenantId);
const opByTenant = () => new Map(Object.values(state().operators).map((o) => [o.tenantId, o]));
const routeOfService = (o: OperatorState, serviceId: string) =>
  o.routes.findIndex((r) => r.serviceId === serviceId);

/* ───────────── demand: how full each trip gets, and when it sells ───────────── */

/** Share (%) of a trip's seats sold k days before it runs (k = 0 … 13). */
const SHARE = [22, 18, 13, 10, 8, 6, 5, 4, 3, 3, 2, 2, 2, 2];

function targetSeats(o: OperatorState, t: TripRow, cap: number): number {
  const r = prng(Number.parseInt(t.id.replace(/-/g, '').slice(-8), 16));
  const popularity = 0.25 + ((o.index * 37) % 50) / 100; // 0.25 … 0.74 by operator
  const dow = new Date(`${t.journey_date}T00:00:00Z`).getUTCDay();
  const weekend =
    dow === 5 || dow === 0 ? 1.25 : dow === 6 ? 1.1 : dow === 2 || dow === 3 ? 0.85 : 1;
  return Math.min(cap, Math.round(cap * popularity * weekend * (0.8 + r() * 0.4)));
}

/* ───────────── selling one booking ───────────── */

interface Avail {
  tripStatus: string;
  seats: {
    seatNumber: string;
    seatType: string;
    ladiesOnly: boolean;
    accessible: boolean;
    available: boolean;
  }[];
}

async function sellOne(
  h: Hist,
  o: OperatorState,
  route: number,
  t: TripRow,
  channel: Channel,
  size: number,
  day: string,
  rnd: () => number,
): Promise<BookingRec | null> {
  const r = o.routes[route];
  const tenantH = { 'x-tenant-id': o.tenantId };
  // Where from / to: mostly end to end, sometimes part of the way.
  let a = 0;
  let b = r.stops.length - 1;
  if (r.stops.length > 2 && rnd() < 0.35) {
    a = Math.floor(rnd() * (r.stops.length - 1));
    b = a + 1 + Math.floor(rnd() * (r.stops.length - 1 - a));
  }
  const from = r.stops[a].stopId;
  const to = r.stops[b].stopId;
  const avail = await call<Avail>(
    'GET',
    `/scheduling/trips/${t.id}/availability?from=${from}&to=${to}`,
    undefined,
    tenantH,
  );
  if (avail.status !== 200 || avail.body.tripStatus !== 'open') return null;
  const free = avail.body.seats.filter((s) => s.available && !s.accessible);
  if (free.length === 0) return null;
  // One kind of seat per booking (a quote prices one seat type).
  const types = [...new Set(free.map((s) => s.seatType))];
  const seatType = types.length > 1 && rnd() < 0.5 ? types[1] : types[0];
  const pool_ = free.filter((s) => s.seatType === seatType).sort(() => rnd() - 0.5);
  const n = Math.min(size, pool_.length, channel === 'ota' ? 6 : 10);
  const chosen = pool_.slice(0, n);
  const seats = chosen.map((s) => s.seatNumber);

  // Passengers: a ladies-only seat always gets a woman; some seniors and students.
  const hasStudent = o.index % 2 === 0;
  const passengers = chosen.map((s, k) => {
    const female = s.ladiesOnly || rnd() < 0.42;
    const roll = rnd();
    const senior = roll < 0.06;
    const student = !senior && hasStudent && roll < 0.1;
    const age = senior
      ? 60 + Math.floor(rnd() * 20)
      : student
        ? 18 + Math.floor(rnd() * 7)
        : 19 + Math.floor(rnd() * 40);
    return {
      seatNumber: s.seatNumber,
      fullName: `${pick(rnd, female ? FIRST_F : FIRST_M)} ${pick(rnd, LAST)}`,
      age: k > 0 && rnd() < 0.08 ? 8 + Math.floor(rnd() * 8) : age,
      gender: female ? ('female' as const) : ('male' as const),
      ...(channel !== 'agent' && channel !== 'ota' && (senior || student)
        ? {
            category: senior ? ('senior' as const) : ('student' as const),
            idProof: `ID${Math.floor(rnd() * 1e8)}`,
          }
        : {}),
    };
  });
  const customerN =
    channel === 'customer' && h.customers.length
      ? Math.floor(rnd() * h.customers.length)
      : undefined;
  const phone =
    customerN !== undefined
      ? h.customers[customerN].mobile
      : `9${String(Math.floor(rnd() * 1e9)).padStart(9, '0')}`;
  const key = `h-${day}-${t.id.slice(-12)}-${seats.join('.')}`;
  const rec: BookingRec = {
    id: '',
    pnr: '',
    op: o.index,
    route,
    tripId: t.id,
    journeyDate: t.journey_date,
    soldOn: day,
    channel,
    phone,
    seats,
    seatType,
    from,
    to,
    total: 0,
    fate: 'keep',
    names: passengers.map((p) => p.fullName),
  };

  // OTA partners go through the GDS API (their own block → confirm).
  if (channel === 'ota') {
    const partner =
      h.otaKeys[o.index % 10 < 7 ? 'redbus-demo' : 'abhibus'] ?? Object.values(h.otaKeys)[0];
    const g = { 'x-gds-key': partner.key };
    const block = await call(
      'POST',
      '/gds/bookings',
      {
        tripId: t.id,
        fromStopId: from,
        toStopId: to,
        seatNumbers: seats,
        passengers: passengers.map(({ category: _c, idProof: _i, ...p }) => p),
        contactPhone: phone,
      },
      g,
      `${key}-gds`,
    );
    if (block.status !== 201) return failed(h, 'ota-block', block);
    let conf = await call(
      'POST',
      `/gds/bookings/${block.body.bookingId ?? block.body.id}/confirm`,
      {},
      g,
      `${key}-gdsc`,
    );
    if (conf.status === 402) {
      const superH = await sessions.get('super', superLogin);
      await call(
        'POST',
        `/admin/gds/partners/${partner.partnerId}/receipts`,
        { amountMinor: 200_000_000, reference: `NEFT-${day}-${Math.floor(rnd() * 1e9)}` },
        superH,
        `topup-${key}`,
      );
      stat(h, 'ota-topup');
      conf = await call(
        'POST',
        `/gds/bookings/${block.body.bookingId ?? block.body.id}/confirm`,
        {},
        g,
        `${key}-gdsc2`,
      );
    }
    if (conf.status !== 200) return failed(h, 'ota-confirm', conf);
    rec.id = block.body.bookingId ?? block.body.id;
    rec.pnr = conf.body.pnr ?? block.body.pnr;
    rec.total = conf.body.totalMinor ?? block.body.totalMinor ?? 0;
    rec.ota = partner.partnerId;
    return rec;
  }

  // Everyone else prices the seats first; web customers sometimes use a coupon.
  const coupon =
    (channel === 'web' || channel === 'customer' || channel === 'app') && rnd() < 0.06
      ? rnd() < 0.6
        ? `OP${o.index}SAVE10`
        : `OP${o.index}FLAT50`
      : undefined;
  const quote = await call(
    'POST',
    '/pricing/quote',
    {
      tripId: t.id,
      fromStopId: from,
      toStopId: to,
      seatType,
      seatNumbers: seats,
      ...(coupon ? { couponCode: coupon } : {}),
    },
    tenantH,
  );
  if (quote.status !== 200) return failed(h, 'quote', quote);
  if (coupon) stat(h, 'coupon');

  if (channel === 'agent') {
    const k = rnd() < 0.55 ? 0 : 1;
    rec.agent = k;
    const ag = agentOf(o, k);
    const body = {
      quoteId: quote.body.quoteId,
      seatNumbers: seats,
      passengers: passengers.map(({ category: _c, idProof: _i, ...p }) => p),
      contactPhone: phone,
    };
    let res = await ag('POST', '/agent-portal/bookings', body, `${key}-ag`);
    if (res.status === 402) {
      // Out of balance / credit: the agent pays the operator, then sells again.
      const own = ownerOf(o);
      await own(
        'POST',
        `/agents/${o.agents[k].id}/receipts`,
        {
          amountMinor: 5_000_000,
          reference: `UTR${day.replace(/-/g, '')}${Math.floor(rnd() * 1e7)}`,
          note: 'Top-up',
        },
        `topup-${key}`,
      );
      stat(h, 'agent-topup');
      const q2 = await call(
        'POST',
        '/pricing/quote',
        { tripId: t.id, fromStopId: from, toStopId: to, seatType, seatNumbers: seats },
        tenantH,
      );
      if (q2.status !== 200) return failed(h, 'quote', q2);
      res = await ag(
        'POST',
        '/agent-portal/bookings',
        { ...body, quoteId: q2.body.quoteId },
        `${key}-ag2`,
      );
    }
    if (res.status !== 201) return failed(h, 'agent-book', res);
    rec.id = res.body.bookingId ?? res.body.id;
    rec.pnr = res.body.pnr;
    rec.total = res.body.totalMinor ?? quote.body.totalMinor;
    return rec;
  }

  // A phone booking is held until 4 hours before departure; too close to it, the caller buys at the counter.
  if (channel === 'phone' && t.departs_at.getTime() - 4 * 3_600_000 < now() + 60 * 60_000)
    channel = 'counter';
  if (channel === 'counter' || channel === 'phone') {
    const clerk = clerkOf(o);
    const body = {
      quoteId: quote.body.quoteId,
      seatNumbers: seats,
      passengers,
      contactPhone: phone,
    };
    const res =
      channel === 'phone'
        ? await clerk(
            'POST',
            '/bookings/phone',
            {
              ...body,
              releaseAt: new Date(
                Math.min(now() + 20 * 3_600_000, t.departs_at.getTime() - 4 * 3_600_000),
              ).toISOString(),
            },
            `${key}-ph`,
          )
        : await clerk('POST', '/bookings/hold', { ...body, channel: 'backoffice' }, `${key}-ct`);
    if (res.status !== 201) return failed(h, `${channel}-hold`, res);
    rec.id = res.body.bookingId;
    rec.pnr = res.body.pnr;
    rec.total = res.body.totalMinor;
    // A phone caller mostly pays at a branch; some never come (the hold lapses).
    if (channel === 'phone' && rnd() < 0.3) {
      stat(h, 'phone-lapsed');
      rec.fate = 'keep';
      return { ...rec, channel: 'phone', total: 0, seats: [] };
    }
    const conf = await clerk(
      'POST',
      `/bookings/${rec.id}/confirm`,
      { paidMinor: rec.total, paymentReference: `CASH-${rec.pnr}` },
      `${key}-cf`,
    );
    if (conf.status !== 200) return failed(h, `${channel}-confirm`, conf);
    return rec;
  }

  // Web / app / signed-in customer: hold, maybe add-ons, maybe a return journey, pay.
  const cust = customerN !== undefined ? customerOf(h, customerN, o.tenantId) : undefined;
  const hold = {
    quoteId: quote.body.quoteId,
    seatNumbers: seats,
    passengers,
    contactPhone: phone,
    contactEmail: customerN !== undefined ? h.customers[customerN].email : undefined,
    channel: channel === 'app' ? 'direct_app' : 'direct_web',
  };
  const held = cust
    ? await cust('POST', '/bookings/hold', hold, `${key}-hd`)
    : await call('POST', '/bookings/hold', hold, tenantH, `${key}-hd`);
  if (held.status !== 201) return failed(h, 'hold', held);
  rec.id = held.body.bookingId;
  rec.pnr = held.body.pnr;
  rec.customer = customerN;
  const addOns = h.addOns[o.index] ?? [];
  if (addOns.length && rnd() < 0.12) {
    const a = pick(rnd, addOns);
    const at = await call(
      'POST',
      '/me/ancillaries/attach',
      {
        bookingId: rec.id,
        items: [{ ancillaryId: a.id, quantity: a.perPassenger ? seats.length : 1 }],
      },
      tenantH,
      `${key}-ad`,
    );
    if (at.status === 200) stat(h, 'add-on');
  }
  // Payment: UPI, cards, net banking; a few declines (most retry, some walk away).
  const method = weighted(rnd, [
    ['upi', 55],
    ['credit_card', 14],
    ['debit_card', 16],
    ['net_banking', 15],
  ] as [string, number][]);
  const instrument = (ok_: boolean) =>
    method === 'upi'
      ? { method, vpa: ok_ ? 'success@ticketly' : 'failure@ticketly' }
      : method === 'net_banking'
        ? { method, bank: 'HDFC', username: 'ticketly', password: ok_ ? 'test1234' : 'wrong' }
        : {
            method,
            cardNumber: ok_ ? '4111111111111111' : '4000000000000002',
            expiry: '12/30',
            cvv: '123',
            holder: passengers[0].fullName,
          };
  const pay = (ok_: boolean, n: number) =>
    call(
      'POST',
      '/payments/charge',
      { bookingId: rec.id, ...instrument(ok_) },
      tenantH,
      `${key}-pay${n}`,
    );
  if (rnd() < 0.05) {
    const declined = await pay(false, 0);
    stat(h, declined.status === 402 ? 'payment-declined' : `payment-decline-${declined.status}`);
    if (rnd() < 0.35) {
      stat(h, 'abandoned');
      return { ...rec, total: 0, seats: [] };
    }
  }
  const paid = await pay(true, 1);
  if (paid.status !== 200) return failed(h, 'pay', paid);
  rec.total = paid.body.amountMinor ?? paid.body.totalMinor ?? held.body.totalMinor;
  return rec;
}

function failed(h: Hist, what: string, r: Res): null {
  stat(h, `fail:${what}:${r.status}`);
  if ((h.stats[`fail:${what}:${r.status}`] ?? 0) <= 3) log(`  ${what} → ${errText(r)}`);
  return null;
}

/** What happens to a booking later (decided when it is sold). */
function decideFate(rec: BookingRec, rnd: () => number): void {
  const lead = daysBetween(rec.soldOn, rec.journeyDate);
  const roll = rnd();
  const fate: Fate =
    roll < 0.065
      ? 'cancel'
      : roll < 0.085 && rec.seats.length > 1
        ? 'partial'
        : roll < 0.095
          ? 'reschedule'
          : roll < 0.105
            ? 'seats'
            : roll < 0.11
              ? 'name'
              : roll < 0.115
                ? 'points'
                : 'keep';
  rec.fate = fate;
  if (fate !== 'keep') rec.fateOn = addDays(rec.soldOn, lead > 0 ? Math.floor(rnd() * lead) : 0);
  if (rec.fateOn === rec.soldOn && fate !== 'keep' && lead > 0) rec.fateOn = addDays(rec.soldOn, 1);
}

/* ───────────── a day of sales ───────────── */

async function sales(day: string) {
  const h = loadHist();
  const c = await db();
  const ops = opByTenant();
  const rnd = prng(Number(day.replace(/-/g, '')));
  await assignDuties(h, day, c);
  saveHist(h);
  const trips = (await tripsBetween(c, day, addDays(day, SHARE.length - 1))).filter(
    (t) => t.status === 'open' && t.departs_at.getTime() > now() + 45 * 60_000,
  );
  // Seats already sold, so the day's share is on top of what exists.
  const plan: { t: TripRow; o: OperatorState; route: number; size: number; channel: Channel }[] =
    [];
  for (const t of trips) {
    const o = ops.get(t.tenant_id)!;
    const route = routeOfService(o, t.service_id);
    if (route < 0) continue;
    const cap = BUS_TYPES.find((b) => b.code === o.routes[route].busType)!.layout.seats.length;
    const k = daysBetween(day, t.journey_date);
    let seats = (targetSeats(o, t, cap) * SHARE[k]) / 100;
    seats = Math.floor(seats) + (rnd() < seats % 1 ? 1 : 0);
    while (seats > 0) {
      const size = Math.min(
        seats,
        weighted(rnd, [
          [1, 50],
          [2, 30],
          [3, 10],
          [4, 7],
          [5, 2],
          [6, 1],
        ] as [number, number][]),
      );
      seats -= size;
      const otaOk = o.index % 10 < 7 || o.index % 5 < 2;
      const channel = weighted(rnd, [
        ['web', 30],
        ['customer', 20],
        ['app', 8],
        ['counter', 14],
        ['phone', 3],
        ['agent', 12],
        [otaOk ? 'ota' : 'web', 13],
      ] as [Channel, number][]);
      plan.push({ t, o, route, size, channel });
    }
  }
  plan.sort(() => rnd() - 0.5);
  log(`${day} sales: ${trips.length} trips on sale, ${plan.length} bookings to try`);
  let done = 0;
  let seatsSold = 0;
  const t0 = Date.now();
  await pool(plan, CONC, async (p, i) => {
    const r = prng(Number(day.replace(/-/g, '')) * 1000 + i);
    try {
      const rec = await sellOne(h, p.o, p.route, p.t, p.channel, p.size, day, r);
      if (rec && rec.seats.length) {
        decideFate(rec, r);
        appendFileSync(BOOKINGS_FILE, `${JSON.stringify(rec)}\n`);
        stat(h, `sold:${rec.channel}`);
        stat(h, 'tickets', rec.seats.length);
        seatsSold += rec.seats.length;
      }
    } catch (e) {
      stat(h, 'error');
      if ((h.stats.error ?? 0) < 5) log(`  error: ${(e as Error).message}`);
    }
    if (++done % 2000 === 0)
      log(`  ${done}/${plan.length} (${(done / ((Date.now() - t0) / 1000)).toFixed(0)}/s)`);
  });
  log(`${day} sales done: ${seatsSold} seats in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await afterSales(h, day, c);
  if (!h.days.includes(`sales:${day}`)) h.days.push(`sales:${day}`);
  saveHist(h);
  await c.end();
}

/* ───────────── cancellations and changes due today ───────────── */

function readBookings(): BookingRec[] {
  if (!existsSync(BOOKINGS_FILE)) return [];
  return readFileSync(BOOKINGS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BookingRec);
}

async function afterSales(h: Hist, day: string, c: Client) {
  const all = readBookings();
  const due = all.filter((b) => b.fate !== 'keep' && b.fateOn === day && b.journeyDate >= day);
  const st = state();
  log(`${day} changes due: ${due.length}`);
  await pool(due, 24, async (b) => {
    const o = st.operators[`op${b.op}`];
    const tenantH = { 'x-tenant-id': o.tenantId };
    const key = `fate-${b.id}`;
    const rnd = prng(Number.parseInt(b.id.replace(/-/g, '').slice(-8), 16));
    let r: Res;
    switch (b.fate) {
      case 'cancel':
      case 'partial': {
        const seats =
          b.fate === 'partial' ? b.seats.slice(0, Math.max(1, b.seats.length - 1)) : undefined;
        if (b.channel === 'agent')
          r = await agentOf(o, b.agent ?? 0)(
            'POST',
            `/agent-portal/bookings/${b.id}/cancel`,
            { reason: 'Customer changed plans', ...(seats ? { seatNumbers: seats } : {}) },
            key,
          );
        else if (b.channel === 'ota')
          r = await call(
            'POST',
            `/gds/bookings/${b.id}/cancel`,
            { reason: 'Customer cancelled on the OTA', ...(seats ? { seatNumbers: seats } : {}) },
            { 'x-gds-key': Object.values(h.otaKeys).find((k) => k.partnerId === b.ota)!.key },
            key,
          );
        else if (b.channel === 'counter' || b.channel === 'phone')
          r = await managerOf(o)(
            'POST',
            `/bookings/${b.id}/${seats ? 'cancel-seats' : 'cancel'}`,
            { reason: 'Cancelled at the counter', ...(seats ? { seatNumbers: seats } : {}) },
            key,
          );
        else if (seats)
          r = await call(
            'POST',
            `/bookings/${b.id}/cancel-seats`,
            { seatNumbers: seats, mobile: b.phone, reason: 'One of us cannot travel' },
            tenantH,
            key,
          );
        else
          r = await call(
            'POST',
            `/bookings/${b.id}/self-cancel`,
            { mobile: b.phone, reason: 'Plans changed' },
            tenantH,
            key,
          );
        // This operator cancels whole bookings only: the customer cancels it all instead.
        if (seats && r.status === 422 && /whole bookings only/.test(errText(r))) {
          stat(h, 'refused:partial-policy');
          r =
            b.channel === 'counter' || b.channel === 'phone'
              ? await managerOf(o)(
                  'POST',
                  `/bookings/${b.id}/cancel`,
                  { reason: 'Cancelled at the counter' },
                  `${key}-all`,
                )
              : b.channel === 'agent'
                ? await agentOf(o, b.agent ?? 0)(
                    'POST',
                    `/agent-portal/bookings/${b.id}/cancel`,
                    { reason: 'Customer changed plans' },
                    `${key}-all`,
                  )
                : b.channel === 'ota'
                  ? await call(
                      'POST',
                      `/gds/bookings/${b.id}/cancel`,
                      { reason: 'Customer cancelled on the OTA' },
                      {
                        'x-gds-key': Object.values(h.otaKeys).find((k) => k.partnerId === b.ota)!
                          .key,
                      },
                      `${key}-all`,
                    )
                  : await call(
                      'POST',
                      `/bookings/${b.id}/self-cancel`,
                      { mobile: b.phone, reason: 'Plans changed' },
                      tenantH,
                      `${key}-all`,
                    );
        }
        break;
      }
      case 'reschedule': {
        // To the same bus a day or two later, same seats if free.
        const nt = await c.query<{ id: string }>(
          `SELECT t2.id FROM trips t1 JOIN trips t2 ON t2.service_id = t1.service_id AND t2.journey_date = t1.journey_date + $2::int
            WHERE t1.id = $1 AND t2.status = 'open'`,
          [b.tripId, 1 + Math.floor(rnd() * 2)],
        );
        if (!nt.rows[0]) return stat(h, 'reschedule-no-trip');
        const av = await call<Avail>(
          'GET',
          `/scheduling/trips/${nt.rows[0].id}/availability?from=${b.from}&to=${b.to}`,
          undefined,
          tenantH,
        );
        const free = (av.body.seats ?? [])
          .filter((s) => s.available && !s.accessible && !s.ladiesOnly && s.seatType === b.seatType)
          .map((s) => s.seatNumber);
        if (free.length < b.seats.length) return stat(h, 'reschedule-full');
        r = await call(
          'POST',
          `/bookings/${b.id}/reschedule`,
          {
            newTripId: nt.rows[0].id,
            newFromStopId: b.from,
            newToStopId: b.to,
            newSeatNumbers: free.slice(0, b.seats.length),
            mobile: b.phone,
          },
          tenantH,
          key,
        );
        if (r.status === 402 || (r.status === 200 && r.body.paymentRequired))
          stat(h, 'reschedule-pays-more');
        break;
      }
      case 'seats': {
        const av = await call<Avail>(
          'GET',
          `/scheduling/trips/${b.tripId}/availability?from=${b.from}&to=${b.to}`,
          undefined,
          tenantH,
        );
        const free = (av.body.seats ?? [])
          .filter((s) => s.available && !s.accessible && !s.ladiesOnly && s.seatType === b.seatType)
          .map((s) => s.seatNumber);
        if (!free.length) return stat(h, 'seats-full');
        const path =
          b.channel === 'agent'
            ? `/agent-portal/bookings/${b.id}/change-seats`
            : `/bookings/${b.id}/change-seats`;
        const body = { newSeatNumbers: [free[0], ...b.seats.slice(1)], mobile: b.phone };
        r =
          b.channel === 'agent'
            ? await agentOf(o, b.agent ?? 0)('POST', path, body, key)
            : await call('POST', path, body, tenantH, key);
        break;
      }
      case 'name': {
        if (!b.names?.[0]) return stat(h, 'name-unknown');
        // A spelling fix: one letter doubled ("Rahul Sharma" → "Rahul Sharrma").
        const n0 = b.names[0];
        const at = Math.max(1, n0.lastIndexOf(' ') + 3);
        const body = {
          seatNumber: b.seats[0],
          fullName: n0.slice(0, at) + n0[at - 1] + n0.slice(at),
          mobile: b.phone,
        };
        r =
          b.channel === 'agent'
            ? await agentOf(o, b.agent ?? 0)(
                'POST',
                `/agent-portal/bookings/${b.id}/correct-name`,
                body,
                key,
              )
            : await call('POST', `/bookings/${b.id}/correct-name`, body, tenantH, key);
        break;
      }
      case 'points': {
        const route = o.routes[b.route];
        const fromIdx = route.stops.findIndex((s) => s.stopId === b.from);
        const toIdx = route.stops.findIndex((s) => s.stopId === b.to);
        if (toIdx - fromIdx < 2) return stat(h, 'points-none');
        const body = {
          fromStopId: route.stops[fromIdx + 1].stopId,
          toStopId: b.to,
          mobile: b.phone,
        };
        r =
          b.channel === 'agent'
            ? await agentOf(o, b.agent ?? 0)(
                'POST',
                `/agent-portal/bookings/${b.id}/change-points`,
                body,
                key,
              )
            : await call('POST', `/bookings/${b.id}/change-points`, body, tenantH, key);
        break;
      }
      default:
        return;
    }
    if (r.status >= 200 && r.status < 300) stat(h, `fate:${b.fate}`);
    else if (
      r.status === 422 &&
      /fare is different|different person|cannot be rescheduled|too close|already departed|not allowed|policy/i.test(
        errText(r),
      )
    )
      stat(h, `refused:${b.fate}`);
    else failed(h, `fate-${b.fate}-${b.channel}`, r);
  });
}

/** The morning a trip runs: its drivers and conductor are put on duty for it. */
async function assignDuties(h: Hist, day: string, c: Client) {
  const opsMap = opByTenant();
  const trips = (await tripsBetween(c, day, day)).filter(
    (t) => t.status === 'open' && !h.duties?.[t.id],
  );
  h.duties ??= {};
  await pool(trips, 24, async (t) => {
    const o = opsMap.get(t.tenant_id)!;
    const route = routeOfService(o, t.service_id);
    const crew = h.crew[o.index]?.[route] ?? [];
    const conductor = crew.find((x) => x.role === 'conductor');
    if (!conductor) return stat(h, 'no-conductor');
    const own = ownerOf(o);
    const startsAt = new Date(t.departs_at.getTime() - 30 * 60_000).toISOString();
    const endsAt = new Date(t.arrives_at.getTime() + 15 * 60_000).toISOString();
    const duty = async (crewId: string, drivingMinutes: number, tag: string) => {
      const body = { crewId, tripId: t.id, startsAt, endsAt, drivingMinutes };
      let r = await own('POST', '/fleet/crew/duties', body, `duty-${t.id}-${tag}`);
      if (r.status === 422) {
        stat(h, 'duty-rule-override');
        r = await own(
          'POST',
          '/fleet/crew/duties',
          { ...body, overrideReason: 'Regular crew on this service; relief at the halfway stop' },
          `duty-${t.id}-${tag}-ov`,
        );
      }
      if (r.status !== 201 && r.status !== 200) failed(h, `duty-${tag}`, r);
      return r.body?.id as string | undefined;
    };
    const minutes = Math.round((t.arrives_at.getTime() - t.departs_at.getTime()) / 60_000);
    const drivers = crew.filter((x) => x.role === 'driver');
    for (const [k, d] of drivers.entries())
      await duty(d.id, Math.round(minutes / drivers.length), `d${k}`);
    const dutyId = await duty(conductor.id, 0, 'c');
    if (dutyId) h.duties![t.id] = dutyId;
  });
  log(`${day} duties: ${trips.length} trips crewed`);
}

/* ───────────── a day of operations ───────────── */

async function ops(day: string) {
  const h = loadHist();
  const c = await db();
  const opsMap = opByTenant();
  const rnd = prng(Number(day.replace(/-/g, '')) + 5);
  const today = await tripsBetween(c, addDays(day, -1), day);
  const departing = today.filter(
    (t) => t.journey_date === day && t.status === 'open' && t.departs_at.getTime() < now(),
  );
  const closing = today.filter(
    (t) =>
      (t.status === 'departed' || departing.some((d) => d.id === t.id)) &&
      t.arrives_at.getTime() < now(),
  );
  log(`${day} ops: ${departing.length} departing, ${closing.length} to close`);

  // A few buses break down two days out: the operator cancels the trip (everyone refunded in full).
  const soon = (await tripsBetween(c, addDays(day, 2), addDays(day, 2))).filter(
    (t) => t.status === 'open',
  );
  for (const t of soon.filter(() => rnd() < 0.0006).slice(0, 2)) {
    const o = opsMap.get(t.tenant_id)!;
    const r = await ownerOf(o)(
      'POST',
      `/bookings/trips/${t.id}/cancel`,
      { reason: 'Bus breakdown — service cancelled' },
      `tripcancel-${t.id}`,
    );
    if (r.status === 200) stat(h, 'trip-cancelled');
    else failed(h, 'trip-cancel', r);
  }

  await pool(departing, 24, async (t) => {
    const o = opsMap.get(t.tenant_id)!;
    const route = routeOfService(o, t.service_id);
    const crew = h.crew[o.index]?.[route] ?? [];
    const conductor = crew.find((x) => x.role === 'conductor');
    if (!conductor) return stat(h, 'no-conductor');
    const dutyId = h.duties?.[t.id];
    const cr = crewOf(o, conductor);
    const own = ownerOf(o);
    if (dutyId) await cr('POST', `/crew/me/duties/${dutyId}/attendance`, { status: 'present' });
    const dep = await cr('POST', `/crew/trips/${t.id}/status`, { status: 'departed' });
    if (dep.status >= 300) return failed(h, 'depart', dep);
    stat(h, 'departed');
    const manifest = await cr('GET', `/crew/trips/${t.id}/manifest`);
    const rows =
      ((manifest.body?.passengers ?? []) as { ticketId: string; ticketStatus: string }[]) ?? [];
    for (const m of rows) {
      if (!m.ticketId || m.ticketStatus !== 'valid') continue;
      if (rnd() < 0.045) {
        const ns = await own('POST', `/bookings/tickets/${m.ticketId}/no-show`, {});
        stat(h, ns.status === 200 ? 'no-show' : `no-show-${ns.status}`);
        continue;
      }
      const bd = await cr('POST', `/crew/trips/${t.id}/tickets/${m.ticketId}/board`, {});
      stat(h, bd.status === 200 ? 'boarded' : `board-${bd.status}`);
    }
    if (rnd() < 0.1)
      await cr('POST', `/crew/trips/${t.id}/ping`, {
        lat: 26.9 + rnd(),
        lng: 75.8 + rnd(),
        speedKmph: 60 + Math.floor(rnd() * 20),
      });
    if (rnd() < 0.003) {
      const inc = await cr('POST', `/crew/trips/${t.id}/incidents`, {
        type: 'breakdown',
        description: 'Tyre puncture near the toll plaza, changed in 40 minutes',
        delayMinutes: 40,
      });
      stat(h, inc.status < 300 ? 'incident' : `incident-${inc.status}`);
    }
    if (rnd() < 0.004) {
      const lf = await cr('POST', `/crew/trips/${t.id}/lost-found`, {
        description: 'Black backpack left on the rack',
        seatNumber: '1',
      });
      stat(h, lf.status < 300 ? 'lost-found' : `lost-found-${lf.status}`);
    }
  });

  await pool(closing, 24, async (t) => {
    const o = opsMap.get(t.tenant_id)!;
    const route = routeOfService(o, t.service_id);
    const conductor = (h.crew[o.index]?.[route] ?? []).find((x) => x.role === 'conductor');
    if (!conductor) return;
    const r = await crewOf(o, conductor)('POST', `/crew/trips/${t.id}/status`, {
      status: 'closed',
    });
    stat(h, r.status < 300 ? 'closed' : `close-${r.status}`);
  });

  await reviewsAndSupport(h, day, rnd);
  await agentsPayUp(h, day);
  if (!h.days.includes(`ops:${day}`)) h.days.push(`ops:${day}`);
  saveHist(h);
  await c.end();
}

/** Signed-in travellers review finished journeys; operators reply; a few open support tickets. */
async function reviewsAndSupport(h: Hist, day: string, rnd: () => number) {
  const st = state();
  const all = readBookings();
  const finished = all.filter(
    (b) => b.customer !== undefined && b.journeyDate === addDays(day, -1) && b.fate !== 'cancel',
  );
  const reviews = finished.filter(() => rnd() < 0.35);
  await pool(reviews, 16, async (b) => {
    const o = st.operators[`op${b.op}`];
    const r2 = prng(Number.parseInt(b.id.slice(-8), 16));
    const rating = weighted(r2, [
      [5, 45],
      [4, 30],
      [3, 12],
      [2, 7],
      [1, 6],
    ] as [number, number][]);
    const res = await customerOf(h, b.customer!, o.tenantId)(
      'POST',
      '/reviews',
      {
        bookingId: b.id,
        rating,
        title: rating >= 4 ? 'Comfortable journey' : rating === 3 ? 'Okay trip' : 'Not happy',
        body:
          rating >= 4
            ? 'On time, clean bus and polite staff.'
            : rating === 3
              ? 'Bus was fine but left 30 minutes late.'
              : 'AC was not working and the bus was very late.',
      },
      `review-${b.id}`,
    );
    if (res.status !== 201) return failed(h, 'review', res);
    stat(h, 'review');
    if (rating <= 3 || r2() < 0.2) {
      const rep = await ownerOf(o)('PUT', `/reviews/${res.body.id}/reply`, {
        body:
          rating <= 3
            ? 'We are sorry — we have spoken to the crew and checked the bus.'
            : 'Thank you for travelling with us!',
      });
      stat(h, rep.status === 200 ? 'review-reply' : `review-reply-${rep.status}`);
    }
  });
  const support = all
    .filter((b) => b.customer !== undefined && b.soldOn === day)
    .filter(() => rnd() < 0.01);
  await pool(support, 8, async (b) => {
    const o = st.operators[`op${b.op}`];
    const cust = customerOf(h, b.customer!, o.tenantId);
    const t = await cust('POST', '/support/tickets', {
      subject: 'Boarding point question',
      body: `Where exactly is the pickup for PNR ${b.pnr}?`,
      category: 'booking',
      bookingId: b.id,
    });
    if (t.status !== 201) return failed(h, 'support', t);
    stat(h, 'support');
    const own = ownerOf(o);
    const id = t.body.id ?? t.body.ticketId;
    await own('POST', `/support/tickets/${id}/messages`, {
      body: 'The bus leaves from the main bus stand, platform 3. The conductor will call you 30 minutes before.',
    });
    if (rnd() < 0.8) {
      const s = await own('POST', `/support/tickets/${id}/status`, { status: 'resolved' });
      stat(h, s.status === 200 ? 'support-resolved' : `support-status-${s.status}`);
    }
  });
}

/** Mondays: postpaid agents pay what they owe (a bank transfer the operator records). */
async function agentsPayUp(h: Hist, day: string) {
  if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) return;
  const st = state();
  await pool(Object.values(st.operators), 8, async (o) => {
    const own = ownerOf(o);
    const list = await own('GET', '/agents');
    for (const a of (list.body?.items ?? []) as {
      id: string;
      billingMode: string;
      balanceMinor: number;
    }[]) {
      if (a.billingMode !== 'postpaid' || !(a.balanceMinor < 0)) continue;
      const r = await own(
        'POST',
        `/agents/${a.id}/receipts`,
        {
          amountMinor: -a.balanceMinor,
          reference: `NEFT${day.replace(/-/g, '')}${a.id.slice(-6)}`,
          note: 'Weekly settlement',
        },
        `agentpay-${a.id}-${day}`,
      );
      stat(h, r.status === 200 ? 'agent-settled' : `agent-settle-${r.status}`);
    }
  });
}

/* ───────────── main ───────────── */

async function main() {
  const [cmd, day] = process.argv.slice(2);
  if (cmd === 'init') await init();
  else if (cmd === 'sales') await sales(day);
  else if (cmd === 'ops') await ops(day);
  else if (cmd === 'duties') {
    const h = loadHist();
    const c = await db();
    await assignDuties(h, day, c);
    saveHist(h);
    await c.end();
  } else if (cmd === 'stats') console.log(JSON.stringify(loadHist().stats, null, 1));
  else throw new Error('usage: history.ts init | sales <date> | ops <date> | stats');
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

export type { BookingRec, Seat };
