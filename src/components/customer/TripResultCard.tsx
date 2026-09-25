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
