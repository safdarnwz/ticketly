import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, IndianRupee, RotateCcw, Search, Star, Ticket, Timer, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, Table, statusTone, type Column } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { reportsApi } from '@/lib/api/reports';
import { schedulingApi, type TripRow } from '@/lib/api/scheduling';
import { bookingsApi, type StaffBookingRow } from '@/lib/api/bookings';
import { cn, formatMoney, formatTime, todayLocal } from '@/lib/utils';

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
      <CardBody className="flex items-start gap-3">
        <div className={cn('rounded-lg bg-surface-muted p-2 text-text-muted', tone)}>{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-text-muted">{label}</div>
          <div className="break-words font-display text-xl text-text sm:text-2xl">{value}</div>
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

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const today = todayLocal();
  const summary = useQuery({ queryKey: ['reports-summary'], queryFn: reportsApi.summary, refetchInterval: REFRESH_MS });
  const trips = useQuery({ queryKey: ['trips', today], queryFn: () => schedulingApi.listTrips(today), refetchInterval: REFRESH_MS });
  const recent = useQuery({ queryKey: ['bookings-recent', today], queryFn: () => bookingsApi.list({}, undefined, 8), refetchInterval: REFRESH_MS });

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
        <h1 className="mt-1 font-display text-3xl tracking-tight">{greeting()}{name ? `, ${name}` : ''}.</h1>
        <p className="mt-2 max-w-lg text-[15px] text-white/60">Today’s departures, sales and cancellations — updated every 30 seconds.</p>
      </div>

      {summary.isError ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          {!s ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />) : (
            <>
              <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="text-success" label="Booked today" value={String(s.todayBookings)} hint={`${s.todaySeats} seats`} />
              <Kpi icon={<IndianRupee className="h-5 w-5" />} label="Sales today" value={formatMoney(s.todayRevenueMinor)} hint={`All time ${formatMoney(s.totalRevenueMinor)}`} />
              <Kpi icon={<Timer className="h-5 w-5" />} tone="text-warning" label="Paying now" value={String(s.liveHolds)} hint={`${s.liveHoldSeats} seats on hold`} />
              <Kpi icon={<XCircle className="h-5 w-5" />} tone="text-danger" label="Cancelled today" value={String(s.todayCancelled)} hint={`${s.totalCancelled} all time`} />
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
