/**
 * ============================================================================
 *  Scale data set, part 3 — does every rupee add up?
 * ============================================================================
 *
 * Read-only checks over the whole database after the history run. Each check
 * counts the rows that break a money or inventory rule; zero is a pass. The
 * report is printed and written to scripts/scale/reconcile.json.
 *
 *   npx tsx scripts/scale/reconcile.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

interface Check {
  id: string;
  rule: string;
  sql: string;
}

const CHECKS: Check[] = [
  {
    id: 'seats.double-sold',
    rule: 'No seat is sold twice for the same stretch of the same trip',
    sql: `SELECT count(*) FROM booking_seats a JOIN booking_seats b
            ON a.trip_id = b.trip_id AND a.seat_number = b.seat_number AND a.booking_id < b.booking_id
           AND (a.leg_mask & b.leg_mask) <> 0
          JOIN bookings ba ON ba.id = a.booking_id AND ba.status IN ('confirmed','completed')
          JOIN bookings bb ON bb.id = b.booking_id AND bb.status IN ('confirmed','completed')`,
  },
  {
    id: 'booking.arithmetic',
    rule: 'base − discount + tax = total on every booking',
    sql: `SELECT count(*) FROM bookings WHERE base_minor - discount_minor + tax_minor <> total_minor`,
  },
  {
    id: 'booking.paid-in-full',
    rule: 'Every confirmed booking is paid its total',
    sql: `SELECT count(*) FROM bookings WHERE status IN ('confirmed','completed') AND paid_minor <> total_minor`,
  },
  {
    id: 'booking.online-captured',
    rule: 'An online booking is paid exactly what the gateway captured for it (fare, not later changes)',
    sql: `SELECT count(*) FROM bookings b
           WHERE b.status IN ('confirmed','completed','cancelled') AND b.channel IN ('direct_web','direct_app')
             AND b.paid_minor > 0
             AND b.paid_minor <> coalesce((SELECT sum(amount_minor) FROM payment_intents p
                                            WHERE p.booking_id = b.id AND p.status = 'captured'
                                              AND coalesce(p.metadata->>'kind','') NOT IN ('reschedule','seat_upgrade')), 0)`,
  },
  {
    id: 'payment.no-double-capture',
    rule: 'No booking was captured twice for its fare (a duplicate is recorded and refunded)',
    sql: `SELECT count(*) FROM (SELECT booking_id FROM payment_intents
                                WHERE status = 'captured' AND coalesce(metadata->>'kind','') NOT IN ('reschedule','seat_upgrade')
                                GROUP BY booking_id HAVING count(*) > 1) x`,
  },
  {
    id: 'refund.not-more-than-paid',
    rule: 'Refunds on a booking never exceed what was paid for it (fare + paid changes)',
    sql: `SELECT count(*) FROM (
            SELECT b.id, b.paid_minor
                   + coalesce((SELECT sum(amount_minor) FROM payment_intents p WHERE p.booking_id = b.id AND p.status = 'captured'
                                AND coalesce(p.metadata->>'kind','') IN ('reschedule','seat_upgrade')), 0) AS paid,
                   (SELECT coalesce(sum(amount_minor),0) FROM refunds r WHERE r.booking_id = b.id AND r.status NOT IN ('failed','cancelled')) AS refunded
              FROM bookings b) x WHERE refunded > paid`,
  },
  {
    id: 'refund.cancelled-unpaid-free',
    rule: 'A booking cancelled or expired before payment has no refund',
    sql: `SELECT count(*) FROM bookings b WHERE b.paid_minor = 0 AND EXISTS (SELECT 1 FROM refunds r WHERE r.booking_id = b.id)`,
  },
  {
    id: 'tickets.match-seats',
    rule: 'A confirmed booking has one live ticket per seat; a cancelled one has none',
    sql: `SELECT count(*) FROM bookings b
           WHERE (b.status IN ('confirmed','completed')
                  AND (SELECT count(*) FROM tickets t WHERE t.booking_id = b.id AND t.status <> 'cancelled') <> b.seat_count)
              OR (b.status = 'cancelled'
                  AND EXISTS (SELECT 1 FROM tickets t WHERE t.booking_id = b.id AND t.status IN ('valid','boarded')))`,
  },
  {
    id: 'inventory.no-orphan-occupancy',
    rule: 'Seats held by expired or cancelled bookings are free again',
    sql: `SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
           WHERE (b.status = 'held' AND b.hold_expires_at < now() - interval '10 minutes')`,
  },
  {
    id: 'ledger.balanced',
    rule: 'Every ledger entry balances (debits = credits)',
    sql: `SELECT count(*) FROM (SELECT entry_id FROM ledger_postings GROUP BY entry_id HAVING sum(amount_minor) <> 0) x`,
  },
  {
    id: 'ledger.every-capture-posted',
    rule: 'Every captured payment and every counter / agent / OTA sale is in the ledger once',
    sql: `SELECT count(*) FROM bookings b
           WHERE b.status IN ('confirmed','completed','cancelled') AND b.paid_minor > 0
             AND (SELECT count(*) FROM ledger_entries e
                   WHERE e.source_id = b.id::text AND e.entry_type IN ('booking.captured','booking.captured_offline')) <> 1`,
  },
  {
    id: 'agent.wallet-chain',
    rule: "An agent's running balance is the sum of its ledger (no step skipped or doubled)",
    sql: `SELECT count(*) FROM (
            SELECT agent_id, balance_after_minor,
                   sum(amount_minor) OVER (PARTITION BY agent_id ORDER BY created_at, id) AS running
              FROM agent_ledger) x WHERE balance_after_minor <> running`,
  },
  {
    id: 'gds.wallet-chain',
    rule: "An OTA partner's running balance is the sum of its ledger",
    sql: `SELECT count(*) FROM (
            SELECT partner_id, balance_after_minor,
                   sum(amount_minor) OVER (PARTITION BY partner_id ORDER BY created_at, id) AS running
              FROM gds_partner_ledger) x WHERE balance_after_minor <> running`,
  },
  {
    id: 'agent.sale-debited-once',
    rule: 'Every agent sale is debited from the agent once',
    sql: `SELECT count(*) FROM bookings b WHERE b.agent_id IS NOT NULL AND b.status IN ('confirmed','completed','cancelled')
             AND (SELECT count(*) FROM agent_ledger l WHERE l.booking_id = b.id AND l.kind = 'booking_debit') <> 1`,
  },
  {
    id: 'gds.sale-debited-once',
    rule: 'Every OTA sale is debited from the partner once',
    sql: `SELECT count(*) FROM bookings b WHERE b.gds_partner_id IS NOT NULL AND b.status IN ('confirmed','completed','cancelled')
             AND (SELECT count(*) FROM gds_partner_ledger l WHERE l.booking_id = b.id AND l.kind = 'booking_debit') <> 1`,
  },
  {
    id: 'invoice.every-sale',
    rule: 'Every paid booking has exactly one GST tax invoice',
    sql: `SELECT count(*) FROM bookings b WHERE b.paid_minor > 0 AND b.status IN ('confirmed','completed','cancelled')
             AND (SELECT count(*) FROM invoices i WHERE i.booking_id = b.id AND i.kind = 'tax') <> 1`,
  },
  {
    id: 'invoice.arithmetic',
    rule: 'Invoice taxable + tax + round-off = total',
    sql: `SELECT count(*) FROM invoices WHERE taxable_minor + tax_total_minor + round_off_minor <> total_minor`,
  },
  {
    id: 'invoice.numbers-unique',
    rule: 'No invoice number is used twice',
    sql: `SELECT count(*) FROM (SELECT tenant_id, invoice_number FROM invoices GROUP BY 1, 2 HAVING count(*) > 1) x`,
  },
  {
    id: 'settlement.arithmetic',
    rule: 'Settlement gross − commission − refunds = net',
    sql: `SELECT count(*) FROM settlements WHERE gross_minor - commission_minor - refunds_minor <> net_minor`,
  },
  {
    id: 'payout.matches-settlement',
    rule: 'A payout pays exactly its settlement net, once',
    sql: `SELECT count(*) FROM settlements s
           WHERE s.net_minor > 0 AND (SELECT coalesce(sum(amount_minor), 0) FROM payout_instructions p
                                       WHERE p.settlement_id = s.id AND p.status <> 'failed') NOT IN (0, s.net_minor)`,
  },
  {
    id: 'platform-invoice.arithmetic',
    rule: 'Platform invoice subtotal − discount + GST = total',
    sql: `SELECT count(*) FROM platform_invoices WHERE subtotal_minor - discount_minor + gst_minor <> total_minor`,
  },
];

const SUMMARY = `
SELECT
  (SELECT count(*) FROM tenants t WHERE EXISTS (SELECT 1 FROM vehicles v WHERE v.tenant_id = t.id)) AS operators,
  (SELECT count(*) FROM vehicles WHERE verification_status = 'approved') AS buses,
  (SELECT count(*) FROM trips) AS trips,
  (SELECT count(*) FROM bookings) AS bookings,
  (SELECT count(*) FROM tickets) AS tickets,
  (SELECT count(*) FROM tickets WHERE status = 'boarded') AS boarded,
  (SELECT count(*) FROM tickets WHERE status = 'no_show') AS no_shows,
  (SELECT count(*) FROM bookings WHERE status = 'cancelled') AS cancelled,
  (SELECT sum(paid_minor) FROM bookings WHERE status IN ('confirmed','completed','cancelled')) AS collected_minor,
  (SELECT sum(amount_minor) FROM refunds WHERE status NOT IN ('failed','cancelled')) AS refunded_minor,
  (SELECT count(*) FROM invoices) AS invoices,
  (SELECT count(*) FROM settlements) AS settlements,
  (SELECT count(*) FROM platform_invoices) AS platform_invoices`;

async function main() {
  const c = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();
  const summary = (await c.query(SUMMARY)).rows[0] as Record<string, string>;
  const results: { id: string; rule: string; broken: number | string }[] = [];
  for (const k of CHECKS) {
    try {
      const r = await c.query<{ count: string }>(k.sql);
      results.push({ id: k.id, rule: k.rule, broken: Number(r.rows[0].count) });
    } catch (e) {
      results.push({ id: k.id, rule: k.rule, broken: `error: ${(e as Error).message}` });
    }
  }
  await c.end();
  const report = { at: new Date().toISOString(), summary, results };
  writeFileSync(join(__dirname, 'reconcile.json'), JSON.stringify(report, null, 1));
  console.log(summary);
  for (const r of results)
    console.log(`${r.broken === 0 ? 'PASS' : 'FAIL'}  ${r.id.padEnd(30)} ${r.broken}  ${r.rule}`);
}

void main();
