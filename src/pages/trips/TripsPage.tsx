import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bus, ChevronLeft, ChevronRight } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Skeleton, Table, statusTone, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { schedulingApi, type TripRow } from '@/lib/api/scheduling';
import { TRIP_STATUS_LABEL } from '@/lib/trip-status';
import { addDaysIso, formatDateLabel, formatTime, todayLocal } from '@/lib/utils';

/**
 * One day's buses — occupancy, what is being paid for right now, status —
 * each opening its reservation chart. Any date, past or future.
 */
export function TripsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const date = params.get('date') ?? today;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const setDate = (d: string) => { const next = new URLSearchParams(params); if (d && d !== today) next.set('date', d); else next.delete('date'); setParams(next, { replace: true }); };

  const trips = useQuery({
    queryKey: ['trips', date],
    queryFn: () => schedulingApi.listTrips(date),
    enabled: valid,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const all = trips.data?.items ?? [];
  /** Which buses to show: every one, on sale, on the road now, finished, or cancelled. */
  const show = params.get('show') ?? 'all';
  const setShow = (v: string) => { const next = new URLSearchParams(params); if (v === 'all') next.delete('show'); else next.set('show', v); setParams(next, { replace: true }); };
  const FILTERS: { key: string; label: string; match: (t: TripRow) => boolean }[] = [
    { key: 'all', label: 'All', match: () => true },
    { key: 'sale', label: 'On sale', match: (t) => t.status === 'open' || t.status === 'scheduled' },
    { key: 'road', label: 'On the road', match: (t) => t.status === 'departed' },
    { key: 'done', label: 'Sales closed / arrived', match: (t) => t.status === 'closed' },
    { key: 'cancelled', label: 'Cancelled', match: (t) => t.status === 'cancelled' },
  ];
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0]!;
  const rows = all.filter(filter.match);
  const sold = rows.reduce((a, t) => a + (t.status === 'cancelled' ? 0 : t.bookedSeats), 0);
  const capacity = rows.reduce((a, t) => a + (t.status === 'cancelled' ? 0 : t.totalSeats), 0);

  const columns: Column<TripRow>[] = [
    { key: 'dep', header: 'Departs', render: (t) => <span className="font-semibold">{formatTime(t.departsAt)}</span> },
    { key: 'route', header: 'Route', render: (t) => t.routeName },
    { key: 'arr', header: 'Arrives', render: (t) => <span className="text-text-muted">{formatTime(t.arrivesAt)}{t.arrivesAt.slice(0, 10) !== t.departsAt.slice(0, 10) ? ' +1' : ''}</span> },
    {
      key: 'occ', header: 'Seats', render: (t) => (
        <div className="min-w-40">
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${t.bookedSeats} of ${t.totalSeats} seats sold`}>
            <div className="bg-primary" style={{ width: `${t.totalSeats ? Math.min(100, (t.bookedSeats / t.totalSeats) * 100) : 0}%` }} />
            <div className="bg-warning" style={{ width: `${t.totalSeats ? Math.min(100, (t.heldSeats / t.totalSeats) * 100) : 0}%` }} />
          </div>
          <div className="mt-1 text-xs text-text-muted">{t.bookedSeats}/{t.totalSeats} sold · {t.occupancyPct}%{t.heldSeats ? ` · ${t.heldSeats} paying now` : ''}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status === 'closed' ? 'held' : t.status)}>{TRIP_STATUS_LABEL[t.status] ?? t.status}</Badge> },
  ];

  return (
    <>
      <PageHeader title="Trips" subtitle="Each day’s buses — open one for its reservation chart, passengers and operations" />
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-2">
          <Button variant="outline" aria-label="Previous day" onClick={() => setDate(addDaysIso(date, -1))} disabled={!valid}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="w-44"><Input label="Journey date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={valid ? undefined : 'Pick a date'} /></div>
          <Button variant="outline" aria-label="Next day" onClick={() => setDate(addDaysIso(date, 1))} disabled={!valid}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" onClick={() => setDate(today)} disabled={date === today}>Today</Button>
          <Button variant="outline" onClick={() => setDate(addDaysIso(today, 1))}>Tomorrow</Button>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => {
              const n = all.filter(f.match).length;
              return <button key={f.key} role="radio" aria-checked={filter.key === f.key} onClick={() => setShow(f.key)}
                className={filter.key === f.key ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-text' : 'rounded-full border border-border px-3 py-1 text-xs text-text-muted hover:text-text'}>{f.label}{f.key !== 'all' ? ` · ${n}` : ''}</button>;
            })}
          </div>
          {valid && rows.length > 0 && (
            <div className="ml-auto text-sm text-text-muted">{formatDateLabel(date, { weekday: 'long', day: '2-digit', month: 'short' })} · {rows.length} bus{rows.length === 1 ? '' : 'es'} · {sold}/{capacity} seats sold</div>
          )}
        </CardBody>
      </Card>
      {!valid ? null : trips.isLoading ? <Skeleton className="h-64" /> : trips.isError ? <ErrorState error={trips.error} onRetry={trips.refetch} /> : all.length > 0 && rows.length === 0 ? (
        <EmptyState title={`No buses ${filter.label.toLowerCase()} on this date`} action={<Button variant="outline" onClick={() => setShow('all')}>Show all</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState title="No buses on this date" description="No trip is scheduled for this day. Services create trips ahead of time — check Schedule." icon={<Bus className="h-10 w-10" />} />
      ) : (
        <Table columns={columns} rows={rows} onRowClick={(t) => navigate(`/trips/${t.id}`)} />
      )}
    </>
  );
}
