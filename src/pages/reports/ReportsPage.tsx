import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Download, BarChart3, XCircle, Clock } from 'lucide-react';

import { Button, Card, CardBody, Input, Table, type Column, PageLoader, ErrorState, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { reportsApi } from '@/lib/api/reports';
import { formatMoney, cn } from '@/lib/utils';

type Tab = 'revenue' | 'occupancy' | 'routes' | 'cancellations' | 'peak-hours';

function last30Days() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  const [{ from, to }, setRange] = useState(last30Days());

  return (
    <>
      <PageHeader title="Reports" subtitle="Revenue, occupancy, cancellations, and staffing insights" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <Input label="To" type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>

      <div className="mb-6 flex gap-2 border-b border-border">
        {([
          { key: 'revenue', label: 'Revenue', icon: TrendingUp },
          { key: 'occupancy', label: 'Occupancy', icon: BarChart3 },
          { key: 'routes', label: 'Route Performance', icon: BarChart3 },
          { key: 'cancellations', label: 'Cancellations', icon: XCircle },
          { key: 'peak-hours', label: 'Peak Hours', icon: Clock },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'revenue' && <RevenueTab from={from} to={to} />}
      {tab === 'occupancy' && <OccupancyTab from={from} to={to} />}
      {tab === 'routes' && <RoutesTab />}
      {tab === 'cancellations' && <CancellationsTab from={from} to={to} />}
      {tab === 'peak-hours' && <PeakHoursTab from={from} to={to} />}
    </>
  );
}

function RevenueTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-revenue', from, to], queryFn: () => reportsApi.revenue(from, to) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const columns: Column<{ date: string; bookings: number; grossMinor: number; cancelledMinor: number; seatsSold: number }>[] = [
    { key: 'date', header: 'Date', render: (r) => r.date },
    { key: 'bookings', header: 'Bookings', render: (r) => r.bookings },
    { key: 'gross', header: 'Gross', render: (r) => formatMoney(r.grossMinor, 'INR') },
    { key: 'cancelled', header: 'Cancelled', render: (r) => formatMoney(r.cancelledMinor, 'INR') },
    { key: 'seats', header: 'Seats sold', render: (r) => r.seatsSold },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Card><CardBody><div className="text-xs text-text-muted">Total gross</div><div className="text-xl font-semibold text-text">{formatMoney(q.data!.totals.grossMinor, 'INR')}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Total bookings</div><div className="text-xl font-semibold text-text">{q.data!.totals.bookings}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Seats sold</div><div className="text-xl font-semibold text-text">{q.data!.totals.seatsSold}</div></CardBody></Card>
      </div>
      <div className="mb-3 flex justify-end">
        <a href={reportsApi.revenueCsvUrl(from, to)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" leftIcon={<Download className="h-4 w-4" />}>Export CSV</Button></a>
      </div>
      {q.data!.series.length ? <Table columns={columns} rows={q.data!.series} /> : <EmptyState title="No data in this range" />}
    </>
  );
}

function OccupancyTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-occupancy', from, to], queryFn: () => reportsApi.occupancy(from, to) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const columns: Column<{ date: string; trips: number; totalSeats: number; soldSeats: number; occupancyPct: number; revenueMinor: number }>[] = [
    { key: 'date', header: 'Date' },
    { key: 'trips', header: 'Trips' },
    { key: 'sold', header: 'Seats sold', render: (r) => `${r.soldSeats} / ${r.totalSeats}` },
    { key: 'pct', header: 'Occupancy', render: (r) => `${r.occupancyPct}%` },
    { key: 'revenue', header: 'Revenue', render: (r) => formatMoney(r.revenueMinor, 'INR') },
  ];
  return q.data!.series.length ? <Table columns={columns} rows={q.data!.series} /> : <EmptyState title="No data in this range" />;
}

function RoutesTab() {
  const q = useQuery({ queryKey: ['report-routes'], queryFn: reportsApi.routePerformance });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const columns: Column<{ routeId: string; routeName: string; routeCode: string; trips: number; totalCapacity: number; seatsSold: number; occupancyPct: number; revenueMinor: number }>[] = [
    { key: 'route', header: 'Route', render: (r) => <span>{r.routeName} <span className="text-xs text-text-muted">({r.routeCode})</span></span> },
    { key: 'trips', header: 'Trips' },
    { key: 'sold', header: 'Seats sold', render: (r) => `${r.seatsSold} / ${r.totalCapacity}` },
    { key: 'pct', header: 'Occupancy', render: (r) => `${r.occupancyPct}%` },
    { key: 'revenue', header: 'Revenue', render: (r) => formatMoney(r.revenueMinor, 'INR') },
  ];
  return q.data!.routes.length ? <Table columns={columns} rows={q.data!.routes} /> : <EmptyState title="No route data yet" />;
}

function CancellationsTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-cancellations', from, to], queryFn: () => reportsApi.cancellations(from, to) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const columns: Column<{ date: string; cancelledCount: number; refundedMinor: number }>[] = [
    { key: 'date', header: 'Date' },
    { key: 'count', header: 'Cancelled', render: (r) => r.cancelledCount },
    { key: 'refunded', header: 'Refunded', render: (r) => formatMoney(r.refundedMinor, 'INR') },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Card><CardBody><div className="text-xs text-text-muted">Cancellation rate</div><div className="text-xl font-semibold text-text">{q.data!.cancellationRatePct}%</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Total cancelled</div><div className="text-xl font-semibold text-text">{q.data!.totalCancelled}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Total bookings</div><div className="text-xl font-semibold text-text">{q.data!.totalBookings}</div></CardBody></Card>
      </div>
      {q.data!.series.length ? <Table columns={columns} rows={q.data!.series} /> : <EmptyState title="No cancellations in this range" />}
    </>
  );
}

function PeakHoursTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-peak-hours', from, to], queryFn: () => reportsApi.peakHours(from, to) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const max = Math.max(1, ...q.data!.items.map((i) => i.bookingCount));
  return (
    <div className="flex flex-col gap-2">
      {q.data!.items.map((i) => (
        <div key={i.hour} className="flex items-center gap-3">
          <span className="w-14 text-right text-xs text-text-muted">{i.hour.toString().padStart(2, '0')}:00</span>
          <div className="h-6 flex-1 rounded bg-surface-muted">
            <div className="h-6 rounded bg-primary" style={{ width: `${(i.bookingCount / max) * 100}%` }} />
          </div>
          <span className="w-10 text-xs text-text-muted">{i.bookingCount}</span>
        </div>
      ))}
      {!q.data!.items.length && <EmptyState title="No data in this range" icon={<Clock className="h-10 w-10" />} />}
    </div>
  );
}
