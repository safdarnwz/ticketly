import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BarChart3, CheckCircle2, IndianRupee, RotateCcw, Search, Star, Ticket, Timer, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, Card, CardBody, CardHeader, ErrorState, PageLoader, Skeleton, Table, statusTone, type Column } from '@/components/ui';
import { useIsAgent, useIsCrew } from '@/lib/useAgent';
import { useAuth } from '@/stores/auth';
import { reportsApi } from '@/lib/api/reports';
import { schedulingApi, type TripRow } from '@/lib/api/scheduling';
import { bookingsApi, type StaffBookingRow } from '@/lib/api/bookings';
import { addDaysIso, cn, formatMoney, formatTime, todayLocal } from '@/lib/utils';

const REFRESH_MS = 30_000;

const shortcuts = [
  { to: '/search', label: 'Search & Book', desc: 'Sell a seat at the counter', icon: Search },
  { to: '/bookings', label: 'Bookings', desc: 'Every booking, with filters', icon: Ticket },
  { to: '/refunds', label: 'Refunds', desc: 'Pending refund requests', icon: RotateCcw },
  { to: '/reviews', label: 'Reviews', desc: 'What customers are saying', icon: Star },
];

function Kpi({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-start gap-2 p-4 sm:flex-row sm:gap-3 sm:p-card">
        <div className={cn('rounded-xl bg-surface-muted p-2 text-text-muted', tone)}>{icon}</div>
        <div className="min-w-0 max-w-full">
          <div className="text-xs text-text-muted">{label}</div>
          <div className="truncate font-display text-lg text-text sm:text-2xl" title={value}>{value}</div>
          {hint && <div className="text-xs text-text-muted">{hint}</div>}
        </div>
      </CardBody>
    </Card>
  );
}

function greeting(): string {
  const h = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Occupancy as a bar: paid seats solid, seats being paid for now striped. */
function Occupancy({ t }: { t: TripRow }) {
  const paid = t.totalSeats ? (t.bookedSeats / t.totalSeats) * 100 : 0;
  const held = t.totalSeats ? (t.heldSeats / t.totalSeats) * 100 : 0;
  return (
    <div className="min-w-36">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${t.bookedSeats} of ${t.totalSeats} seats sold`}>
        <div className="bg-primary" style={{ width: `${Math.min(100, paid)}%` }} />
        <div className="bg-warning" style={{ width: `${Math.min(100 - paid, held)}%` }} />
      </div>
      <div className="mt-1 text-xs text-text-muted">
        {t.bookedSeats}/{t.totalSeats} sold{t.heldSeats ? ` · ${t.heldSeats} paying now` : ''}
      </div>
    </div>
  );
}

/** Staff land on the operator dashboard; a travel agent's login lands on their own portal. */
export function DashboardPage() {
  const { isAgent, loading } = useIsAgent();
  const { isCrew } = useIsCrew();
  if (loading) return <PageLoader />;
  return isAgent ? <Navigate to="/agent" replace /> : isCrew ? <Navigate to="/crew" replace /> : <StaffDashboard />;
}

function StaffDashboard() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const today = todayLocal();
  const summary = useQuery({ queryKey: ['reports-summary'], queryFn: reportsApi.summary, refetchInterval: REFRESH_MS });
  const trips = useQuery({ queryKey: ['trips', today], queryFn: () => schedulingApi.listTrips(today), refetchInterval: REFRESH_MS });
  const recent = useQuery({ queryKey: ['bookings-recent', today], queryFn: () => bookingsApi.list({}, undefined, 8), refetchInterval: REFRESH_MS });
  const hourly = useQuery({ queryKey: ['report-peak', today, today], queryFn: () => reportsApi.peakHours(today, today), refetchInterval: REFRESH_MS });
  const monthFrom = addDaysIso(today, -29);
  const occupancy30 = useQuery({ queryKey: ['report-occupancy', monthFrom, today], queryFn: () => reportsApi.occupancy(monthFrom, today) });
  const running = (trips.data?.items ?? []).filter((t) => t.status !== 'cancelled');
  const seatsToday = running.reduce((a, t) => a + t.totalSeats, 0);
  const avgOccupancy = seatsToday ? Math.round((running.reduce((a, t) => a + t.bookedSeats, 0) / seatsToday) * 100) : null;

  const name = user?.fullName && !user.fullName.includes('@') ? user.fullName.split(' ')[0] : null;
  const s = summary.data;

  const tripColumns: Column<TripRow>[] = [
    { key: 'dep', header: 'Departs', render: (t) => <span className="font-semibold">{formatTime(t.departsAt)}</span> },
    { key: 'route', header: 'Route', render: (t) => t.routeName },
    { key: 'occ', header: 'Occupancy', render: (t) => <Occupancy t={t} /> },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
  ];
  const bookingColumns: Column<StaffBookingRow>[] = [
    { key: 'pnr', header: 'PNR', render: (b) => <span className="font-mono font-semibold">{b.pnr}</span> },
    { key: 'who', header: 'Passenger', render: (b) => <span>{b.leadPassenger ?? '—'}{b.seatCount > 1 ? <span className="text-text-muted"> +{b.seatCount - 1}</span> : null}</span> },
    { key: 'route', header: 'Journey', render: (b) => <span className="whitespace-nowrap text-text-muted">{b.routeName}<br /><span className="text-xs">{b.journeyDate}</span></span> },
    { key: 'amt', header: 'Amount', render: (b) => formatMoney(b.paidMinor || b.totalMinor), className: 'text-right whitespace-nowrap' },
    { key: 'st', header: 'Status', render: (b) => <Badge tone={b.liveHold ? 'warning' : statusTone(b.status)}>{b.liveHold ? 'paying now' : b.status}</Badge> },
  ];

  return (
    <>
      <div className="mb-6 rounded-card bg-primary p-7 text-primary-fg sm:p-8">
        <p className="text-sm font-medium text-white/60">Operator console</p>
        <h1 className="mt-1 font-display text-2xl tracking-tight sm:text-3xl">{greeting()}{name ? `, ${name}` : ''}.</h1>
        <p className="mt-2 max-w-lg text-[15px] text-white/60">Today’s departures, sales and cancellations — updated every 30 seconds.</p>
      </div>

      {summary.isError ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6">
          {!s ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />) : (
            <>
              <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="text-success" label="Booked today" value={String(s.todayBookings)} hint={`${s.todaySeats} seats`} />
              <Kpi icon={<IndianRupee className="h-5 w-5" />} label="Sales today" value={formatMoney(s.todayRevenueMinor)} hint={`All time ${formatMoney(s.totalRevenueMinor)}`} />
              <Kpi icon={<Timer className="h-5 w-5" />} tone="text-warning" label="Paying now" value={String(s.liveHolds)} hint={`${s.liveHoldSeats} seats on hold`} />
              <Kpi icon={<XCircle className="h-5 w-5" />} tone="text-danger" label="Cancelled today" value={String(s.todayCancelled)} hint={`${s.totalCancelled} all time`} />
              <Kpi icon={<BarChart3 className="h-5 w-5" />} label="Average occupancy today" value={avgOccupancy == null ? '—' : `${avgOccupancy}%`} hint={`${running.length} bus${running.length === 1 ? '' : 'es'} running today`} />
              <Kpi icon={<Ticket className="h-5 w-5" />} label="All bookings" value={String(s.totalBookings)} />
            </>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Today’s departures" subtitle="Click a bus for its reservation chart" />
          <CardBody>
            {trips.isLoading ? <Skeleton className="h-40" /> : trips.isError ? <ErrorState error={trips.error} onRetry={trips.refetch} /> : (
              <Table
                columns={tripColumns}
                rows={trips.data?.items ?? []}
                onRowClick={(t) => navigate(`/trips/${t.id}`)}
                empty="No bus leaves today."
              />
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Latest bookings" subtitle="Booked today" action={<Link to="/bookings" className="text-sm text-primary hover:underline">All bookings</Link>} />
          <CardBody>
            {recent.isLoading ? <Skeleton className="h-40" /> : recent.isError ? <ErrorState error={recent.error} onRetry={recent.refetch} /> : (
              <Table columns={bookingColumns} rows={recent.data?.items ?? []} onRowClick={(b) => navigate(`/bookings/${b.pnr}`)} empty="No bookings yet today." />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Bookings by hour" subtitle="Today, by the hour they were made" />
          <CardBody>
            {hourly.isLoading ? <Skeleton className="h-40" /> : hourly.isError ? <ErrorState error={hourly.error} onRetry={hourly.refetch} /> : <HourlyChart items={hourly.data?.items ?? []} />}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Routes, last 30 days" subtitle="By seats filled" action={<Link to="/reports" className="text-sm text-primary hover:underline">Reports</Link>} />
          <CardBody>
            {occupancy30.isLoading ? <Skeleton className="h-40" /> : occupancy30.isError ? <ErrorState error={occupancy30.error} onRetry={occupancy30.refetch} /> : <RouteRanking series={occupancy30.data?.series ?? []} />}
          </CardBody>
        </Card>
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Quick actions</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {shortcuts.map(({ to, label, desc, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card interactive>
              <CardBody className="flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"><Icon className="h-5 w-5" /></div>
                <div className="flex-1">
                  <div className="flex items-center gap-1 font-semibold text-text">{label} <ArrowUpRight className="h-4 w-4 text-text-muted" /></div>
                  <div className="text-sm text-text-muted">{desc}</div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

function HourlyChart({ items }: { items: { hour: number; bookingCount: number; grossMinor: number }[] }) {
  const byHour = Array.from({ length: 24 }, (_, h) => items.find((i) => Number(i.hour) === h) ?? { hour: h, bookingCount: 0, grossMinor: 0 });
  const max = Math.max(1, ...byHour.map((h) => Number(h.bookingCount)));
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  if (!items.some((i) => Number(i.bookingCount) > 0)) return <p className="py-10 text-center text-sm text-text-muted">No bookings yet today.</p>;
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Bookings made in each hour today">
      {byHour.map((h) => (
        <div key={h.hour} className="flex flex-1 flex-col items-center gap-1" title={`${String(h.hour).padStart(2, '0')}:00 — ${h.bookingCount} bookings, ${formatMoney(Number(h.grossMinor))}`}>
          <div className={cn('w-full rounded-t', h.hour > nowHour ? 'bg-surface-muted' : 'bg-primary')} style={{ height: `${Math.max(2, (Number(h.bookingCount) / max) * 128)}px` }} />
          <span className="h-3 text-[10px] leading-3 text-text-muted">{h.hour % 3 === 0 ? String(h.hour).padStart(2, '0') : ''}</span>
        </div>
      ))}
    </div>
  );
}

function RouteRanking({ series }: { series: { routeId: string; routeName: string; totalSeats: number; soldSeats: number; revenueMinor: number }[] }) {
  const byRoute = new Map<string, { name: string; seats: number; sold: number; revenue: number }>();
  for (const r of series) {
    const g = byRoute.get(r.routeId) ?? { name: r.routeName, seats: 0, sold: 0, revenue: 0 };
    g.seats += Number(r.totalSeats); g.sold += Number(r.soldSeats); g.revenue += Number(r.revenueMinor);
    byRoute.set(r.routeId, g);
  }
  const ranked = [...byRoute.values()].filter((g) => g.seats > 0).map((g) => ({ ...g, pct: Math.round((g.sold / g.seats) * 100) })).sort((a, b) => b.pct - a.pct);
  if (ranked.length === 0) return <p className="py-10 text-center text-sm text-text-muted">No trips in the last 30 days.</p>;
  const top = ranked.slice(0, 5);
  const bottom = ranked.length > 5 ? ranked.slice(-5).reverse() : [];
  const row = (g: (typeof ranked)[number]) => (
    <li key={g.name} className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="truncate text-text">{g.name}</span>
      <span className="shrink-0 text-text-muted">{g.pct}% · {formatMoney(g.revenue)}</span>
    </li>
  );
  return (
    <div className="flex flex-col gap-3">
      <div><div className="mb-1 text-xs font-semibold text-success">Best filled</div><ul>{top.map(row)}</ul></div>
      {bottom.length > 0 && <div><div className="mb-1 text-xs font-semibold text-danger">Least filled</div><ul>{bottom.map(row)}</ul></div>}
    </div>
  );
}
