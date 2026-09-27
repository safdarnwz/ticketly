import { ArrowRight, Clock, Star, Megaphone } from 'lucide-react';

import { Badge, Button, Card, CardBody } from '@/components/ui';
import type { SearchResult } from '@/lib/api/types';
import { SEAT_TYPE_LABEL, cn, dayDiff, formatMoney, formatTime, minutesToHm } from '@/lib/utils';

/** One bus in search results — shared by the storefront and the staff search. */
export function TripResultCard({ trip, onSelect, actionLabel = 'View seats', selected }: {
  trip: SearchResult;
  onSelect: (trip: SearchResult) => void;
  actionLabel?: string;
  selected?: boolean;
}) {
  const nextDay = dayDiff(trip.departsAt, trip.arrivesAt);
  const fewLeft = trip.availableSeats <= 5;
  return (
    <Card className={cn('lift overflow-hidden', selected && 'ring-2 ring-primary')}>
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-[17px] text-text">{trip.operatorName}</span>
              {trip.isPromoted && (
                <Badge tone="primary"><Megaphone className="h-3 w-3" /> Promoted</Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-text-muted">
              {trip.seatTypes.map((t) => SEAT_TYPE_LABEL[t] ?? t).join(' · ') || 'Bus'}
            </div>
          </div>
          {trip.rating !== null ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-bold text-white',
                trip.rating >= 4 ? 'bg-success' : trip.rating >= 3 ? 'bg-warning' : 'bg-danger',
              )}
              title={`${trip.ratingCount} review${trip.ratingCount === 1 ? '' : 's'}`}
            >
              <Star className="h-3 w-3 fill-current" /> {trip.rating.toFixed(1)}
              <span className="font-normal opacity-90">({trip.ratingCount})</span>
            </span>
          ) : (
            <span className="shrink-0 rounded-pill bg-secondary/10 px-2 py-0.5 text-xs font-semibold text-secondary">New</span>
          )}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-lg font-bold text-text"><Clock className="h-4 w-4 text-accent" />{formatTime(trip.departsAt)}</div>
              <div className="truncate text-xs text-text-muted" title={trip.boardingStop.name}>{trip.boardingStop.name}</div>
            </div>
            <div className="flex flex-col items-center gap-0.5 text-text-muted">
              <span className="text-xs font-semibold text-secondary">{minutesToHm(trip.durationMin)}</span>
              <span className="flex items-center gap-1"><span className="dot-from !h-2 !w-2 !border-2" /><span className="w-8 border-t border-dashed border-text-muted/50" /><ArrowRight className="h-3.5 w-3.5 text-secondary" /></span>
            </div>
            <div className="min-w-0 text-right sm:text-left">
              <div className="text-lg font-bold text-text">
                {formatTime(trip.arrivesAt)}
                {nextDay > 0 && <sup className="ml-0.5 text-xs font-semibold text-warning">+{nextDay}</sup>}
              </div>
              <div className="truncate text-xs text-text-muted" title={trip.droppingStop.name}>{trip.droppingStop.name}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface-muted/60 px-3 py-2 sm:justify-end sm:bg-transparent sm:p-0">
            <div className="text-left sm:text-right">
              <div className="text-[11px] text-text-muted">Starts from</div>
              <div className="font-display text-2xl text-price">{formatMoney(trip.fromPriceMinor, trip.currency)}</div>
              <div className={cn('text-xs', fewLeft ? 'font-semibold text-danger' : 'text-text-muted')}>
                {trip.availableSeats} seat{trip.availableSeats === 1 ? '' : 's'} left
              </div>
            </div>
            <Button className="rounded-pill" onClick={() => onSelect(trip)}>{actionLabel}</Button>
          </div>
        </div>

        {trip.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trip.amenities.map((a) => (
              <span key={a.id} className="flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-0.5 text-xs text-text-muted" title={a.name}>
                {a.icon && <span aria-hidden>{a.icon}</span>}{a.name}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** The small phone card in a bus-type carousel: operator, type, time, duration, price. */
export function CompactTripCard({ trip, onSelect, muted }: { trip: SearchResult; onSelect: (trip: SearchResult) => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(trip)}
      aria-label={`${trip.operatorName}, ${formatTime(trip.departsAt)}, from ${formatMoney(trip.fromPriceMinor, trip.currency)}`}
      className={cn('flex w-[176px] shrink-0 snap-start flex-col gap-3 rounded-[20px] p-4 text-left transition active:scale-[0.98]', muted ? 'bg-surface-muted' : 'bg-surface shadow-md')}
    >
      <div className="min-w-0">
        <div className="truncate font-display text-[15px] text-text">{trip.operatorName}</div>
        <div className="truncate text-[11px] text-text-muted">{trip.boardingStop.name}</div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1 text-xs text-text-muted">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-accent" />{formatTime(trip.departsAt)}</span>
          <span className="flex items-center gap-1"><ArrowRight className="h-3.5 w-3.5 text-secondary" />{minutesToHm(trip.durationMin)}</span>
        </div>
        <span className="font-display text-lg leading-none text-price">{formatMoney(trip.fromPriceMinor, trip.currency).replace(/\.00$/, '')}</span>
      </div>
      <span className={cn('text-[11px]', trip.availableSeats <= 5 ? 'font-semibold text-danger' : 'text-text-muted')}>{trip.availableSeats} seats left</span>
    </button>
  );
}
