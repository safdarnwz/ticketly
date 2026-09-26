import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageLoader, Table, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { agentPortalApi, type AgentBookingRow, type AgentLedgerRow } from '@/lib/api/agentPortal';
import { addDaysIso, cn, dayDiff, downloadCsv, formatDateTime, formatMoney, todayLocal } from '@/lib/utils';

const KIND: Record<string, string> = {
  deposit: 'Top-up', payment_received: 'Payment received', booking_debit: 'Ticket sold', commission_credit: 'Commission earned',
  booking_reversal: 'Sale reversed', refund_credit: 'Refund credited', commission_reversal: 'Commission taken back', adjustment: 'Adjustment',
};

/** The agent's money for a period: opening → sales, refunds, commission, payments → closing; every entry; pending commission. */
export function AgentStatementPage() {
  const today = todayLocal();
  const [from, setFrom] = useState(addDaysIso(today, -29));
  const [to, setTo] = useState(today);
  const bad = !from || !to ? 'Pick both dates' : from > to ? "'From' is after 'To'" : dayDiff(`${from}T00:00:00Z`, `${to}T00:00:00Z`) > 366 ? 'At most a year' : undefined;
  const st = useQuery({ queryKey: ['agent-statement', from, to], queryFn: () => agentPortalApi.statement(from, to), enabled: !bad });
  const ledger = useQuery({ queryKey: ['agent-ledger', from, to], queryFn: () => agentPortalApi.ledger(from, to), enabled: !bad });
  const upcoming = useQuery({ queryKey: ['agent-bookings', 'all'], queryFn: () => agentPortalApi.bookings() });
  // Commission on sales that have not travelled yet: a cancellation can still take it back.
  const pending = (upcoming.data?.items ?? []).filter((b) => b.status === 'confirmed' && Date.parse(b.departsAt) > Date.now());
  const pendingTotal = pending.reduce((s, b) => s + Number(b.commissionMinor), 0);
  const entries = ledger.data?.items ?? [];

  const exportCsv = () => {
    const s = st.data!;
    downloadCsv(`commission-statement-${from}-to-${to}.csv`, [
      [`Statement for ${s.agent.name} (${s.agent.code}) — ${from} to ${to}`], [],
      ['Opening balance', 'Tickets sold', 'Refunds', 'Commission', 'Payments received', 'Adjustments', 'Closing balance', 'Amount due'],
      [s.openingBalanceMinor / 100, s.salesMinor / 100, s.refundsMinor / 100, s.commissionMinor / 100, s.receivedMinor / 100, s.adjustmentsMinor / 100, s.closingBalanceMinor / 100, s.amountDueMinor / 100], [],
      ['Date', 'Entry', 'Amount (₹)', 'Balance after (₹)', 'Reference', 'Note'],
      ...entries.map((e) => [formatDateTime(e.createdAt), KIND[e.kind] ?? e.kind, (Number(e.amountMinor) / 100).toFixed(2), (Number(e.balanceAfterMinor) / 100).toFixed(2), e.reference ?? '', e.note ?? '']),
    ]);
  };
  const cols: Column<AgentLedgerRow>[] = [
    { key: 'when', header: 'When', render: (e) => formatDateTime(e.createdAt) },
    { key: 'kind', header: 'Entry', render: (e) => KIND[e.kind] ?? e.kind },
    { key: 'amt', header: 'Amount', render: (e) => <span className={cn(Number(e.amountMinor) < 0 ? 'text-danger' : 'text-success')}>{Number(e.amountMinor) < 0 ? '−' : '+'}{formatMoney(Math.abs(Number(e.amountMinor)))}</span> },
    { key: 'bal', header: 'Balance after', render: (e) => formatMoney(Number(e.balanceAfterMinor)) },
    { key: 'ref', header: 'Reference', render: (e) => <span className="text-xs text-text-muted">{e.pnr ? `PNR ${e.pnr}` : e.reference ?? e.note ?? ''}</span> },
  ];
  const pcols: Column<AgentBookingRow>[] = [
    { key: 'pnr', header: 'PNR', render: (b) => <span className="font-mono">{b.pnr}</span> },
    { key: 'trip', header: 'Journey', render: (b) => `${b.routeName} · ${formatDateTime(b.departsAt)}` },
    { key: 'c', header: 'Commission', render: (b) => formatMoney(Number(b.commissionMinor)) },
  ];
  return (
    <>
      <PageHeader title="Statement" subtitle="Your account for a period — sales, refunds, commission and payments" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} error={bad} />
        <Input label="To" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        <Button variant="outline" leftIcon={<Download className="h-4 w-4" />} disabled={!st.data || !ledger.data} onClick={exportCsv}>Download statement (CSV)</Button>
      </div>
      {bad ? null : st.isLoading ? <PageLoader /> : st.isError ? <ErrorState error={st.error} onRetry={st.refetch} /> : (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([['Opening balance', st.data!.openingBalanceMinor], ['Tickets sold', st.data!.salesMinor], ['Commission earned', st.data!.commissionMinor], ['Refunds credited', st.data!.refundsMinor],
            ['Payments / top-ups', st.data!.receivedMinor], ['Adjustments', st.data!.adjustmentsMinor], ['Closing balance', st.data!.closingBalanceMinor], ['Amount due', st.data!.amountDueMinor]] as const).map(([l, v]) => (
            <Card key={l}><CardBody><div className="text-xs text-text-muted">{l}</div><div className="text-lg font-semibold text-text">{formatMoney(Number(v))}</div></CardBody></Card>
          ))}
        </div>
      )}
      <Card className="mb-6">
        <CardHeader title="Commission still pending" subtitle={`${formatMoney(pendingTotal)} on ${pending.length} booking${pending.length === 1 ? '' : 's'} that have not travelled yet — a cancellation takes back its share`} />
        <CardBody>{upcoming.isLoading ? <PageLoader /> : upcoming.isError ? <ErrorState error={upcoming.error} onRetry={upcoming.refetch} /> : pending.length ? <Table columns={pcols} rows={pending} /> : <EmptyState title="Nothing pending" />}</CardBody>
      </Card>
      <Card>
        <CardHeader title="Entries" />
        <CardBody>{bad ? null : ledger.isLoading ? <PageLoader /> : ledger.isError ? <ErrorState error={ledger.error} onRetry={ledger.refetch} /> : entries.length ? <Table columns={cols} rows={entries} /> : <EmptyState title="No money moved in this period" />}</CardBody>
      </Card>
    </>
  );
}
