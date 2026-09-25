import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, RefreshCw } from 'lucide-react';

import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { SeatMap } from '@/components/customer/SeatMap';
import { flowApi, type SeatCell, type TripStop } from '@/lib/api/booking-flow';
import { SEAT_TYPE_LABEL, cn, formatTime } from '@/lib/utils';

/** Seats one booking can take (the backend allows up to 10; operators sell up to 6 online). */
export const MAX_SEATS_PER_BOOKING = 6;

export interface SeatSelection {
  fromStop?: TripStop;
  toStop?: TripStop;
  seats: SeatCell[];
  /** All selected seats share one type — one quote per booking. */
  seatType?: string;
}

function StopList({ title, stops, value, onPick }: { title: string; stops: TripStop[]; value?: string; onPick: (s: TripStop) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</legend>
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
        {stops.map((s) => (
          <label
            key={s.stopId}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition',
              value === s.stopId ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted',
            )}
          >
            <input type="radio" className="mt-1 accent-[var(--yb-color-primary)]" checked={value === s.stopId} onChange={() => onPick(s)} />
            <span className="flex-1">
              <span className="font-semibold text-text">{formatTime(title.startsWith('Boarding') ? s.departsAt : s.arrivesAt)}</span>{' '}
              <span className="text-text">{s.name ?? 'Stop'}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Pick boarding / dropping points and seats on one trip. Used by the
 * storefront, the staff counter and each leg of a connecting journey.
 * The seat map refreshes every 15 s; a chosen seat that someone else takes
 * meanwhile is dropped from the selection with a note.
 */
export function SeatSelector({ tripId, tenantId, initialFromStopId, initialToStopId, priceOf, currency, onChange, maxSeats = MAX_SEATS_PER_BOOKING, lockStops }: {
  tripId: string;
  /** The trip's operator, when it is not the booking in progress (connecting legs). */
  tenantId?: string;
  initialFromStopId?: string;
  initialToStopId?: string;
  priceOf: (seatType: string) => number | undefined;
  currency?: string;
  onChange: (s: SeatSelection) => void;
  maxSeats?: number;
  /** Connecting legs: the boarding/dropping points are fixed by the journey. */
  lockStops?: boolean;
}) {
  const detail = useQuery({ queryKey: ['trip', tripId, tenantId], queryFn: () => flowApi.trip(tripId, tenantId), enabled: Boolean(tripId) });
  const stops = useMemo(() => detail.data?.stops ?? [], [detail.data]);
  const [fromId, setFromId] = useState(initialFromStopId ?? '');
  const [toId, setToId] = useState(initialToStopId ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');

  // Defaults: the search's own boarding/dropping points, else first boarding / last dropping.
  useEffect(() => {
    if (!stops.length) return;
    const from = stops.find((s) => s.stopId === fromId && s.canBoard) ?? stops.find((s) => s.canBoard);
    const toCandidates = stops.filter((s) => s.canAlight && from && s.sequence > from.sequence);
    const to = toCandidates.find((s) => s.stopId === toId) ?? toCandidates[toCandidates.length - 1];
    if (from && from.stopId !== fromId) setFromId(from.stopId);
    if (to && to.stopId !== toId) setToId(to.stopId);
  }, [stops, fromId, toId]);

  const fromStop = stops.find((s) => s.stopId === fromId);
  const toStop = stops.find((s) => s.stopId === toId);
  const boardingStops = stops.filter((s) => s.canBoard && s.sequence < stops[stops.length - 1]?.sequence);
  const droppingStops = stops.filter((s) => s.canAlight && fromStop && s.sequence > fromStop.sequence);

  const map = useQuery({
    queryKey: ['availability', tripId, fromId, toId, tenantId],
    queryFn: () => flowApi.availability(tripId, fromId, toId, tenantId),
    enabled: Boolean(tripId && fromId && toId && fromStop && toStop && toStop.sequence > fromStop.sequence),
    refetchInterval: 15_000,
  });

  // A selected seat that is no longer free (someone else booked it) leaves the selection.
  const lastMap = useRef(map.data);
  useEffect(() => {
    if (!map.data || map.data === lastMap.current) return;
    lastMap.current = map.data;
    const gone = selected.filter((n) => !map.data!.seats.find((s) => s.seatNumber === n)?.available);
    if (gone.length) {
      setSelected((cur) => cur.filter((n) => !gone.includes(n)));
      setNotice(`Seat ${gone.join(', ')} was just booked by someone else — please pick another.`);
    }
  }, [map.data, selected]);

  const seatCells = (map.data?.seats ?? []).filter((s) => selected.includes(s.seatNumber));
  const seatType = seatCells[0]?.seatType;
  useEffect(() => {
    onChange({ fromStop, toStop, seats: seatCells, seatType });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report only when the selection or stops change
  }, [fromId, toId, selected.join(','), map.data]);

  const toggle = (s: SeatCell) => {
    setNotice('');
    if (selected.includes(s.seatNumber)) {
      setSelected((cur) => cur.filter((x) => x !== s.seatNumber));
      return;
    }
    if (selected.length >= maxSeats) {
      setNotice(`You can book up to ${maxSeats} seats at a time.`);
      return;
    }
    if (seatType && s.seatType !== seatType) {
      setNotice(`Book one seat type at a time: you have ${SEAT_TYPE_LABEL[seatType] ?? seatType} seats selected.`);
      return;
    }
    setSelected((cur) => [...cur, s.seatNumber]);
  };

  const changeStops = (from: string, to: string) => {
    setFromId(from);
    setToId(to);
    if (selected.length) {
      setSelected([]);
      setNotice('Seats were cleared because availability depends on where you board and get off.');
    }
  };

  if (detail.isLoading) return <Skeleton className="h-80 w-full" />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={detail.refetch} />;
  const status = detail.data?.trip.status;
  if (status && !['open', 'scheduled'].includes(status)) {
    return <EmptyState title="This bus is no longer taking bookings" description={`The trip is ${status}. Please choose another bus.`} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {!lockStops && boardingStops.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <StopList title="Boarding point" stops={boardingStops} value={fromId} onPick={(s) => {
            const keepTo = droppingStops.find((d) => d.stopId === toId && d.sequence > s.sequence);
            changeStops(s.stopId, keepTo ? toId : '');
          }} />
          <StopList title="Dropping point" stops={droppingStops} value={toId} onPick={(s) => changeStops(fromId, s.stopId)} />
        </div>
      )}
      {lockStops && fromStop && toStop && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <MapPin className="h-4 w-4" /> {fromStop.name} {formatTime(fromStop.departsAt)} → {toStop.name} {formatTime(toStop.arrivesAt)}
        </div>
      )}

      {notice && <div role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{notice}</div>}

      {map.isLoading ? <Skeleton className="h-72 w-full" /> : map.isError ? (
        <ErrorState error={map.error} onRetry={map.refetch} />
      ) : map.data ? (
        map.data.available === 0 ? (
          <EmptyState title="Sold out for this part of the route" description="Try other boarding or dropping points, or another bus." />
        ) : (
          <>
            <SeatMap map={map.data} selected={selected} onToggle={toggle} priceOf={priceOf} currency={currency} />
            <div className="flex items-center justify-center gap-1.5 text-xs text-text-muted">
              <RefreshCw className={cn('h-3 w-3', map.isFetching && 'animate-spin')} /> {map.data.available} of {map.data.total} seats free · updates live
            </div>
          </>
        )
      ) : null}
    </div>
  );
}
