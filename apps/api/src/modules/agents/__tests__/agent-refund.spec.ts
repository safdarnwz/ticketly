import { describe, expect, it } from 'vitest';

import { AgentRefundService } from '../application/services/agent-refund.service';

/** In-memory AgentRepository: just the ledger lines, same semantics as the SQL. */
function fakeRepo(initial: { kind: string; amount: number }[]) {
  const lines = [...initial];
  const refs = new Set<string>();
  return {
    lines,
    agentForBooking: async () => 'agent-1',
    lockForUpdate: async () => ({}),
    saleFigures: async () => {
      const sum = (k: string[]) =>
        lines.filter((l) => k.includes(l.kind)).reduce((s, l) => s + l.amount, 0);
      return {
        saleMinor: -sum(['booking_debit']) - sum(['booking_reversal']),
        commissionMinor: sum(['commission_credit']),
        remainingCommissionMinor: Math.max(0, sum(['commission_credit', 'commission_reversal'])),
      };
    },
    post: async (p: { kind: string; magnitudeMinor: number; reference: string }) => {
      const key = `${p.kind}:${p.reference}`;
      if (refs.has(key)) return { applied: false, balanceAfterMinor: null };
      refs.add(key);
      const sign = ['booking_debit', 'commission_reversal'].includes(p.kind) ? -1 : 1;
      lines.push({ kind: p.kind, amount: sign * p.magnitudeMinor });
      return { applied: true, balanceAfterMinor: 0 };
    },
  };
}
const sale = () => [
  { kind: 'booking_debit', amount: -200000 },
  { kind: 'commission_credit', amount: 10000 },
]; // ₹2000 sale, ₹100 commission

describe('AgentRefundService.creditRefund', () => {
  it('two equal partial refunds claw back HALF the commission each (not less the second time)', async () => {
    const repo = fakeRepo(sale());
    const svc = new AgentRefundService(repo as never);
    await svc.creditRefund({ bookingId: 'b' as never, refundId: 'r1', refundMinor: 100000 });
    await svc.creditRefund({ bookingId: 'b' as never, refundId: 'r2', refundMinor: 100000 });
    const reversals = repo.lines
      .filter((l) => l.kind === 'commission_reversal')
      .map((l) => -l.amount);
    expect(reversals).toEqual([5000, 5000]);
  });
  it('a redelivered refund is credited once (idempotent per refund id)', async () => {
    const repo = fakeRepo(sale());
    const svc = new AgentRefundService(repo as never);
    await svc.creditRefund({ bookingId: 'b' as never, refundId: 'r1', refundMinor: 50000 });
    await svc.creditRefund({ bookingId: 'b' as never, refundId: 'r1', refundMinor: 50000 });
    expect(repo.lines.filter((l) => l.kind === 'refund_credit')).toHaveLength(1);
  });
  it('clawback never exceeds the commission still un-reversed', async () => {
    const repo = fakeRepo(sale());
    const svc = new AgentRefundService(repo as never);
    await svc.creditRefund({ bookingId: 'b' as never, refundId: 'r1', refundMinor: 200000 });
    await svc.creditRefund({ bookingId: 'b' as never, refundId: 'r2', refundMinor: 1000 });
    const total = repo.lines
      .filter((l) => l.kind === 'commission_reversal')
      .reduce((s, l) => s - l.amount, 0);
    expect(total).toBe(10000);
  });
  it('not an agent booking → false, nothing posted', async () => {
    const repo = { ...fakeRepo(sale()), agentForBooking: async () => null };
    expect(
      await new AgentRefundService(repo as never).creditRefund({
        bookingId: 'b' as never,
        refundId: 'r',
        refundMinor: 1,
      }),
    ).toBe(false);
  });
});
