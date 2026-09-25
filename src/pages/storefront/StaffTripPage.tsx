import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Smartphone } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, useToast } from '@/components/ui';
import { SeatSelector, type SeatSelection } from '@/components/customer/SeatSelector';
import { flowApi } from '@/lib/api/booking-flow';
import { bookingsApi } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { paymentsApi } from '@/lib/api/payments';
import type { SearchResult } from '@/lib/api/types';
import { normalizeMobile, validatePassengers, type PassengerForm } from '@/lib/checkout';
import { formatMoney } from '@/lib/utils';

/**
 * Counter sale by operator staff: seats, passengers, and the customer pays
 * by UPI through the same verified gateway charge a website customer uses —
 * there is no cash shortcut. Booked on the back-office channel.
 */
export function StaffTripPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const trip = (location.state as { trip?: SearchResult } | null)?.trip;
  useEffect(() => {
    if (!trip) navigate('/search', { replace: true });
  }, [trip, navigate]);

  const [sel, setSel] = useState<SeatSelection>({ seats: [] });
  const [forms, setForms] = useState<Record<string, PassengerForm>>({});
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [vpa, setVpa] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [confirmed, setConfirmed] = useState<{ pnr: string; bookingId: string } | null>(null);
  /** Seats held for this customer, waiting for their payment — a failed payment keeps them. */
  const [held, setHeld] = useState<{ bookingId: string; pnr: string; totalMinor: number; holdExpiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!held) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [held]);
  const inFlight = useRef(false);

  const passengers: PassengerForm[] = sel.seats.map((s) => forms[s.seatNumber] ?? { seatNumber: s.seatNumber, fullName: '', age: '', gender: '', category: 'adult', idProof: '' });
  const patch = (seat: string, p: Partial<PassengerForm>) =>
    setForms((f) => ({ ...f, [seat]: { ...(f[seat] ?? { seatNumber: seat, fullName: '', age: '', gender: '', category: 'adult', idProof: '' }), ...p } }));
  const errors = useMemo(
    () => validatePassengers(passengers, { concessions: [], ladiesSeats: sel.seats.filter((s) => s.ladiesOnly).map((s) => s.seatNumber) }),
    [passengers, sel.seats],
  );
  const mobile = normalizeMobile(phone);
  const priceOf = (t: string) => trip?.fares?.find((f) => f.seatType === t)?.priceMinor;
  const estimate = sel.seats.reduce((a, s) => a + (priceOf(s.seatType) ?? 0), 0);
  const vpaOk = /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
  const ready = sel.seats.length > 0 && Object.keys(errors).length === 0 && mobile && vpaOk;
  const secondsLeft = held ? Math.max(0, Math.round((Date.parse(held.holdExpiresAt) - now) / 1000)) : 0;

  /** Step 1: quote and hold the seats. */
  const hold = useMutation({
    mutationFn: async () => {
      const q = await flowApi.quote({
        tripId: trip!.tripId,
        fromStopId: sel.fromStop!.stopId,
        toStopId: sel.toStop!.stopId,
        seatType: sel.seatType,
        seatNumbers: sel.seats.map((s) => s.seatNumber),
      });
      const hold = await bookingsApi.hold({
        quoteId: q.quoteId,
        seatNumbers: sel.seats.map((s) => s.seatNumber),
        passengers: passengers.map((p) => ({ seatNumber: p.seatNumber, fullName: p.fullName.trim(), age: Number(p.age), gender: p.gender || undefined })),
        contactPhone: mobile!,
        contactEmail: email.trim() || undefined,
        channel: 'backoffice',
      });
      return hold;
    },
    onSuccess: (h) => { setHeld(h); pay.mutate(h.bookingId); },
    onError: (e) => { inFlight.current = false; toast.error(e instanceof ApiError ? e.message : 'Could not hold the seats'); },
  });
  /** Step 2: the customer pays by UPI; a decline keeps the seats so they can try again. */
  const pay = useMutation({
    mutationFn: (bookingId: string) => paymentsApi.chargeTest(bookingId, vpa.trim()),
    onSuccess: (res, bookingId) => { setConfirmed({ pnr: res.pnr, bookingId }); setHeld(null); toast.success('Booking confirmed'); },
    onError: (e) => toast.error(e instanceof ApiError ? `Payment failed — ${e.message}` : 'Payment failed'),
    onSettled: () => { inFlight.current = false; },
  });
  const release = useMutation({
    mutationFn: () => bookingsApi.releaseHold(held!.bookingId, mobile ?? undefined),
    onSuccess: () => { setHeld(null); pay.reset(); toast.success('Seats released'); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  useEffect(() => {
    if (held && secondsLeft === 0) { setHeld(null); pay.reset(); toast.error('The hold expired — the seats are free again. Select them once more.'); }
  }, [held, secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = hold.isPending || pay.isPending || release.isPending;

  if (!trip) return null;
  if (confirmed) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-success" />
        <h1 className="font-display text-2xl text-text">Booking confirmed</h1>
        <p className="text-text-muted">PNR <b className="text-text">{confirmed.pnr}</b> — paid by UPI. The customer gets the e-ticket by SMS/email.</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate('/search')}>Book another</Button>
          <Button onClick={() => navigate(`/bookings/${confirmed.pnr}`)}>View booking</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader title={`${trip.operatorName} — choose seats`} />
          <CardBody>
            {held && <p className="mb-3 rounded-md bg-warning/10 p-2 text-sm">Seats are held for this customer while they pay. Release them to change the selection.</p>}
            <div className={held ? 'pointer-events-none opacity-60' : undefined}><SeatSelector tripId={trip.tripId} initialFromStopId={trip.boardingStop.id} initialToStopId={trip.droppingStop.id} priceOf={priceOf} currency={trip.currency} onChange={setSel} /></div>
          </CardBody>
        </Card>
        {sel.seats.length > 0 && (
          <Card>
            <CardHeader title="Passengers" />
            <CardBody className="flex flex-col gap-3">
              {passengers.map((p, i) => (
                <div key={p.seatNumber} className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-6">
                  <div className="text-sm font-semibold sm:col-span-6">Seat {p.seatNumber}</div>
                  <div className="sm:col-span-3"><Input label="Full name" value={p.fullName} onChange={(e) => patch(p.seatNumber, { fullName: e.target.value })} error={showErrors ? errors[`${i}.fullName`] : undefined} /></div>
                  <div className="sm:col-span-1"><Input label="Age" inputMode="numeric" value={p.age} onChange={(e) => patch(p.seatNumber, { age: e.target.value.replace(/\D/g, '').slice(0, 3) })} error={showErrors ? errors[`${i}.age`] : undefined} /></div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-text" htmlFor={`g-${i}`}>Gender</label>
                    <select id={`g-${i}`} value={p.gender} onChange={(e) => patch(p.seatNumber, { gender: e.target.value as PassengerForm['gender'] })} className="h-input w-full rounded-input border border-border bg-surface px-input-x text-sm focus-ring">
                      <option value="">Choose</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                    </select>
                    {showErrors && errors[`${i}.gender`] && <p className="mt-1 text-xs text-danger">{errors[`${i}.gender`]}</p>}
                  </div>
                </div>
              ))}
              {showErrors && errors.form && <p className="text-sm text-danger">{errors.form}</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Customer mobile" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={showErrors && !mobile ? 'Enter a 10-digit mobile' : undefined} />
                <Input label="Customer email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader title="Payment" subtitle="Customer pays by UPI" />
        <CardBody className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between"><span className="text-text-muted">Seats</span><span className="font-medium">{sel.seats.map((s) => s.seatNumber).join(', ') || '—'}</span></div>
          <div className="flex justify-between"><span className="text-text-muted">{held ? 'To pay' : 'Estimated fare'}</span><span className="font-semibold">{held ? formatMoney(held.totalMinor, trip.currency) : sel.seats.length ? formatMoney(estimate, trip.currency) : '—'}</span></div>
          {held && <div className="flex justify-between"><span className="text-text-muted">Held for</span><span className={secondsLeft < 60 ? 'font-semibold text-danger' : 'font-medium'}>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span></div>}
          <Input label="Customer UPI ID" value={vpa} onChange={(e) => setVpa(e.target.value)} leftIcon={<Smartphone className="h-4 w-4" />} placeholder="name@bank" error={showErrors && !vpaOk ? 'Enter a UPI ID like name@bank' : undefined} disabled={pay.isPending} />
          {pay.isError && <p className="text-xs text-danger" role="alert">{pay.error instanceof ApiError ? pay.error.message : 'Payment failed'} — the seats are still held. Try again, or release them.</p>}
          {held ? (
            <>
              <Button fullWidth loading={pay.isPending} disabled={busy || !vpaOk} onClick={() => { setShowErrors(true); if (!vpaOk || inFlight.current) return; inFlight.current = true; pay.mutate(held.bookingId); }}>
                {pay.isError ? 'Try the payment again' : 'Take payment'}
              </Button>
              <Button fullWidth variant="ghost" loading={release.isPending} disabled={busy} onClick={() => release.mutate()}>Release seats</Button>
            </>
          ) : (
            <Button
              fullWidth
              loading={hold.isPending || pay.isPending}
              disabled={sel.seats.length === 0 || busy}
              onClick={() => {
                setShowErrors(true);
                if (!ready || inFlight.current) return;
                inFlight.current = true;
                hold.mutate();
              }}
            >
              Confirm booking
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
