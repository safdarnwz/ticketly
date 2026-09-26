import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { TrendingUp, Download, BarChart3, XCircle, Clock, IndianRupee, Timer, LineChart, BookOpen } from 'lucide-react';

import { Button, Card, CardBody, Input, Table, type Column, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { authApi } from '@/lib/api/auth';
import { reportsApi } from '@/lib/api/reports';
import { DispatchTab, ForecastTab, PnlTab } from './ReportsExtras';
import { LedgerTab } from './LedgerTab';
import { addDaysIso, cn, dayDiff, formatDateLabel, formatMoney, todayLocal } from '@/lib/utils';

type Tab = 'revenue' | 'occupancy' | 'routes' | 'cancellations' | 'peak-hours' | 'pnl' | 'dispatch' | 'forecast' | 'ledger';

/** The operator's own calendar days, not UTC. */
function lastDays(n: number) {
  const to = todayLocal();
  return { from: addDaysIso(to, -(n - 1)), to };
}
const PRESETS = [
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];
const day = (d: string) => formatDateLabel(d, { weekday: 'short', day: '2-digit', month: 'short' });

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue');
  // The ledger is for whoever handles settlements; the API refuses everyone else anyway.
  const me = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me, staleTime: 60_000 });
  const held = new Set(me.data?.permissions ?? []);
  const canLedger = held.has('*') || held.has('settlement:manage');
  const [{ from, to }, setRange] = useState(lastDays(30));
  const rangeError = !from || !to ? 'Pick both dates' : from > to ? "'From' is after 'To'" : dayDiff(`${from}T00:00:00Z`, `${to}T00:00:00Z`) > 366 ? 'Pick at most a year' : undefined;

  return (
    <>
      <PageHeader title="Reports" subtitle="Revenue, occupancy, cancellations, and staffing insights" />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={from} max={to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} error={rangeError} />
        <Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        <div className="flex gap-1">
          {PRESETS.map((p) => {
            const r = lastDays(p.days);
            return <Button key={p.label} size="sm" variant={r.from === from && r.to === to ? 'primary' : 'outline'} onClick={() => setRange(r)}>{p.label}</Button>;
          })}
        </div>
        <span className="ml-auto text-xs text-text-muted">Figures refresh every few minutes</span>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-border">
        {([
          { key: 'revenue', label: 'Revenue', icon: TrendingUp },
          { key: 'occupancy', label: 'Occupancy', icon: BarChart3 },
          { key: 'routes', label: 'Route Performance', icon: BarChart3 },
          { key: 'cancellations', label: 'Cancellations', icon: XCircle },
          { key: 'peak-hours', label: 'Peak Hours', icon: Clock },
          { key: 'pnl', label: 'Profit & Loss', icon: IndianRupee },
          { key: 'dispatch', label: 'Dispatch', icon: Timer },
          { key: 'forecast', label: 'Forecast', icon: LineChart },
          ...(canLedger ? [{ key: 'ledger', label: 'Ledger', icon: BookOpen }] as const : []),
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {rangeError && tab !== 'routes' && tab !== 'forecast' ? <EmptyState title="Pick a valid period" description={rangeError} /> : (
        <>
          {tab === 'revenue' && <RevenueTab from={from} to={to} />}
          {tab === 'occupancy' && <OccupancyTab from={from} to={to} />}
          {tab === 'routes' && <RoutesTab />}
          {tab === 'cancellations' && <CancellationsTab from={from} to={to} />}
          {tab === 'peak-hours' && <PeakHoursTab from={from} to={to} />}
          {tab === 'pnl' && <PnlTab from={from} to={to} />}
          {tab === 'dispatch' && <DispatchTab from={from} to={to} />}
          {tab === 'forecast' && <ForecastTab />}
          {tab === 'ledger' && canLedger && <LedgerTab from={from} to={to} />}
        </>
      )}
    </>
  );
}

function RevenueTab({ from, to }: { from: string; to: string }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['report-revenue', from, to], queryFn: () => reportsApi.revenue(from, to), placeholderData: keepPreviousData });
  const csv = useMutation({ mutationFn: () => reportsApi.downloadRevenueCsv(from, to), onError: (e) => toast.error(e instanceof Error ? e.message : 'Download failed') });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const columns: Column<{ date: string; bookings: number; grossMinor: number; cancelledMinor: number; seatsSold: number }>[] = [
    { key: 'date', header: 'Day', render: (r) => day(r.date) },
    { key: 'bookings', header: 'Bookings sold', render: (r) => r.bookings },
    { key: 'gross', header: 'Sales', render: (r) => formatMoney(r.grossMinor, 'INR') },
    { key: 'cancelled', header: 'Later cancelled', render: (r) => formatMoney(r.cancelledMinor, 'INR') },
    { key: 'seats', header: 'Seats sold', render: (r) => r.seatsSold },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Card><CardBody><div className="text-xs text-text-muted">Sales (still booked)</div><div className="text-xl font-semibold text-text">{formatMoney(q.data!.totals.grossMinor, 'INR')}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Sold in the period</div><div className="text-xl font-semibold text-text">{q.data!.totals.bookings}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Seats sold</div><div className="text-xl font-semibold text-text">{q.data!.totals.seatsSold}</div></CardBody></Card>
      </div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="outline" leftIcon={<Download className="h-4 w-4" />} loading={csv.isPending} disabled={!q.data?.series.length} onClick={() => csv.mutate()}>Export CSV</Button>
      </div>
      {q.data!.series.length ? <Table columns={columns} rows={q.data!.series} /> : <EmptyState title="No data in this range" />}
    </>
  );
}

function OccupancyTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-occupancy', from, to], queryFn: () => reportsApi.occupancy(from, to), placeholderData: keepPreviousData });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const columns: Column<{ date: string; routeName: string; trips: number; totalSeats: number; soldSeats: number; occupancyPct: number; revenueMinor: number }>[] = [
    { key: 'date', header: 'Journey day', render: (r) => day(r.date) },
    { key: 'route', header: 'Route', render: (r) => r.routeName },
    { key: 'trips', header: 'Buses' },
    { key: 'sold', header: 'Seats sold', render: (r) => `${r.soldSeats} / ${r.totalSeats}` },
    { key: 'pct', header: 'Occupancy', render: (r) => <OccBar pct={r.occupancyPct} /> },
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
    { key: 'pct', header: 'Occupancy', render: (r) => <OccBar pct={r.occupancyPct} /> },
    { key: 'revenue', header: 'Revenue', render: (r) => formatMoney(r.revenueMinor, 'INR') },
  ];
  return (
    <>
      <p className="mb-3 text-sm text-text-muted">Buses that ran in the last 30 days, best revenue first. Not affected by the period above.</p>
      {q.data!.routes.length ? <Table columns={columns} rows={q.data!.routes} /> : <EmptyState title="No buses ran in the last 30 days" />}
    </>
  );
}

function CancellationsTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-cancellations', from, to], queryFn: () => reportsApi.cancellations(from, to), placeholderData: keepPreviousData });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const columns: Column<{ date: string; cancelledCount: number; refundedMinor: number }>[] = [
    { key: 'date', header: 'Day cancelled', render: (r) => day(r.date) },
    { key: 'count', header: 'Cancellations', render: (r) => r.cancelledCount },
    { key: 'refunded', header: 'Refunded', render: (r) => formatMoney(r.refundedMinor, 'INR') },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-4">
        <Card><CardBody><div className="text-xs text-text-muted">Cancellation rate</div><div className="text-xl font-semibold text-text">{q.data!.cancellationRatePct}%</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Sold in the period, now cancelled</div><div className="text-xl font-semibold text-text">{q.data!.totalCancelled}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Sold in the period</div><div className="text-xl font-semibold text-text">{q.data!.totalBookings}</div></CardBody></Card>
      </div>
      {q.data!.series.length ? <Table columns={columns} rows={q.data!.series} /> : <EmptyState title="No cancellations in this range" />}
    </>
  );
}

function PeakHoursTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-peak-hours', from, to], queryFn: () => reportsApi.peakHours(from, to), placeholderData: keepPreviousData });
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

function OccBar({ pct }: { pct: number }) {
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"><div className={cn('h-2 rounded-full', pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-primary' : 'bg-warning')} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <span className="w-12 text-right text-xs">{pct}%</span>
    </div>
  );
}
