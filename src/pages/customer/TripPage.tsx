import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Armchair, Loader2 } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Select, PageLoader, ErrorState, useToast } from '@/components/ui';
import { flowApi, type SeatCell } from '@/lib/api/booking-flow';
import type { SearchResult } from '@/lib/api/types';
import { useBooking } from '@/stores/booking';
import { formatMoney } from '@/lib/utils';

export function TripPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const b = useBooking();
  const trip = (location.state as { trip?: SearchResult } | null)?.trip;
  // The trip's own UUID never appears in the URL — it travels only in
  // React Router's in-memory navigation state, set by whoever navigated
  // here (ResultsPage, ConnectingResultsPage). Landing on /trip directly
  // (a refresh, a bookmark, a shared link) has no trip to show — there is
  // no URL-based fallback to resolve one from, by design.
  const tripId = trip?.tripId ?? '';
  useEffect(() => {
    if (!tripId) navigate('/results', { replace: true });
  }, [tripId, navigate]);

  const detail = useQuery({ queryKey: ['trip', tripId], queryFn: () => flowApi.trip(tripId), enabled: Boolean(tripId) });
  const stops: any[] = detail.data?.stops ?? [];

  const [fromStopId, setFromStopId] = useState('');
  const [toStopId, setToStopId] = useState('');
  useEffect(() => {
    if (stops.length >= 2 && !fromStopId) {
      setFromStopId(stops[0].id ?? stops[0].stopId ?? '');
      setToStopId(stops[stops.length - 1].id ?? stops[stops.length - 1].stopId ?? '');
    }
  }, [stops, fromStopId]);

  const avail = useQuery({
    queryKey: ['availability', tripId, fromStopId, toStopId],
    queryFn: () => flowApi.availability(tripId, fromStopId, toStopId),
    enabled: Boolean(tripId && fromStopId && toStopId),
  });

  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (s: SeatCell) => {
    if (!s.available) return;
    setSelected((cur) => cur.includes(s.seatNumber) ? cur.filter((x) => x !== s.seatNumber) : cur.length >= 6 ? cur : [...cur, s.seatNumber]);
  };

  const quote = useMutation({
    mutationFn: () => flowApi.quote({ tripId, fromStopId, toStopId, seatType: 'seater', seatNumbers: selected }),
    onSuccess: (q) => {
      b.selectTrip(trip ?? ({ tripId } as SearchResult), fromStopId, toStopId);
      b.setSeats(selected);
      b.setQuote(q);
      navigate('/checkout');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not price these seats'),
  });

  const stopOptions = useMemo(() => stops.map((s) => ({ label: s.name ?? s.stopName ?? 'Stop', value: s.id ?? s.stopId ?? '' })), [stops]);

  if (detail.isLoading) return <div className="mx-auto max-w-4xl px-4 py-8"><PageLoader /></div>;
  if (detail.isError) return <div className="mx-auto max-w-4xl px-4 py-8"><ErrorState error={detail.error} onRetry={detail.refetch} /></div>;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Choose your seats" subtitle="Green seats are available" />
            <CardBody>
              {stopOptions.length >= 2 && (
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <Select label="Boarding" value={fromStopId} onChange={(e) => setFromStopId(e.target.value)} options={stopOptions} />
                  <Select label="Dropping" value={toStopId} onChange={(e) => setToStopId(e.target.value)} options={stopOptions} />
                </div>
              )}
              {avail.isLoading ? <PageLoader /> : avail.isError ? <ErrorState error={avail.error} onRetry={avail.refetch} /> : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(avail.data?.seats ?? []).map((s) => {
                      const isSel = selected.includes(s.seatNumber);
                      return (
                        <button
                          key={s.seatNumber}
                          onClick={() => toggle(s)}
                          disabled={!s.available}
                          title={s.seatNumber}
                          className={[
                            'flex h-11 w-11 items-center justify-center rounded-md border text-xs font-medium transition',
                            !s.available ? 'cursor-not-allowed border-border bg-surface-muted text-text-muted/50'
                              : isSel ? 'border-primary bg-primary text-primary-fg'
                              : 'border-success/40 bg-success/10 text-success hover:border-success',
                          ].join(' ')}
                        >
                          <Armchair className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex gap-4 text-xs text-text-muted">
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-success/20 ring-1 ring-success/40" /> Available</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-primary" /> Selected</span>
                    <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-surface-muted" /> Booked</span>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <CardHeader title="Summary" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Seats</span><span className="font-medium">{selected.join(', ') || '—'}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Count</span><span className="font-medium">{selected.length}</span></div>
              {trip?.fromPriceMinor ? (
                <div className="flex justify-between"><span className="text-text-muted">From</span><span className="font-medium">{formatMoney(trip.fromPriceMinor, trip.currency)}/seat</span></div>
              ) : null}
              <Button className="mt-2" fullWidth disabled={selected.length === 0 || quote.isPending} onClick={() => quote.mutate()}>
                {quote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Continue'}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
