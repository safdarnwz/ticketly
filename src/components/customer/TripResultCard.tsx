import { ArrowRight, Clock, Star, Megaphone } from 'lucide-react';

import { Badge, Button, Card, CardBody } from '@/components/ui';
import type { SearchResult } from '@/lib/api/types';
import { SEAT_TYPE_LABEL, cn, dayDiff, formatMoney, formatTime, minutesToHm } from '@/lib/utils';
import { isCustomer } from '@/lib/host';

/** One bus in search results — shared by the storefront and the staff search. */
export function TripResultCard(props: {
  trip: SearchResult;
  onSelect: (trip: SearchResult) => void;
  actionLabel?: string;
  selected?: boolean;
}) {
  return isCustomer ? <JourneyTripCard {...props} /> : <ClassicTripCard {...props} />;
}

/**
 * The storefront card: the journey as a timeline (departure — duration —
 * arrival), the stops under it, then the operator with its rating on the left
 * and the fare with the action on the right. Hairline card, no shadows.
 */
function JourneyTripCard({ trip, onSelect, actionLabel = 'View seats', selected }: {
  trip: SearchResult;
  onSelect: (trip: SearchResult) => void;
  actionLabel?: string;
  selected?: boolean;
}) {
  const nextDay = dayDiff(trip.departsAt, trip.arrivesAt);
  const fewLeft = trip.availableSeats <= 5;
  const type = trip.seatTypes.map((t) => SEAT_TYPE_LABEL[t] ?? t).join(' · ') || 'Bus';
  return (
    <article className={cn('lift rounded-[20px] border border-border bg-surface p-4 sm:p-5', selected && 'border-text')}>
      <div className="flex items-center gap-3">
        <span className="text-xl font-semibold tabular-nums tracking-tight text-text">{formatTime(trip.departsAt)}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-text-muted">
          <span className="h-px flex-1 bg-border" />
          <span className="whitespace-nowrap rounded-pill bg-surface-muted px-2.5 py-0.5 text-xs">{minutesToHm(trip.durationMin)}</span>
          <span className="h-px flex-1 bg-border" />
        </span>
        <span className="text-xl font-semibold tabular-nums tracking-tight text-text">
          {formatTime(trip.arrivesAt)}
          {nextDay > 0 && <sup className="ml-0.5 text-xs font-medium text-text-muted">+{nextDay}</sup>}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-4 text-xs text-text-muted">
        <span className="min-w-0 truncate" title={trip.boardingStop.name}>{trip.boardingStop.name}</span>
        <span className="min-w-0 truncate text-right" title={trip.droppingStop.name}>{trip.droppingStop.name}</span>
      </div>

      <div className="my-4 border-t border-dashed border-border" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-text">{trip.operatorName}</span>
            {trip.isPromoted && <span className="shrink-0 rounded-pill bg-accent/10 px-2 py-0.5 text-xs text-accent">Featured</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <span>{type}</span>
            {trip.rating !== null ? (
              <span className="inline-flex items-center gap-1 text-text" title={`${trip.ratingCount} review${trip.ratingCount === 1 ? '' : 's'}`}>
                <Star className="h-3 w-3 fill-current text-accent" /> {trip.rating.toFixed(1)}
                <span className="text-text-muted">({trip.ratingCount})</span>
              </span>
            ) : (
              <span className="text-accent">New</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold tabular-nums leading-tight tracking-tight text-text">{formatMoney(trip.fromPriceMinor, trip.currency).replace(/\.00$/, '')}</div>
          <div className="text-xs text-text-muted">onwards</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={cn('rounded-pill px-2.5 py-0.5 text-xs', fewLeft ? 'bg-warning/10 font-medium text-warning' : 'bg-surface-muted text-text-muted')}>
            {trip.availableSeats} seat{trip.availableSeats === 1 ? '' : 's'} left
          </span>
          {trip.amenities.slice(0, 4).map((a) => (
            <span key={a.id} className="hidden rounded-pill bg-surface-muted px-2.5 py-0.5 text-xs text-text-muted sm:inline" title={a.name}>{a.name}</span>
          ))}
          {trip.amenities.length > 4 && <span className="hidden px-1 text-xs text-text-muted sm:inline">+{trip.amenities.length - 4}</span>}
        </div>
        <Button size="sm" className="shrink-0" onClick={() => onSelect(trip)}>{actionLabel}</Button>
      </div>
    </article>
  );
}

/** The console look (staff counter, agents): flat card, hairlines. */
function ClassicTripCard({ trip, onSelect, actionLabel = 'View seats', selected }: {
  trip: SearchResult;
  onSelect: (trip: SearchResult) => void;
  actionLabel?: string;
  selected?: boolean;
}) {
  const nextDay = dayDiff(trip.departsAt, trip.arrivesAt);
  const fewLeft = trip.availableSeats <= 5;
  return (
    <Card className={cn('transition hover:shadow-md', selected && 'border-primary ring-1 ring-primary')}>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-text">{trip.operatorName}</span>
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
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-white',
                trip.rating >= 4 ? 'bg-success' : trip.rating >= 3 ? 'bg-warning' : 'bg-danger',
              )}
              title={`${trip.ratingCount} review${trip.ratingCount === 1 ? '' : 's'}`}
            >
              <Star className="h-3 w-3 fill-current" /> {trip.rating.toFixed(1)}
              <span className="font-normal opacity-90">({trip.ratingCount})</span>
            </span>
          ) : (
            <span className="text-xs text-text-muted">New</span>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div>
              <div className="text-lg font-semibold text-text">{formatTime(trip.departsAt)}</div>
              <div className="truncate text-xs text-text-muted" title={trip.boardingStop.name}>{trip.boardingStop.name}</div>
            </div>
            <div className="flex flex-col items-center text-text-muted">
              <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />{minutesToHm(trip.durationMin)}</span>
              <ArrowRight className="h-4 w-4" />
            </div>
            <div className="text-right sm:text-left">
              <div className="text-lg font-semibold text-text">
                {formatTime(trip.arrivesAt)}
                {nextDay > 0 && <sup className="ml-0.5 text-xs font-medium text-warning">+{nextDay}</sup>}
              </div>
              <div className="truncate text-xs text-text-muted" title={trip.droppingStop.name}>{trip.droppingStop.name}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="text-right">
              <div className="text-xs text-text-muted">Starts from</div>
              <div className="text-xl font-semibold text-text">{formatMoney(trip.fromPriceMinor, trip.currency)}</div>
              <div className={cn('text-xs', fewLeft ? 'font-medium text-danger' : 'text-text-muted')}>
                {trip.availableSeats} seat{trip.availableSeats === 1 ? '' : 's'} left
              </div>
            </div>
            <Button onClick={() => onSelect(trip)}>{actionLabel}</Button>
          </div>
        </div>

        {trip.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
            {trip.amenities.map((a) => (
              <span key={a.id} className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-muted" title={a.name}>
                {a.icon && <span aria-hidden>{a.icon}</span>}{a.name}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
