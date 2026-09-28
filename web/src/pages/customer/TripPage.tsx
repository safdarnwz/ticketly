import { useEffect, useRef, useState } from 'react';
import { BusDetails } from '@/components/customer/BusDetails';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Star } from 'lucide-react';

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
  // Pickup / drop charges at the chosen points: per seat, before GST.
  const pointCharge = (sel.fromStop?.boardChargeMinor ?? 0) + (sel.toStop?.dropChargeMinor ?? 0);
  const estimate = sel.seats.reduce((a, s) => a + (priceOf(s.seatType) ?? 0) + pointCharge, 0);

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
      {/* Trip header: operator and date, then the journey as a timeline. */}
      <section className="mb-5 flex flex-col gap-4 rounded-[20px] border border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-xl font-semibold tracking-tight text-text">{trip.operatorName}</span>
            {trip.rating !== null && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface-muted px-2 py-0.5 text-xs text-text">
                <Star className="h-3 w-3 fill-current text-accent" /> {trip.rating.toFixed(1)}
              </span>
            )}
          </div>
          <div className="text-sm text-text-muted">
            {trip.seatTypes.map((t) => SEAT_TYPE_LABEL[t] ?? t).join(' · ')} ·{' '}
            {formatDateLabel(localDateOf(trip.departsAt), { weekday: 'long', day: '2-digit', month: 'short' })}
          </div>
        </div>
        <div className="min-w-0 rounded-2xl bg-surface-muted px-4 py-3 sm:w-[380px]">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tabular-nums text-text">{formatTime(trip.departsAt)}</span>
            <span className="flex flex-1 items-center gap-2 text-xs text-text-muted">
              <span className="h-px flex-1 bg-border" /><Clock className="h-3.5 w-3.5" />{minutesToHm(trip.durationMin)}<span className="h-px flex-1 bg-border" />
            </span>
            <span className="text-lg font-semibold tabular-nums text-text">{formatTime(trip.arrivesAt)}</span>
          </div>
          <div className="mt-0.5 flex justify-between gap-4 text-xs text-text-muted">
            <span className="min-w-0 truncate">{trip.boardingStop.name}</span>
            <span className="min-w-0 truncate text-right">{trip.droppingStop.name}</span>
          </div>
        </div>
      </section>

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
          <div className="mt-6">
            <BusDetails tripId={trip.tripId} tenantId={trip.tenantId} fromStopId={sel.fromStop?.stopId ?? b.fromStopId ?? trip.boardingStop.id} toStopId={sel.toStop?.stopId ?? b.toStopId ?? trip.droppingStop.id} />
          </div>
        </div>

        <div>
          <Card className="sticky top-20" id="journey-summary">
            <CardHeader title="Your journey" />
            <CardBody className="flex flex-col gap-3 text-sm">
              {sel.fromStop && sel.toStop ? (
                <div className="rounded-2xl bg-surface-muted p-3">
                  <div className="flex justify-between"><span className="text-text-muted">Boarding</span><span className="text-right font-medium">{sel.fromStop.name}<br /><span className="text-xs text-text-muted">{formatTime(sel.fromStop.departsAt)}</span></span></div>
                  <div className="mt-2 flex justify-between"><span className="text-text-muted">Dropping</span><span className="text-right font-medium">{sel.toStop.name}<br /><span className="text-xs text-text-muted">{formatTime(sel.toStop.arrivesAt)}</span></span></div>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-text-muted">Seats</span>
                <span className="font-medium">{sel.seats.map((s) => s.seatNumber).join(', ') || '—'}</span>
              </div>
              {sel.seats.some((s) => s.ladiesOnly) && (
                <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">Ladies-only seats are for female passengers — you will enter this at checkout.</p>
              )}
              {sel.seats.some((s) => s.accessible) && (
                <p className="rounded-md bg-info/10 px-2 py-1.5 text-xs text-info">Accessible seats are kept for passengers with a disability until close to departure.</p>
              )}
              {pointCharge > 0 && sel.seats.length > 0 && (
                <div className="flex justify-between"><span className="text-text-muted">Pickup / drop charges (+ GST)</span><span className="font-medium">{sel.seats.length} × {formatMoney(pointCharge, trip.currency)}</span></div>
              )}
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <span className="font-semibold">Fare</span>
                <span className="font-display text-xl text-price">{sel.seats.length ? formatMoney(estimate, trip.currency) : '—'}</span>
              </div>
              <p className="-mt-2 text-xs text-text-muted">Includes GST. Final price is confirmed on the next step.</p>
              <LuggageNote tripId={trip.tripId} />
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
              <Button
                fullWidth
                size="lg"
                className="rounded-pill"
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
      {/* Phones: a bar above the tab bar with the seats, the fare and Continue. */}
      {sel.seats.length > 0 && (
        <div className="fixed inset-x-4 bottom-[88px] sm:bottom-4 z-40 flex items-center gap-3 rounded-[28px] bg-primary py-2.5 pl-5 pr-2.5 text-primary-fg shadow-lg lg:hidden">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs opacity-80">Seat{sel.seats.length > 1 ? 's' : ''} {sel.seats.map((s) => s.seatNumber).join(', ')}</div>
            <div className="font-display text-lg">{formatMoney(estimate, trip.currency)}</div>
          </div>
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              quote.mutate();
            }}
            className="rounded-pill bg-white px-5 py-2.5 text-sm font-medium text-text disabled:opacity-60"
          >
            {quote.isPending ? 'Pricing…' : 'Continue'}
          </button>
        </div>
      )}
      {error && sel.seats.length > 0 && <p role="alert" className="fixed inset-x-4 bottom-[164px] sm:bottom-[88px] z-40 rounded-2xl bg-danger px-4 py-2 text-xs text-white shadow-md lg:hidden">{error}</p>}
    </div>
  );
}
