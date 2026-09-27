import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock, Star } from 'lucide-react';

import { Button, Card, CardBody, CardHeader } from '@/components/ui';
import { LuggageNote } from '@/components/customer/LuggageNote';
import { SeatSelector, type SeatSelection } from '@/components/customer/SeatSelector';
import { flowApi } from '@/lib/api/booking-flow';
import { bookingsApi } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import type { SearchResult } from '@/lib/api/types';
import { useBooking } from '@/stores/booking';
import { SEAT_TYPE_LABEL, formatDateLabel, formatMoney, formatTime, localDateOf, minutesToHm } from '@/lib/utils';

export function TripPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const b = useBooking();
  // The trip comes from the results page; after a refresh it is restored
  // from this tab's saved booking state.
  const trip = (location.state as { trip?: SearchResult } | null)?.trip ?? b.trip;
  // Back on the seat map with an unpaid hold ("choose other seats", browser back):
  // give those seats up now so the customer — and everyone else — can pick them
  // again, instead of waiting for the hold to time out.
  const queryClient = useQueryClient();
  // Runs before the trip binding below, which would drop the hold unreleased.
  useEffect(() => {
    const { hold, contactPhone, setHold } = useBooking.getState();
    if (!hold) return;
    setHold(undefined);
    bookingsApi
      .releaseHold(hold.bookingId, contactPhone || undefined)
      .catch(() => undefined) // best effort — the hold still expires on its own
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['availability'] }));
  }, [queryClient]);

  useEffect(() => {
    if (!trip) navigate('/', { replace: true });
  }, [trip, navigate]);
  useEffect(() => {
    // Bind the chosen operator for every trip call (X-Tenant-Id) before the seat map loads.
    if (trip && b.trip?.tripId !== trip.tripId) b.selectTrip(trip, trip.boardingStop.id, trip.droppingStop.id);
  }, [trip, b]);

  const [sel, setSel] = useState<SeatSelection>({ seats: [] });
  const [error, setError] = useState('');
  const busy = useRef(false);

  const priceOf = (seatType: string) => trip?.fares?.find((f) => f.seatType === seatType)?.priceMinor;
  const estimate = sel.seats.reduce((a, s) => a + (priceOf(s.seatType) ?? 0), 0);

  const quote = useMutation({
    mutationFn: () =>
      flowApi.quote({
        tripId: trip!.tripId,
        fromStopId: sel.fromStop!.stopId,
        toStopId: sel.toStop!.stopId,
        seatType: sel.seatType,
        seatNumbers: sel.seats.map((s) => s.seatNumber),
      }),
    onSuccess: (q) => {
      b.setSelection({
        points: {
          from: sel.fromStop!.name ?? '',
          fromAt: sel.fromStop!.departsAt,
          to: sel.toStop!.name ?? '',
          toAt: sel.toStop!.arrivesAt,
        },
        seatType: sel.seatType!,
        seatNumbers: sel.seats.map((s) => s.seatNumber),
        ladiesSeats: sel.seats.filter((s) => s.ladiesOnly).map((s) => s.seatNumber),
        quote: q,
      });
      useBooking.setState({ fromStopId: sel.fromStop!.stopId, toStopId: sel.toStop!.stopId });
      navigate('/checkout');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not price these seats — please try again'),
    onSettled: () => { busy.current = false; },
  });

  if (!trip) return null;
  const canContinue = sel.seats.length > 0 && sel.fromStop && sel.toStop && !quote.isPending;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4">
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-text">{trip.operatorName}</div>
            <div className="text-sm text-text-muted">
              {trip.seatTypes.map((t) => SEAT_TYPE_LABEL[t] ?? t).join(' · ')} ·{' '}
              {formatDateLabel(localDateOf(trip.departsAt), { weekday: 'short', day: '2-digit', month: 'short' })}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-text">
            <b>{formatTime(trip.departsAt)}</b>
            <span className="flex items-center gap-1 text-xs text-text-muted"><Clock className="h-3 w-3" />{minutesToHm(trip.durationMin)}</span>
            <ArrowRight className="h-4 w-4 text-text-muted" />
            <b>{formatTime(trip.arrivesAt)}</b>
            {trip.rating !== null && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-success px-1.5 py-0.5 text-xs font-semibold text-white">
                <Star className="h-3 w-3 fill-current" /> {trip.rating.toFixed(1)}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Choose your seats" subtitle="Tap a seat to select it; tap again to remove" />
            <CardBody>
              <SeatSelector
                tripId={trip.tripId}
                initialFromStopId={b.fromStopId ?? trip.boardingStop.id}
                initialToStopId={b.toStopId ?? trip.droppingStop.id}
                priceOf={priceOf}
                currency={trip.currency}
                onChange={(s) => { setSel(s); setError(''); }}
              />
            </CardBody>
          </Card>
        </div>

        <div>
          <Card className="sticky top-20">
            <CardHeader title="Your journey" />
            <CardBody className="flex flex-col gap-3 text-sm">
              {sel.fromStop && sel.toStop ? (
                <div className="rounded-md bg-surface-muted p-3">
                  <div className="flex justify-between"><span className="text-text-muted">Boarding</span><span className="text-right font-medium">{sel.fromStop.name}<br /><span className="text-xs text-text-muted">{formatTime(sel.fromStop.departsAt)}</span></span></div>
                  <div className="mt-2 flex justify-between"><span className="text-text-muted">Dropping</span><span className="text-right font-medium">{sel.toStop.name}<br /><span className="text-xs text-text-muted">{formatTime(sel.toStop.arrivesAt)}</span></span></div>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-text-muted">Seats</span>
                <span className="font-medium">{sel.seats.map((s) => s.seatNumber).join(', ') || '—'}</span>
              </div>
              {sel.seats.some((s) => s.ladiesOnly) && (
                <p className="rounded-md bg-pink-50 px-2 py-1.5 text-xs text-pink-700">Ladies-only seats are for female passengers — you will enter this at checkout.</p>
              )}
              {sel.seats.some((s) => s.accessible) && (
                <p className="rounded-md bg-info/10 px-2 py-1.5 text-xs text-info">Accessible seats are kept for passengers with a disability until close to departure.</p>
              )}
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <span className="font-semibold">Fare</span>
                <span className="font-semibold">{sel.seats.length ? formatMoney(estimate, trip.currency) : '—'}</span>
              </div>
              <p className="-mt-2 text-[11px] text-text-muted">Includes GST. Final price is confirmed on the next step.</p>
              <LuggageNote tripId={trip.tripId} />
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
              <Button
                fullWidth
                size="lg"
                loading={quote.isPending}
                disabled={!canContinue}
                onClick={() => {
                  if (busy.current) return;
                  busy.current = true;
                  quote.mutate();
                }}
              >
                {sel.seats.length ? `Continue with ${sel.seats.length} seat${sel.seats.length > 1 ? 's' : ''}` : 'Select seats to continue'}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
