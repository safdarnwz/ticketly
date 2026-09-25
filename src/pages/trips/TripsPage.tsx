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
  const setDate = (d: string) => setParams(d && d !== today ? { date: d } : {}, { replace: true });

  const trips = useQuery({
    queryKey: ['trips', date],
    queryFn: () => schedulingApi.listTrips(date),
    enabled: valid,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const rows = trips.data?.items ?? [];
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
          {valid && rows.length > 0 && (
            <div className="ml-auto text-sm text-text-muted">{formatDateLabel(date, { weekday: 'long', day: '2-digit', month: 'short' })} · {rows.length} bus{rows.length === 1 ? '' : 'es'} · {sold}/{capacity} seats sold</div>
          )}
        </CardBody>
      </Card>
      {!valid ? null : trips.isLoading ? <Skeleton className="h-64" /> : trips.isError ? <ErrorState error={trips.error} onRetry={trips.refetch} /> : rows.length === 0 ? (
        <EmptyState title="No buses on this date" description="No trip is scheduled for this day. Services create trips ahead of time — check Schedule." icon={<Bus className="h-10 w-10" />} />
      ) : (
        <Table columns={columns} rows={rows} onRowClick={(t) => navigate(`/trips/${t.id}`)} />
      )}
    </>
  );
}
