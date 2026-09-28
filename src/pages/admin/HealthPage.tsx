import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, MessageSquare, Trophy } from 'lucide-react';

import { Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageLoader, Select, Table, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi, type MessageHealthRow, type PaymentHealthRow, type RankingRow } from '@/lib/api/platformAdmin';
import { formatMoney, todayLocal } from '@/lib/utils';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const tone = (v: number) => (v >= 0.98 ? 'text-success' : v >= 0.9 ? 'text-warning' : 'text-danger');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/**
 * How the platform is doing (#90, #91, #106, #111–#113): payment success per
 * gateway, SMS / WhatsApp / email delivery per provider, and operators ranked
 * by revenue, bookings, seats or cancellations — for a chosen period.
 */
export function HealthPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayLocal());
  const [sortBy, setSortBy] = useState('revenue');
  const bad = !from || !to || from > to;
  const payments = useQuery({ queryKey: ['health-payments', from, to], queryFn: () => platformAdminApi.paymentHealth(from, to), enabled: !bad });
  const messages = useQuery({ queryKey: ['health-messages', from, to], queryFn: () => platformAdminApi.messageHealth(from, to), enabled: !bad });
  const ranking = useQuery({ queryKey: ['health-ranking', from, to, sortBy], queryFn: () => platformAdminApi.ranking(from, to, sortBy), enabled: !bad });

  const payCols: Column<PaymentHealthRow>[] = [
    { key: 'g', header: 'Gateway', look: 'strong', render: (r) => <b>{r.gateway}</b> },
    { key: 'a', header: 'Attempts', look: 'count', render: (r) => r.attempts.toLocaleString('en-IN') },
    { key: 'c', header: 'Paid', look: 'count', render: (r) => r.captured.toLocaleString('en-IN') },
    { key: 'f', header: 'Failed', look: 'count', render: (r) => r.failed.toLocaleString('en-IN') },
    { key: 'x', header: 'Abandoned', look: 'count', under: 'f', render: (r) => r.abandoned.toLocaleString('en-IN') },
    { key: 's', header: 'Success', look: 'figure', render: (r) => <b className={tone(r.successRate)}>{pct(r.successRate)}</b> },
  ];
  const msgCols: Column<MessageHealthRow>[] = [
    { key: 'c', header: 'Channel', look: 'strong', render: (r) => <b>{r.channel}</b> },
    { key: 'p', header: 'Provider', under: 'c', render: (r) => r.provider },
    { key: 't', header: 'Sent', look: 'count', render: (r) => `${r.sent.toLocaleString('en-IN')} / ${r.total.toLocaleString('en-IN')}` },
    { key: 'f', header: 'Failed', look: 'count', render: (r) => r.failed.toLocaleString('en-IN') },
    { key: 'q', header: 'Waiting', look: 'count', under: 'f', render: (r) => r.pending.toLocaleString('en-IN') },
    { key: 's', header: 'Delivered', look: 'figure', render: (r) => <b className={tone(r.successRate)}>{pct(r.successRate)}</b> },
  ];
  const rankCols: Column<RankingRow>[] = [
    { key: 'r', header: '#', look: 'muted', render: (r) => r.rank },
    { key: 'n', header: 'Operator', look: 'strong', render: (r) => <b>{r.displayName}</b> },
    { key: 'rev', header: 'Revenue', look: 'figure', render: (r) => formatMoney(r.revenueMinor) },
    { key: 'b', header: 'Bookings', look: 'count', render: (r) => r.bookings.toLocaleString('en-IN') },
    { key: 's', header: 'Seats', look: 'count', under: 'b', render: (r) => r.seats.toLocaleString('en-IN') },
    { key: 'c', header: 'Cancelled', look: 'count', render: (r) => `${r.cancelled} (${pct(r.cancellationRate)})` },
  ];
  const totalPay = (payments.data?.items ?? []).reduce((a, r) => ({ attempts: a.attempts + r.attempts, captured: a.captured + r.captured }), { attempts: 0, captured: 0 });

  return (
    <>
      <PageHeader title="Platform health" subtitle="Payments, messages and operators over a period" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44"><Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-44"><Input label="To" type="date" value={to} min={from} error={bad ? 'After the start' : undefined} onChange={(e) => setTo(e.target.value)} /></div>
        {totalPay.attempts > 0 && <div className="pb-2 text-sm text-text-muted">Booking payment success: <b className={tone(totalPay.captured / totalPay.attempts)}>{pct(totalPay.captured / totalPay.attempts)}</b> · error rate {pct(1 - totalPay.captured / totalPay.attempts)}</div>}
      </div>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payments by gateway</span>} />
          <CardBody className="p-0">{payments.isLoading ? <PageLoader /> : payments.isError ? <ErrorState error={payments.error} onRetry={payments.refetch} /> : (payments.data?.items.length ?? 0) === 0 ? <EmptyState title="No payments in this period" /> : <Table columns={payCols} rows={payments.data!.items} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> SMS, WhatsApp and email</span>} />
          <CardBody className="p-0">{messages.isLoading ? <PageLoader /> : messages.isError ? <ErrorState error={messages.error} onRetry={messages.refetch} /> : (messages.data?.items.length ?? 0) === 0 ? <EmptyState title="No messages in this period" /> : <Table columns={msgCols} rows={messages.data!.items} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Trophy className="h-4 w-4" /> Operator ranking</span>}
            action={<div className="w-48"><Select aria-label="Rank by" value={sortBy} onChange={(e) => setSortBy(e.target.value)} options={[{ value: 'revenue', label: 'By revenue' }, { value: 'bookings', label: 'By bookings' }, { value: 'seats', label: 'By seats' }, { value: 'cancellationRate', label: 'By cancellation rate' }]} /></div>} />
          <CardBody className="p-0">{ranking.isLoading ? <PageLoader /> : ranking.isError ? <ErrorState error={ranking.error} onRetry={ranking.refetch} /> : (ranking.data?.items.length ?? 0) === 0 ? <EmptyState title="No bookings in this period" /> : <Table columns={rankCols} rows={ranking.data!.items} />}</CardBody>
        </Card>
      </div>
    </>
  );
}
