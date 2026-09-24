/**
 * ============================================================================
 *  Full demo-data generator
 * ============================================================================
 *
 * Boots the REAL NestJS application context (no HTTP server) and drives the
 * REAL services — BookingService, PaymentService, RefundService,
 * SchedulingService's TripRepository, SettlementService — for everything
 * that touches money or seat inventory. A raw-SQL approximation of 1000
 * bookings' worth of commission/GST/refund-clawback math is exactly the
 * kind of thing that quietly stops balancing; going through the real code
 * paths means every number in the ledger is as correct as a genuine booking
 * made through the API.
 *
 * What this does, in order:
 *   1. Materialises trips from 2026-09-01 through today for all 11 services
 *      (multi-operator.seed.sql's 10 operators + demo-operator.seed.sql's
 *      Demo Travels) — using TripRepository.insertTrip directly, since
 *      MaterializationService only ever looks forward from "today" and
 *      these need to start in the past.
 *   2. Creates 1000 customer users (cust1@test.com..cust1000@test.com,
 *      password pass@123), split evenly across the 11 tenants — a customer
 *      account in this codebase is tenant-scoped, same as staff.
 *   3. For each of ~1000 target bookings: picks a random trip+seats for
 *      that customer's tenant, holds, and charges via the test gateway.
 *      Then, per a fixed probability split, drives a SUBSET of bookings
 *      through: cancellation (refund settles immediately, since 'source'
 *      resolves to the same mock gateway that captured it), a seat
 *      upgrade, or a refund left deliberately mid-flight (a cancellation
 *      whose refund is 'initiated'/'processing', never reconciled) so
 *      NOT every number in the platform is a clean, finished state —
 *      which is the whole point of a realistic demo dataset.
 *   4. Runs SettlementService.generate()+finalise() for each tenant across
 *      a couple of weekly windows, producing real payout/settlement rows.
 *
 * This is a LONG-RUNNING, best-effort script — a single bad booking must
 * never abort the other 999, so every iteration is wrapped in its own
 * try/catch with a running tally printed at the end.
 *
 * Run AFTER: db:migrate, db:seed, db:seed:geography, multi-operator.seed.sql,
 * demo-operator.seed.sql, seed-operator-admins.ts, seed-demo-admin.ts.
 *   npm run generate:bookings
 */
import { NestFactory } from '@nestjs/core';
import { Pool, type PoolClient } from 'pg';

import { buildAppConfig, loadEnv } from '@config';
import { FieldEncryptor, PasswordHasher } from '@security';
import { runInNewContext, localDate, addDays, todayIn, type TenantId } from '@kernel';
import { UnitOfWork } from '@database';

import { AppModule } from '../apps/api/src/app.module';
import { ServiceRepository } from '../apps/api/src/modules/scheduling/infrastructure/persistence/service.repository';
import { TripRepository } from '../apps/api/src/modules/scheduling/infrastructure/persistence/trip.repository';
import { RouteRepository } from '../apps/api/src/modules/master-data/infrastructure/persistence/route.repository';
import { SeatLayoutRepository } from '../apps/api/src/modules/master-data/infrastructure/persistence/seat-layout.repository';
import { VehicleTypeRepository } from '../apps/api/src/modules/fleet/infrastructure/persistence/vehicle-type.repository';
import { PricingService } from '../apps/api/src/modules/pricing/application/services/pricing.service';
import { BookingService } from '../apps/api/src/modules/booking/application/services/booking.service';
import { PaymentService } from '../apps/api/src/modules/payment/application/services/payment.service';
import { RefundService } from '../apps/api/src/modules/refunds/application/services/refund.service';
import { SettlementService } from '../apps/api/src/modules/payment/application/services/settlement.service';
import { InvoiceService } from '../apps/api/src/modules/invoicing/application/services/invoice.service';
import { ConnectingSearchService } from '../apps/api/src/modules/connections/application/services/connecting-search.service';
import { ConnectingBookingService } from '../apps/api/src/modules/connections/application/services/connecting-booking.service';
import { AgentService } from '../apps/api/src/modules/agents/application/services/agent.service';
import { SeatQuotaService } from '../apps/api/src/modules/quotas/application/seat-quota.service';

const CUSTOMER_PASSWORD = 'pass@123';
const TOTAL_CUSTOMERS = 1000;
const TARGET_BOOKINGS = 1000;
const START_DATE = '2026-09-01';

function rand(n: number): number { return Math.floor(Math.random() * n); }
function pick<T>(arr: T[]): T { return arr[rand(arr.length)]; }

const REVIEW_TITLES: [number, string, string][] = [
  [5, 'Great journey!', 'Comfortable seats, driver was careful, reached on time.'],
  [5, 'Highly recommend', 'Clean bus, good AC, will book again.'],
  [4, 'Good overall', 'Slight delay but otherwise a smooth trip.'],
  [4, 'Decent service', 'Seat was fine, boarding point could be better marked.'],
  [3, 'Average experience', 'Bus was okay but a bit late at pickup.'],
  [2, 'Not great', 'AC wasn\u2019t working properly for most of the trip.'],
];

/** ~40% of successfully-completed bookings get a review — a real passenger base never reviews every single trip. */
async function maybeAddReview(client: PoolClient, tenantId: string, bookingId: string, customerId: string, routeId: string, tripId: string): Promise<void> {
  if (Math.random() >= 0.4) return;
  const [rating, title, body] = pick(REVIEW_TITLES);
  try {
    await client.query(
      `INSERT INTO reviews (id, tenant_id, booking_id, customer_id, route_id, trip_id, rating, title, body, verified, status)
       VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7, $8, true, 'published')
       ON CONFLICT (tenant_id, booking_id) DO NOTHING`,
      [tenantId, bookingId, customerId, routeId, tripId, rating, title, body],
    );
  } catch { /* best-effort — a review must never abort the booking flow */ }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const env = loadEnv();
  const config = buildAppConfig(env);
  const pool = new Pool({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, max: 4 });
  const client = await pool.connect();
  const encryptor = new FieldEncryptor(config);
  const hasher = new PasswordHasher(config);

  const services = app.get(ServiceRepository);
  const trips = app.get(TripRepository);
  const routes = app.get(RouteRepository);
  const layouts = app.get(SeatLayoutRepository);
  const vehicleTypes = app.get(VehicleTypeRepository);
  const pricing = app.get(PricingService);
  const bookings = app.get(BookingService);
  const payments = app.get(PaymentService);
  const refunds = app.get(RefundService);
  const settlement = app.get(SettlementService);
  const invoices = app.get(InvoiceService);
  const connectingSearch = app.get(ConnectingSearchService);
  const connectingBooking = app.get(ConnectingBookingService);
  const uow = app.get(UnitOfWork);

  const tz = 'Asia/Kolkata';
  const today = todayIn(tz);

  // ---- 1) Tenants -----------------------------------------------------
  const tenantRows = (await client.query<{ id: string; slug: string }>(`SELECT id, slug FROM tenants ORDER BY created_at`)).rows;
  process.stdout.write(`Found ${tenantRows.length} tenants.\n`);

  // ---- 2) Historical trip materialisation, per tenant ------------------
  for (const t of tenantRows) {
    await runInNewContext({ tenantId: t.id as TenantId, actorType: 'system' }, async () => {
      const svcRows = await services.listActive();
      for (const svc of svcRows) {
        const route = await routes.getById(svc.routeId);
        const vType = await vehicleTypes.getById(svc.vehicleTypeId);
        if (!vType.seatLayoutId) continue;
        const layout = await layouts.getById(vType.seatLayoutId);
        const seatInit = layout.seatMap.toJSON().seats.map((s: { number: string; type: string; bookable?: boolean; ladiesOnly?: boolean }) => ({
          seatNumber: s.number, seatType: s.type, isBookable: s.bookable !== false, ladiesOnly: s.ladiesOnly === true,
        }));

        let d = localDate(START_DATE);
        let created = 0;
        while (d <= today) {
          try {
            const originInstant = new Date(`${d}T00:00:00+05:30`);
            originInstant.setMinutes(originInstant.getMinutes() + svc.startMinute);
            const stopRows = route.path.stops.map((s) => {
              const departOffsetMin = s.departDayOffset * 1440 + s.departMinute;
              const arrivalOffsetMin = s.arrivalDayOffset * 1440 + s.arrivalMinute;
              return {
                sequence: s.sequence, stopId: s.stopId,
                arrivesAt: new Date(originInstant.getTime() + arrivalOffsetMin * 60_000),
                departsAt: new Date(originInstant.getTime() + departOffsetMin * 60_000),
                canBoard: s.canBoard, canAlight: s.canAlight,
              };
            });
            await uow.run({ name: 'demo.materialise', tenantId: t.id }, async () =>
              trips.insertTrip({
                serviceId: svc.id, routeId: svc.routeId, vehicleId: svc.defaultVehicleId ?? null, seatLayoutId: layout.id,
                journeyDate: d, departsAt: stopRows[0].departsAt, arrivesAt: stopRows[stopRows.length - 1].arrivesAt,
                stopCount: stopRows.length, stops: stopRows, seats: seatInit,
              }),
            );
            created += 1;
          } catch (e) {
            // A UNIQUE(service_id, journey_date) hit means this date was
            // already materialised on a previous run — expected on re-run,
            // not a real failure.
          }
          d = addDays(d, 1);
        }
        process.stdout.write(`  [${t.slug}] service ${svc.code}: ${created} trip-days materialised\n`);
      }
    });
  }

  // ---- 3) Customers -----------------------------------------------------
  process.stdout.write(`Creating ${TOTAL_CUSTOMERS} customers...\n`);
  const passwordHash = await hasher.hash(CUSTOMER_PASSWORD);
  const customerIdsByTenant = new Map<string, string[]>();
  for (let i = 1; i <= TOTAL_CUSTOMERS; i++) {
    const tenant = tenantRows[i % tenantRows.length];
    const email = `cust${i}@test.com`;
    const emailEnc = encryptor.encrypt(email);
    const emailBlind = encryptor.blindIndex(email);
    const phoneRaw = `9${(700000000 + i).toString().padStart(9, '0')}`;
    const phoneEnc = encryptor.encrypt(phoneRaw);
    const phoneBlind = encryptor.blindIndex(phoneRaw);
    try {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND email_blind = $2 AND deleted_at IS NULL LIMIT 1`, [tenant.id, emailBlind],
      );
      let userId: string;
      if (existing.rows[0]) {
        userId = existing.rows[0].id;
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (tenant_id, kind, status, email, email_blind, phone, phone_blind, full_name, password_hash)
           VALUES ($1, 'customer', 'active', $2, $3, $4, $5, $6, $7) RETURNING id`,
          [tenant.id, emailEnc, emailBlind, phoneEnc, phoneBlind, `Customer ${i}`, passwordHash],
        );
        userId = inserted.rows[0].id;
      }
      const arr = customerIdsByTenant.get(tenant.id) ?? [];
      arr.push(userId);
      customerIdsByTenant.set(tenant.id, arr);
    } catch (e) {
      process.stderr.write(`  ⚠ customer ${i} failed: ${(e as Error).message}\n`);
    }
    if (i % 500 === 0) process.stdout.write(`  ...${i}/${TOTAL_CUSTOMERS}\n`);
  }

  // ---- 4) Bookings --------------------------------------------------------
  const outcomes = { confirmed: 0, cancelledSettled: 0, cancelledPending: 0, upgraded: 0, failed: 0 };
  const perTenantTarget = Math.ceil(TARGET_BOOKINGS / tenantRows.length);

  for (const t of tenantRows) {
    const customerIds = customerIdsByTenant.get(t.id) ?? [];
    if (customerIds.length === 0) continue;

    await runInNewContext({ tenantId: t.id as TenantId, actorType: 'system' }, async () => {
      // Only trips that ALREADY have real seat inventory (materialised above).
      const tripRows = (await client.query<{ id: string; route_id: string; total_seats: number; departs_at: Date; arrives_at: Date }>(
        `SELECT id, route_id, total_seats, departs_at, arrives_at FROM trips WHERE tenant_id = $1 AND status = 'open' ORDER BY journey_date`, [t.id],
      )).rows;
      if (tripRows.length === 0) return;

      const tenantRow = (await client.query<{ gstin: string | null }>(`SELECT gstin FROM tenants WHERE id = $1`, [t.id])).rows[0];

      // ---- Crew duty assignment: which driver + conductor is on which trip ----
      // Round-robins through ACTIVE (not on_leave) crew. crew_duties has a
      // DB-level exclusion constraint against overlapping duties for the
      // SAME crew member — a long-haul route's trips genuinely CAN overlap
      // (a 5.5h Sleeper departing 21:30 overlaps a Seater departing 20:30),
      // so this tries a few different crew members before giving up on a
      // given trip; an unassigned trip is a realistic, non-blocking outcome
      // (real rosters do have unfilled slots), not a script bug.
      const drivers = (await client.query<{ id: string }>(`SELECT id FROM crew WHERE tenant_id = $1 AND role = 'driver' AND status = 'active'`, [t.id])).rows;
      const conductors = (await client.query<{ id: string }>(`SELECT id FROM crew WHERE tenant_id = $1 AND role = 'conductor' AND status = 'active'`, [t.id])).rows;
      let dutiesAssigned = 0;
      for (const trip of tripRows) {
        const durationMin = Math.round((trip.arrives_at.getTime() - trip.departs_at.getTime()) / 60000);
        // A single driver legally/practically can't run an entire long-haul
        // trip alone — real overnight services split the route into shifts
        // across 2-3 drivers. ~8h is a reasonable continuous-driving
        // threshold; a 5.5h Delhi-Jaipur hop needs just one, the 22h
        // Jaipur-Bangalore route needs three. Conductors get the SAME
        // shift-count — a trip long enough to need driver rotation needs
        // attendant rotation too, not one person awake the whole journey.
        const shiftsNeeded = durationMin > 16 * 60 ? 3 : durationMin > 8 * 60 ? 2 : 1;

        for (const pool of [drivers, conductors] as const) {
          if (pool.length === 0) continue;
          const usedThisTrip = new Set<string>();
          for (let shift = 0; shift < shiftsNeeded; shift++) {
            const shiftStart = new Date(trip.departs_at.getTime() + (durationMin * shift * 60_000) / shiftsNeeded);
            const shiftEnd = new Date(trip.departs_at.getTime() + (durationMin * (shift + 1) * 60_000) / shiftsNeeded);
            const shiftMinutes = Math.round((shiftEnd.getTime() - shiftStart.getTime()) / 60_000);

            for (let attempt = 0; attempt < Math.min(4, pool.length); attempt++) {
              const candidate = pool[(rand(pool.length) + attempt + shift) % pool.length];
              if (usedThisTrip.has(candidate.id)) continue; // one person can't cover two shifts of the SAME trip
              try {
                await client.query(
                  `INSERT INTO crew_duties (id, tenant_id, crew_id, trip_id, starts_at, ends_at, driving_minutes, status)
                   VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, 'assigned')`,
                  [t.id, candidate.id, trip.id, shiftStart, shiftEnd, shiftMinutes],
                );
                usedThisTrip.add(candidate.id);
                dutiesAssigned += 1;
                break; // this shift is filled — move to the next shift (or the other role)
              } catch {
                // overlap-constraint hit (this candidate is on ANOTHER
                // trip's duty right now) — try the next candidate
              }
            }
          }
        }
      }
      process.stdout.write(`  [${t.slug}] crew duties assigned: ${dutiesAssigned}\n`);

      const stopRows = (await client.query<{ stop_id: string; sequence: number }>(
        `SELECT rs.stop_id, rs.sequence FROM route_stops rs WHERE rs.tenant_id = $1 ORDER BY rs.sequence`, [t.id],
      )).rows;

      // ---- Ancillary services (insurance/meal/luggage) — once per tenant ----
      const ancillaryRows = (await client.query<{ id: string; price_minor: number }>(
        `INSERT INTO ancillary_services (id, tenant_id, code, name, kind, price_minor, per_passenger) VALUES
           (uuid_generate_v7(), $1, 'travel_insurance', 'Travel Insurance', 'insurance', 4900, true),
           (uuid_generate_v7(), $1, 'meal', 'Meal Voucher', 'meal', 15000, true),
           (uuid_generate_v7(), $1, 'extra_luggage', 'Extra Luggage', 'luggage', 20000, false)
         ON CONFLICT (tenant_id, code) DO NOTHING
         RETURNING id, price_minor`,
        [t.id],
      )).rows;

      // ---- Support tickets — a handful per tenant, not tied to any one booking ----
      const supportSubjects: [string, string, string][] = [
        ['Refund not received yet', 'refund', 'high'],
        ['Wrong boarding point on ticket', 'booking', 'normal'],
        ['Bus departed late', 'general', 'low'],
        ['Unable to complete payment', 'payment', 'high'],
      ];
      for (const [subject, category, priority] of supportSubjects) {
        const custId = pick(customerIds);
        const status = pick(['open', 'pending', 'resolved', 'closed']);
        await client.query(
          `INSERT INTO support_tickets (id, tenant_id, customer_id, subject, category, priority, status, resolved_at, closed_at)
           VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, CASE WHEN $6 IN ('resolved','closed') THEN now() - interval '1 day' ELSE NULL END,
                   CASE WHEN $6 = 'closed' THEN now() ELSE NULL END)`,
          [t.id, custId, subject, category, priority, status],
        );
      }

      // ---- DPDP consents — one row per customer for this tenant, marketing purpose ----
      for (const custId of customerIds) {
        await client.query(
          `INSERT INTO consents (id, tenant_id, customer_id, purpose, granted) VALUES (uuid_generate_v7(), $1, $2, 'marketing', $3)`,
          [t.id, custId, Math.random() < 0.6],
        );
      }

      for (let b = 0; b < perTenantTarget; b++) {
        const trip = pick(tripRows);
        const tripStops = stopRows; // single route per tenant in this seed — origin/dest are sequence 1/2
        const fromStop = tripStops.find((s) => s.sequence === 1);
        const toStop = tripStops.find((s) => s.sequence === tripStops.length);
        if (!fromStop || !toStop) continue;

        const customerId = pick(customerIds);
        const seatCount = rand(2) + 1; // 1 or 2 seats

        try {
          // Pick a seat-TYPE actually present on this trip first (a trip's
          // layout might be all-seater, all-sleeper, or all-semi-sleeper —
          // hardcoding 'seater' here would fetch the WRONG fare_rules row
          // for a sleeper/semi-sleeper trip, and could even fail outright
          // if that trip has no seater seats at all).
          const typeRow = await client.query<{ seat_type: string }>(
            `SELECT DISTINCT seat_type FROM trip_seats WHERE trip_id = $1 AND is_bookable = true`, [trip.id],
          );
          if (typeRow.rows.length === 0) continue;
          const seatType = pick(typeRow.rows).seat_type;

          const avail = await client.query<{ seat_number: string }>(
            `SELECT seat_number FROM trip_seats WHERE trip_id = $1 AND seat_type = $2 AND is_bookable = true AND occupied_legs = 0 AND blocked_legs = 0 LIMIT $3`,
            [trip.id, seatType, seatCount],
          );
          if (avail.rows.length < seatCount) continue;
          const seatNumbers = avail.rows.map((r) => r.seat_number);

          const quote = await pricing.quote({
            tripId: trip.id as never, fromStopId: fromStop.stop_id as never, toStopId: toStop.stop_id as never,
            seatType, seatNumbers,
          });

          const hold = await bookings.hold({
            quoteId: quote.quoteId, seatNumbers,
            passengers: seatNumbers.map((sn, idx) => ({ seatNumber: sn, fullName: `Customer ${b}-${idx}`, age: 25 + rand(40), gender: pick(['male', 'female']) })),
            contactPhone: `9${(700000000 + b).toString().padStart(9, '0')}`,
          });

          await payments.chargeTest(hold.bookingId, { method: 'upi', vpa: config.payment.test.upiSuccessVpa } as never);

          // GST tax invoice — normally raised by InvoiceConsumer listening
          // for booking.confirmed via the WORKER's outbox dispatcher, which
          // this script never boots (only the API context). Without this
          // explicit call, every single one of these bookings would have
          // NO invoice at all — the exact same class of gap as the crew
          // roster: a whole feature area silently empty because nothing
          // ever triggered it for seeded data.
          try {
            await invoices.issueForBooking(hold.bookingId, tenantRow?.gstin ?? undefined);
          } catch { /* best-effort — a missing invoice must never abort the booking itself */ }

          // Fraud assessment — every booking gets one (mirrors the real
          // FraudService running inline at checkout); a low score for
          // almost all, a genuine 'review'-band outlier now and then so
          // the Fraud console's queue isn't permanently empty either.
          const isOutlier = Math.random() < 0.03;
          await client.query(
            `INSERT INTO fraud_assessments (id, tenant_id, booking_id, customer_id, score, band, decision, reasons, signals)
             VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)`,
            [t.id, hold.bookingId, customerId, isOutlier ? 65 + rand(20) : rand(15),
             isOutlier ? 'medium' : 'low', isOutlier ? 'review' : 'allow',
             JSON.stringify(isOutlier ? ['velocity: 3 bookings in 10 minutes'] : [])],
          );

          // Ancillary — ~20% of bookings add travel insurance.
          if (ancillaryRows.length > 0 && Math.random() < 0.2) {
            const insurance = ancillaryRows[0];
            await client.query(
              `INSERT INTO booking_ancillaries (id, tenant_id, booking_id, ancillary_id, quantity, unit_price_minor, total_minor)
               VALUES (uuid_generate_v7(), $1, $2, $3, 1, $4, $4)`,
              [t.id, hold.bookingId, insurance.id, insurance.price_minor],
            );
          }

          const roll = Math.random();
          if (roll < 0.15) {
            // Cancel AND explicitly settle the refund now (calling
            // RefundService directly, not waiting on the worker's
            // outbox-driven RefundConsumer — this script only boots the API
            // context, not the worker, so nothing would ever consume that
            // event on its own). destination 'source' resolves synchronously
            // against the same mock gateway that captured the payment.
            const cancelled = await bookings.cancel(hold.bookingId, 'demo-data: customer cancelled');
            if (cancelled.refundMinor > 0) {
              await refunds.initiate({ bookingId: hold.bookingId, amountMinor: cancelled.refundMinor, destination: 'source' });
            }
            outcomes.cancelledSettled += 1;
          } else if (roll < 0.20) {
            // Cancel and deliberately stop there — no refund record at all.
            // This IS the realistic "still being worked on" state: the
            // booking.cancelled event sits in the outbox exactly as it would
            // in production before the worker gets to it; nothing here fakes
            // a 'processing' status, it's genuinely just not reconciled yet.
            await bookings.cancel(hold.bookingId, 'demo-data: pending refund');
            outcomes.cancelledPending += 1;
          } else if (roll < 0.25 && seatCount === 1) {
            // Seat upgrade — only meaningful with a single seat & a cutoff
            // that hasn't passed; best-effort, failure here just falls
            // through to "confirmed", which is a fine outcome too.
            try {
              const ticketRow = await client.query<{ id: string }>(`SELECT id FROM tickets WHERE booking_id = $1 LIMIT 1`, [hold.bookingId]);
              const altSeat = await client.query<{ seat_number: string }>(
                `SELECT seat_number FROM trip_seats WHERE trip_id = $1 AND is_bookable = true AND occupied_legs = 0 AND seat_number <> ANY($2) LIMIT 1`,
                [trip.id, seatNumbers],
              );
              if (ticketRow.rows[0] && altSeat.rows[0]) {
                await payments.upgradeSeat(ticketRow.rows[0].id, altSeat.rows[0].seat_number);
                outcomes.upgraded += 1;
                await maybeAddReview(client, t.id, hold.bookingId, customerId, trip.route_id, trip.id);
              } else {
                outcomes.confirmed += 1;
                await maybeAddReview(client, t.id, hold.bookingId, customerId, trip.route_id, trip.id);
              }
            } catch { outcomes.confirmed += 1; }
          } else {
            outcomes.confirmed += 1;
            await maybeAddReview(client, t.id, hold.bookingId, customerId, trip.route_id, trip.id);
          }
        } catch (e) {
          outcomes.failed += 1;
        }
      }

      // ---- Booking amendments — a few reschedule records on confirmed bookings ----
      const confirmedForAmend = (await client.query<{ id: string }>(
        `SELECT id FROM bookings WHERE tenant_id = $1 AND status = 'confirmed' ORDER BY random() LIMIT 5`, [t.id],
      )).rows;
      for (const b of confirmedForAmend) {
        try {
          await client.query(
            `INSERT INTO booking_amendments (id, tenant_id, booking_id, kind, detail, fee_minor, fare_diff_minor, amount_due_minor, refund_minor)
             VALUES (uuid_generate_v7(), $1, $2, 'reschedule', $3, 5000, 0, 5000, 0)`,
            [t.id, b.id, JSON.stringify({ reason: 'customer requested date change' })],
          );
        } catch { /* best-effort demo record */ }
      }

      // ---- Live-tracking snapshot — trips that have already "departed" (journey_date in the past) get a trip_live row + a few gps_pings, as if they were tracked in real time. Trips departing today/future stay 'not_started' (realistic — GPS only exists once a trip is actually running). ----
      const departedTrips = (await client.query<{ id: string; departs_at: Date; arrives_at: Date }>(
        `SELECT id, departs_at, arrives_at FROM trips WHERE tenant_id = $1 AND status = 'open' AND arrives_at < now() ORDER BY random() LIMIT 20`, [t.id],
      )).rows;
      for (const trip of departedTrips) {
        const totalMs = trip.arrives_at.getTime() - trip.departs_at.getTime();
        await client.query(
          `INSERT INTO trip_live (trip_id, tenant_id, lat, lng, speed_kmph, distance_covered_m, delay_minutes, status, last_ping_at)
           VALUES ($1, $2, $3, $4, 0, 280000, 0, 'completed', $5)
           ON CONFLICT (trip_id) DO NOTHING`,
          [trip.id, t.id, 26.9 + Math.random() * 2, 75.7 + Math.random() * 2, trip.arrives_at],
        );
        // A handful of pings along the route (not the whole journey — just enough for the map/replay UI to have real points to draw).
        for (let p = 0; p < 5; p++) {
          const pingTime = new Date(trip.departs_at.getTime() + (totalMs * p) / 5);
          await client.query(
            `INSERT INTO gps_pings (tenant_id, trip_id, lat, lng, speed_kmph, distance_covered_m, recorded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [t.id, trip.id, 26.9 + p * 0.3, 75.7 + p * 0.3, 55 + rand(20), Math.round((280000 * p) / 5), pingTime],
          );
        }
      }
    });
    process.stdout.write(`  [${t.slug}] bookings done — running totals: ${JSON.stringify(outcomes)}\n`);
  }

  // ---- 4.5) A few REAL connecting-journey bookings (Delhi -> Jaipur -> Bangalore -> Mysuru) ----
  // Without this, journey_connections stays completely empty after seeding
  // — the feature would exist in code with zero demonstrable data, exactly
  // the class of gap this whole seeding effort exists to avoid. Uses the
  // REAL ConnectingSearchService/ConnectingBookingService end to end (not
  // hand-crafted rows), so every ledger/invoice/ticket this produces is as
  // genuine as a real customer's connecting booking would be.
  try {
    const cityRows = (await client.query<{ id: string; name: string }>(`SELECT id, name FROM cities WHERE name IN ('Delhi','Jaipur','Bangalore','Mysuru')`)).rows;
    const cityId = (name: string) => cityRows.find((c) => c.name === name)?.id;
    const delhiId = cityId('Delhi'); const jaipurId = cityId('Jaipur'); const bangaloreId = cityId('Bangalore'); const mysuruId = cityId('Mysuru');

    const connectingRuns: [string | undefined, string | undefined, string][] = [
      [delhiId, bangaloreId, 'Delhi -> Jaipur -> Bangalore'],
      [jaipurId, mysuruId, 'Jaipur -> Bangalore -> Mysuru'],
    ];
    let connectingBooked = 0;
    for (const [fromCity, toCity, label] of connectingRuns) {
      if (!fromCity || !toCity) continue;
      for (let d = 0; d < 5; d++) {
        const day = localDate(new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10));
        const { options } = await connectingSearch.search(fromCity, toCity, day).then((options) => ({ options })).catch(() => ({ options: [] }));
        if (options.length === 0) continue;
        const opt = options[0];
        const custId = pick(Array.from(customerIdsByTenant.values()).flat());
        try {
          const q1 = await runInNewContext({ tenantId: opt.leg1.tenantId as TenantId, actorType: 'system' }, () =>
            pricing.quote({ tripId: opt.leg1.tripId as never, fromStopId: opt.leg1.fromStopId as never, toStopId: opt.leg1.toStopId as never, seatType: 'seater', seatNumbers: ['1'] }));
          const q2 = await runInNewContext({ tenantId: opt.leg2.tenantId as TenantId, actorType: 'system' }, () =>
            pricing.quote({ tripId: opt.leg2.tripId as never, fromStopId: opt.leg2.fromStopId as never, toStopId: opt.leg2.toStopId as never, seatType: 'seater', seatNumbers: ['1'] }));

          const held = await connectingBooking.holdConnection({
            leg1: { tenantId: opt.leg1.tenantId, quoteId: q1.quoteId, seatNumbers: ['1'], passengers: [{ seatNumber: '1', fullName: 'Connecting Passenger', age: 30, gender: 'male' }] },
            leg2: { tenantId: opt.leg2.tenantId, quoteId: q2.quoteId, seatNumbers: ['1'], passengers: [{ seatNumber: '1', fullName: 'Connecting Passenger', age: 30, gender: 'male' }] },
            contactPhone: '9800000001', customerId: custId,
          });
          await connectingBooking.confirmConnection(held.connectionId,
            { method: 'upi', vpa: config.payment.test.upiSuccessVpa }, { method: 'upi', vpa: config.payment.test.upiSuccessVpa });
          connectingBooked += 1;
        } catch { /* seat/timing collision on this day — try the next date */ }
        break; // one successful connecting booking per route-pair is enough demo data
      }
      void label;
    }
    process.stdout.write(`✓ Connecting-journey bookings created: ${connectingBooked}\n`);
  } catch (e) {
    process.stderr.write(`⚠ connecting-journey demo booking skipped: ${(e as Error).message}\n`);
  }

  // ---- 4b) B2B agents, commission slabs, quotas, phone bookings, expenses, waitlist ----
  // Driven through the REAL services (agent debits/credits, offline ledger,
  // quota bitmaps) so every figure matches what the API would produce. Runs
  // BEFORE settlements so agent commission is netted into operator payouts.
  const agentService = app.get(AgentService);
  const quotaService = app.get(SeatQuotaService);
  const b2b = { agents: 0, agentBookings: 0, agentCancels: 0, quotas: 0, phoneHolds: 0, expenses: 0, waitlist: 0, failed: 0 };
  for (const t of tenantRows) {
    const agentIds: { id: string; userId: string; mode: 'prepaid' | 'postpaid' }[] = [];
    await runInNewContext({ tenantId: t.id as TenantId, actorType: 'system' }, async () => {
      try {
        await agentService.setSlabs(null, [
          { minMonthlySalesMinor: 0, commissionPct: 5 },
          { minMonthlySalesMinor: 50_000_00, commissionPct: 6 },
          { minMonthlySalesMinor: 2_00_000_00, commissionPct: 7.5 },
        ]);
        const specs = [
          { key: 'prepaid', name: 'Shree Travels Agency', billingMode: 'prepaid' as const, activate: true },
          { key: 'postpaid', name: 'City Link Tours', billingMode: 'postpaid' as const, activate: true, creditLimitMinor: 50_000_00 },
          { key: 'pending', name: 'New Era Bookings', billingMode: 'prepaid' as const, activate: false },
          { key: 'suspended', name: 'Quick Ticket Point', billingMode: 'prepaid' as const, activate: true },
        ];
        for (const [i, sp] of specs.entries()) {
          const created = await agentService.create({
            name: sp.name, contactPhone: `98${String(i).padStart(2, '0')}${t.id.replace(/\D/g, '').slice(0, 6).padEnd(6, '0')}`,
            loginEmail: `agent${i + 1}@${t.slug}.example`, password: 'pass@123', billingMode: sp.billingMode, commissionPct: 5,
            creditLimitMinor: sp.creditLimitMinor, lowBalanceAlertMinor: 2_000_00, activate: sp.activate, city: 'Jaipur',
          });
          b2b.agents += 1;
          if (sp.key === 'prepaid') {
            await agentService.recordReceipt(created.agentId, { amountMinor: 25_000_00, reference: `SEED-DEP-${t.slug}` });
            agentIds.push({ id: created.agentId, userId: created.userId, mode: 'prepaid' });
          }
          if (sp.key === 'postpaid') {
            await agentService.recordReceipt(created.agentId, { amountMinor: 10_000_00, reference: `SEED-PAY-${t.slug}` });
            agentIds.push({ id: created.agentId, userId: created.userId, mode: 'postpaid' });
          }
          if (sp.key === 'suspended') await agentService.setStatus(created.agentId, 'suspended', 'Repeated late payments against statements');
        }
      } catch (e) {
        b2b.failed += 1;
        process.stderr.write(`  ⚠ [${t.slug}] agent setup: ${(e as Error).message}\n`);
      }
    });

    // Agent bookings — as the agent's own login (AgentService resolves "me" from the user).
    const tripsForAgents = (await client.query<{ id: string; route_id: string }>(
      `SELECT id, route_id FROM trips WHERE tenant_id = $1 AND status IN ('scheduled','open','departed','closed') ORDER BY random() LIMIT 10`, [t.id])).rows;
    for (const [i, trip] of tripsForAgents.entries()) {
      const ag = agentIds[i % Math.max(1, agentIds.length)];
      if (!ag) break;
      try {
        await runInNewContext({ tenantId: t.id as TenantId, userId: ag.userId as never, actorType: 'user' }, async () => {
          const stops = (await client.query<{ stop_id: string; sequence: number }>(`SELECT stop_id, sequence FROM route_stops WHERE route_id = $1 ORDER BY sequence`, [trip.route_id])).rows;
          const seat = (await client.query<{ seat_number: string; seat_type: string }>(
            `SELECT seat_number, seat_type FROM trip_seats WHERE trip_id = $1 AND is_bookable AND occupied_legs = 0 AND blocked_legs = 0 LIMIT 1`, [trip.id])).rows[0];
          if (!seat || stops.length < 2) return;
          const quote = await pricing.quote({ tripId: trip.id as never, fromStopId: stops[0].stop_id as never, toStopId: stops[stops.length - 1].stop_id as never, seatType: seat.seat_type, seatNumbers: [seat.seat_number] });
          const sold = await agentService.agentBook({
            quoteId: quote.quoteId, seatNumbers: [seat.seat_number],
            passengers: [{ seatNumber: seat.seat_number, fullName: `Agent Walk-in ${i}`, age: 30 + i, gender: i % 2 ? 'female' : 'male' }],
            contactPhone: `97${String(700000 + i).padStart(8, '0')}`,
          });
          b2b.agentBookings += 1;
          if (i === 3) { // one cancellation → refund credited back to the agent's account
            const c = await bookings.cancel(sold.bookingId as never, 'Passenger changed plans (agent)') as { refundMinor?: number };
            if (c?.refundMinor && c.refundMinor > 0) await refunds.initiate({ bookingId: sold.bookingId as never, amountMinor: c.refundMinor, destination: 'source' });
            b2b.agentCancels += 1;
          }
        });
      } catch (e) {
        b2b.failed += 1;
        process.stderr.write(`  ⚠ [${t.slug}] agent booking: ${(e as Error).message}\n`);
      }
    }

    await runInNewContext({ tenantId: t.id as TenantId, actorType: 'system' }, async () => {
      const future = (await client.query<{ id: string; route_id: string }>(
        `SELECT id, route_id FROM trips WHERE tenant_id = $1 AND status IN ('scheduled','open') AND departs_at > now() + interval '30 hours' ORDER BY departs_at LIMIT 4`, [t.id])).rows;
      // Seat quota for the prepaid agent on the first future trip.
      if (future[0] && agentIds[0]) {
        try {
          const seats = (await client.query<{ seat_number: string }>(
            `SELECT seat_number FROM trip_seats WHERE trip_id = $1 AND is_bookable AND occupied_legs = 0 AND blocked_legs = 0 ORDER BY seat_number DESC LIMIT 2`, [future[0].id])).rows.map((r) => r.seat_number);
          if (seats.length) { const r = await quotaService.allocate(future[0].id as never, { seatNumbers: seats, holderType: 'agent', holderId: agentIds[0].id, releaseMinutesBefore: 180 }); b2b.quotas += r.allocated; }
        } catch (e) { b2b.failed += 1; process.stderr.write(`  ⚠ [${t.slug}] quota: ${(e as Error).message}\n`); }
      }
      // Phone bookings: seats held for callers, released tomorrow if unpaid.
      for (const [i, trip] of future.slice(1, 4).entries()) {
        try {
          const stops = (await client.query<{ stop_id: string }>(`SELECT stop_id FROM route_stops WHERE route_id = $1 ORDER BY sequence`, [trip.route_id])).rows;
          const seat = (await client.query<{ seat_number: string; seat_type: string }>(
            `SELECT seat_number, seat_type FROM trip_seats WHERE trip_id = $1 AND is_bookable AND occupied_legs = 0 AND blocked_legs = 0 LIMIT 1`, [trip.id])).rows[0];
          if (!seat || stops.length < 2) continue;
          const quote = await pricing.quote({ tripId: trip.id as never, fromStopId: stops[0].stop_id as never, toStopId: stops[stops.length - 1].stop_id as never, seatType: seat.seat_type, seatNumbers: [seat.seat_number] });
          await bookings.hold({
            quoteId: quote.quoteId, seatNumbers: [seat.seat_number], channel: 'phone', contactPhone: `96${String(500000 + i).padStart(8, '0')}`,
            passengers: [{ seatNumber: seat.seat_number, fullName: `Phone Caller ${i + 1}`, age: 40, gender: 'male' }],
          }, { holdUntil: new Date(Date.now() + 20 * 3_600_000) });
          b2b.phoneHolds += 1;
        } catch (e) { b2b.failed += 1; process.stderr.write(`  ⚠ [${t.slug}] phone booking: ${(e as Error).message}\n`); }
      }
      // Waitlist demo rows (a real join needs a FULL trip, which random seed data rarely produces).
      if (future[1]) {
        const st = (await client.query<{ stop_id: string; sequence: number }>(`SELECT stop_id, sequence FROM route_stops WHERE route_id = $1 ORDER BY sequence`, [future[1].route_id])).rows;
        if (st.length >= 2) {
          for (const [i, status] of (['waiting', 'waiting', 'notified'] as const).entries()) {
            await client.query(
              `INSERT INTO trip_waitlist (id, tenant_id, trip_id, from_stop_id, to_stop_id, from_seq, to_seq, seat_count, contact_phone, status, notified_at)
               VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9 = 'notified' THEN now() END) ON CONFLICT DO NOTHING`,
              [t.id, future[1].id, st[0].stop_id, st[st.length - 1].stop_id, st[0].sequence, st[st.length - 1].sequence, 1 + i, `95${String(400000 + i).padStart(8, '0')}`, status]);
            b2b.waitlist += 1;
          }
        }
      }
    });

    // Trip expenses for departed trips (direct insert: seed history is older
    // than the 15-day entry window the API enforces for real users).
    const departed = (await client.query<{ id: string }>(
      `SELECT id FROM trips WHERE tenant_id = $1 AND departs_at < now() AND status <> 'cancelled' ORDER BY departs_at DESC LIMIT 40`, [t.id])).rows;
    for (const [i, trip] of departed.entries()) {
      const rows: [string, number, string | null][] = [
        ['diesel', 8_000_00 + rand(7_000_00), null], ['toll', 500_00 + rand(1_500_00), null], ['driver_bata', 800_00, null], ['cleaner_bata', 400_00, null],
      ];
      if (i % 5 === 0) rows.push(['repair', 1_200_00 + rand(3_000_00), 'Tyre puncture on the way']);
      for (const [category, amount, note] of rows) {
        await client.query(
          `INSERT INTO trip_expenses (id, tenant_id, trip_id, category, amount_minor, note, incurred_at) VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, now() - interval '1 day')`,
          [t.id, trip.id, category, amount, note]);
        b2b.expenses += 1;
      }
      if (i === 0) { // one corrected entry, kept with its void reason (audit trail)
        await client.query(
          `INSERT INTO trip_expenses (id, tenant_id, trip_id, category, amount_minor, note, voided_at, void_reason) VALUES (uuid_generate_v7(), $1, $2, 'diesel', 9900000, 'Typo', now(), 'Entered 99,000 instead of 9,900')`,
          [t.id, trip.id]);
      }
    }
  }
  process.stdout.write(`✓ B2B & operations data: ${JSON.stringify(b2b)}\n`);

  // ---- 5) Settlements (weekly windows, per tenant) -----------------------
  for (const t of tenantRows) {
    await runInNewContext({ tenantId: t.id as TenantId, actorType: 'system' }, async () => {
      const bank = (await client.query<{ bank_account_holder: string | null; bank_account_number: string | null; bank_ifsc: string | null }>(
        `SELECT bank_account_holder, bank_account_number, bank_ifsc FROM tenants WHERE id = $1`, [t.id],
      )).rows[0];

      let from = localDate(START_DATE);
      while (from < today) {
        const to = addDays(from, 6);
        try {
          const result = await settlement.generate(from, to <= today ? to : today);
          await settlement.finalise(result.settlementId);

          // Payout instruction — the actual bank-file-ready record for this
          // settlement. Snapshots the bank details AT THIS MOMENT (per the
          // table's own comment: never re-read from tenants later) — a
          // handful end up 'sent'/'confirmed' (money actually moved), most
          // stay 'pending' (a fresh settlement hasn't been paid out yet,
          // which is the realistic common case).
          if (bank?.bank_account_number) {
            const netRow = (await client.query<{ net_minor: string }>(
              `SELECT net_minor FROM settlements WHERE id = $1`, [result.settlementId],
            )).rows[0];
            const amount = netRow ? Number(netRow.net_minor) : 0;
            if (amount > 0) {
              const status = pick(['pending', 'pending', 'sent', 'confirmed']);
              await client.query(
                `INSERT INTO payout_instructions (id, tenant_id, settlement_id, amount_minor, beneficiary_name, bank_account_number, bank_ifsc, status, sent_at, confirmed_at)
                 VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, $7,
                         CASE WHEN $7 IN ('sent','confirmed') THEN now() - interval '2 days' ELSE NULL END,
                         CASE WHEN $7 = 'confirmed' THEN now() - interval '1 day' ELSE NULL END)`,
                [t.id, result.settlementId, amount, bank.bank_account_holder ?? 'Unknown', bank.bank_account_number, bank.bank_ifsc, status],
              );
            }
          }
        } catch { /* no captured revenue in this window — expected for some weeks */ }
        from = addDays(from, 7);
      }
    });
  }

  // ---- 6) Refresh reporting materialised views ---------------------------
  // These were created WITH NO DATA (migration 0010) — querying ANY of them
  // before a first refresh throws "materialized view has not been
  // populated", which is EXACTLY the error the Reports pages show right
  // now for freshly-seeded data. In production this runs on the worker's
  // schedule; this script never boots the worker, so it must trigger the
  // SAME function directly, once, after all the bookings above exist.
  try {
    await client.query('SELECT refresh_reporting_views()');
    process.stdout.write('✓ Reporting views refreshed (Reports pages will now show data)\n');
  } catch (e) {
    process.stderr.write(`⚠ refresh_reporting_views() failed: ${(e as Error).message}\n`);
  }

  process.stdout.write(`\n✓ Done. Outcomes: ${JSON.stringify(outcomes, null, 2)}\n`);
  client.release();
  await pool.end();
  await app.close();
}

void main();
