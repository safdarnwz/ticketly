import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Armchair, Smartphone, CheckCircle2 } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Select, Input, PageLoader, ErrorState, useToast } from '@/components/ui';
import { flowApi, type SeatCell } from '@/lib/api/booking-flow';
import { bookingsApi } from '@/lib/api/bookings';
import { paymentsApi } from '@/lib/api/payments';
import type { SearchResult } from '@/lib/api/types';
import { formatMoney } from '@/lib/utils';

export function StaffTripPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const trip = (location.state as { trip?: SearchResult } | null)?.trip;
  // Same reasoning as the customer TripPage: the trip's UUID travels only
  // in navigation state, never the URL. Landing here directly (refresh,
  // bookmark) has nothing to resolve a trip from, by design.
  const tripId = trip?.tripId ?? '';
  useEffect(() => {
    if (!tripId) navigate('/search', { replace: true });
  }, [tripId, navigate]);
  const inFlight = useRef(false);

  // Staff-assisted sale — the customer pays via UPI at the counter, staff
  // enters their VPA, and it goes through the SAME verified sandbox-gateway
  // charge a self-service customer would use. No cash-shortcut anywhere.
  const [customerVpa, setCustomerVpa] = useState('');

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

  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [passengers, setPassengers] = useState<Record<string, { fullName: string; age: string; gender: 'male' | 'female' | 'other' }>>({});
  const setPassenger = (seat: string, patch: Partial<{ fullName: string; age: string; gender: 'male' | 'female' | 'other' }>) =>
    setPassengers((p) => ({ ...p, [seat]: { fullName: '', age: '', gender: 'male', ...p[seat], ...patch } }));

  const [confirmedPnr, setConfirmedPnr] = useState<string | null>(null);

  const quote = useQuery({
    queryKey: ['staff-quote', tripId, fromStopId, toStopId, selected.join(',')],
    queryFn: () => flowApi.quote({ tripId, fromStopId, toStopId, seatType: 'seater', seatNumbers: selected }),
    enabled: selected.length > 0 && !!fromStopId && !!toStopId,
  });

  const canConfirm = selected.length > 0 && contactPhone.trim().length >= 6
    && selected.every((s) => passengers[s]?.fullName?.trim() && passengers[s]?.age)
    && customerVpa.trim().length >= 3;

  const confirm = useMutation({
    mutationFn: async () => {
      const hold = await bookingsApi.hold({
        quoteId: quote.data!.quoteId, seatNumbers: selected,
        passengers: selected.map((s) => ({ seatNumber: s, fullName: passengers[s].fullName.trim(), age: Number(passengers[s].age), gender: passengers[s].gender })),
        contactPhone: contactPhone.trim(), contactEmail: contactEmail.trim() || undefined,
      });
      return paymentsApi.chargeTest(hold.bookingId, customerVpa.trim());
    },
    onSuccess: (res) => { setConfirmedPnr(res.pnr); toast.success('Booking confirmed'); },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Could not complete booking'); inFlight.current = false; },
  });
  const handleConfirm = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    confirm.mutate();
  };

  const stopOptions = useMemo(() => stops.map((s) => ({ label: s.name ?? s.stopName ?? 'Stop', value: s.id ?? s.stopId ?? '' })), [stops]);

  if (detail.isLoading) return <div className="mx-auto max-w-4xl px-4 py-8"><PageLoader /></div>;
  if (detail.isError) return <div className="mx-auto max-w-4xl px-4 py-8"><ErrorState error={detail.error} onRetry={detail.refetch} /></div>;

  if (confirmedPnr) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-success" />
        <h1 className="font-display text-2xl text-text">Booking confirmed</h1>
        <p className="text-text-muted">PNR <b className="text-text">{confirmedPnr}</b> — paid via UPI.</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate('/search')}>Book another</Button>
          <Button onClick={() => navigate(`/bookings/${confirmedPnr}`)}>View booking</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card>
            <CardHeader title="Choose seats" subtitle="Green seats are available" />
            <CardBody>
              {stopOptions.length >= 2 && (
                <div className="mb-4 grid grid-cols-2 gap-3">
                  <Select label="Boarding" value={fromStopId} onChange={(e) => setFromStopId(e.target.value)} options={stopOptions} />
                  <Select label="Dropping" value={toStopId} onChange={(e) => setToStopId(e.target.value)} options={stopOptions} />
                </div>
              )}
              {avail.isLoading ? <PageLoader /> : avail.isError ? <ErrorState error={avail.error} onRetry={avail.refetch} /> : (
                <div className="flex flex-wrap gap-2">
                  {(avail.data?.seats ?? []).map((s) => {
                    const isSel = selected.includes(s.seatNumber);
                    return (
                      <button key={s.seatNumber} onClick={() => toggle(s)} disabled={!s.available} title={s.seatNumber}
                        className={[
                          'flex h-11 w-11 items-center justify-center rounded-md border text-xs font-medium transition',
                          !s.available ? 'cursor-not-allowed border-border bg-surface-muted text-text-muted/50'
                            : isSel ? 'border-primary bg-primary text-primary-fg'
                            : 'border-success/40 bg-success/10 text-success hover:border-success',
                        ].join(' ')}>
                        <Armchair className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {selected.length > 0 && (
            <Card>
              <CardHeader title="Passenger & contact details" />
              <CardBody className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="9876543210" />
                  <Input label="Contact email (optional)" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                </div>
                <Input label="Customer's UPI ID" value={customerVpa} onChange={(e) => setCustomerVpa(e.target.value)} placeholder="customer@upi" hint="Charged live — enter the VPA the customer wants to pay from" />
                {selected.map((s) => (
                  <div key={s} className="grid grid-cols-3 gap-3 rounded-md border border-border p-3">
                    <Input label={`Seat ${s} — name`} value={passengers[s]?.fullName ?? ''} onChange={(e) => setPassenger(s, { fullName: e.target.value })} />
                    <Input label="Age" type="number" value={passengers[s]?.age ?? ''} onChange={(e) => setPassenger(s, { age: e.target.value })} />
                    <Select label="Gender" value={passengers[s]?.gender ?? 'male'} onChange={(e) => setPassenger(s, { gender: e.target.value as any })}
                      options={[{ label: 'Male', value: 'male' }, { label: 'Female', value: 'female' }, { label: 'Other', value: 'other' }]} />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <CardHeader title="Summary" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Seats</span><span className="font-medium">{selected.join(', ') || '—'}</span></div>
              {quote.data && (
                <>
                  {quote.data.seatFares?.map((f) => (
                    <div key={f.seatNumber} className="flex justify-between text-xs text-text-muted"><span>Seat {f.seatNumber}</span><span>{formatMoney(f.totalMinor, quote.data.currency)}</span></div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-2 font-semibold text-text"><span>Total</span><span>{formatMoney(quote.data.totalMinor, quote.data.currency)}</span></div>
                </>
              )}
              <Button className="mt-2" fullWidth loading={confirm.isPending} disabled={!canConfirm || !quote.data} leftIcon={<Smartphone className="h-4 w-4" />} onClick={handleConfirm}>
                Charge via UPI
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
