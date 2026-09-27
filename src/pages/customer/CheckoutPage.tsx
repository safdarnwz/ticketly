import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, Mail, Minus, Phone, Plus, ShieldCheck, Tag, X } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, Skeleton, useToast } from '@/components/ui';
import { CheckoutSignIn } from '@/components/customer/CheckoutSignIn';
import { HoldTimer } from '@/components/customer/HoldTimer';
import { PaymentMethodForm } from '@/components/customer/PaymentMethodForm';
import { bookingsApi } from '@/lib/api/bookings';
import { flowApi, type Ancillary } from '@/lib/api/booking-flow';
import { ApiError } from '@/lib/api/client';
import { legalApi } from '@/lib/api/legal';
import { openRazorpayCheckout, paymentsApi, type ChargeInstrument } from '@/lib/api/payments';
import {
  CATEGORY_LABEL,
  isEmail,
  normalizeMobile,
  validatePassengers,
  type Category,
  type PassengerForm,
} from '@/lib/checkout';
import { useAuth } from '@/stores/auth';
import { useBooking } from '@/stores/booking';
import { SEAT_TYPE_LABEL, cn, formatDateLabel, formatMoney, formatTime, localDateOf } from '@/lib/utils';

const QUOTE_MARGIN_MS = 30_000;

export function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const b = useBooking();
  const token = useAuth((s) => s.token);
  const trip = b.trip;
  const quote = b.quote;

  useEffect(() => {
    if (!trip || !quote || b.seatNumbers.length === 0) navigate('/', { replace: true });
  }, [trip, quote, b.seatNumbers.length, navigate]);

  const journeyDate = trip ? localDateOf(trip.departsAt) : undefined;
  const rules = useQuery({ queryKey: ['concessions', trip?.tenantId, journeyDate], queryFn: () => flowApi.concessions(journeyDate), enabled: Boolean(trip) });
  const legal = useQuery({ queryKey: ['legal-pages'], queryFn: legalApi.list, staleTime: 10 * 60_000 });

  // ── details ───────────────────────────────────────────────────────────
  const [passengers, setPassengers] = useState<PassengerForm[]>(() =>
    b.seatNumbers.map((seatNumber) => {
      const prev = b.passengers.find((p) => p.seatNumber === seatNumber);
      return {
        seatNumber,
        fullName: prev?.fullName ?? '',
        age: prev?.age ? String(prev.age) : '',
        gender: (prev?.gender as PassengerForm['gender']) ?? '',
        category: 'adult',
        idProof: '',
      };
    }),
  );
  const [mobile, setMobile] = useState(b.contactPhone);
  const [email, setEmail] = useState(b.contactEmail || useAuth.getState().user?.email || '');
  const [showErrors, setShowErrors] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [coupon, setCoupon] = useState(quote?.couponCode ?? '');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState<{ text: string; reselect?: boolean } | null>(null);

  const concessions = useMemo(() => rules.data?.concessions ?? [], [rules.data]);
  const errors = useMemo(
    () => validatePassengers(passengers, { concessions, policy: rules.data?.policy, ladiesSeats: b.ladiesSeats ?? [] }),
    [passengers, concessions, rules.data?.policy, b.ladiesSeats],
  );
  const mobileOk = normalizeMobile(mobile);
  const contactErrors: Record<string, string> = {};
  if (!mobileOk) contactErrors.mobile = 'Enter a 10-digit Indian mobile number';
  if (email.trim() && !isEmail(email)) contactErrors.email = 'Enter a valid email or leave it empty';
  const detailsValid = Object.keys(errors).length === 0 && Object.keys(contactErrors).length === 0;
  const showErr = (k: string) => (showErrors ? errors[k] : undefined);
  const patch = (i: number, p: Partial<PassengerForm>) => setPassengers((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const requote = useCallback(async (couponCode?: string) => {
    const q = await flowApi.quote({
      tripId: trip!.tripId,
      fromStopId: b.fromStopId!,
      toStopId: b.toStopId!,
      seatType: b.seatType,
      seatNumbers: b.seatNumbers,
      couponCode: couponCode || undefined,
    });
    b.setQuote(q);
    return q;
  }, [trip, b]);

  const applyCoupon = async (code: string) => {
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      // The saving is measured against the price without any coupon.
      const withoutCoupon = (quote?.totalMinor ?? 0) + (b.couponSavingMinor ?? 0);
      const q = await requote(code.trim().toUpperCase());
      const saved = code ? Math.max(0, withoutCoupon - q.totalMinor) : 0;
      useBooking.setState({ couponSavingMinor: saved });
      setCouponMsg(code ? { ok: true, text: saved > 0 ? `Applied — you save ${formatMoney(saved, q.currency)}` : 'Applied' } : null);
    } catch (e) {
      setCouponMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not apply this code' });
      await requote().catch(() => undefined);
      useBooking.setState({ couponSavingMinor: 0 });
    } finally {
      setCouponBusy(false);
    }
  };

  const holdSeats = async (fallbackEmail?: string) => {
    setShowErrors(true);
    if (!detailsValid) {
      document.querySelector('[aria-invalid="true"], .text-danger')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Read the live session: this also runs right after signing in, before a re-render.
    if (!useAuth.getState().token) { setSigningIn(true); return; }
    if (holding) return;
    setHolding(true);
    setHoldError(null);
    const body = (quoteId: string) => ({
      quoteId,
      seatNumbers: b.seatNumbers,
      passengers: passengers.map((p) => ({
        seatNumber: p.seatNumber,
        fullName: p.fullName.trim().replace(/\s+/g, ' '),
        age: Number(p.age),
        gender: p.gender || undefined,
        category: p.category === 'adult' ? undefined : p.category,
        idProof: p.idProof.trim() || undefined,
      })),
      contactPhone: mobileOk!,
      contactEmail: email.trim() || fallbackEmail || undefined,
    });
    try {
      // A quote lives a few minutes; refresh it rather than fail the hold.
      let q = quote!;
      if (Date.parse(q.expiresAt) - Date.now() < QUOTE_MARGIN_MS) q = await requote(q.couponCode ?? undefined);
      let hold;
      try {
        hold = await bookingsApi.hold(body(q.quoteId));
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'PRICING.QUOTE_EXPIRED')) throw e;
        q = await requote(q.couponCode ?? undefined);
        hold = await bookingsApi.hold(body(q.quoteId));
      }
      b.setPassengers(passengers.map((p) => ({ seatNumber: p.seatNumber, fullName: p.fullName.trim(), age: Number(p.age), gender: p.gender })));
      b.setContact(email.trim() || fallbackEmail || '', mobileOk!);
      b.setHold(hold);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setHoldError({
        text: e instanceof ApiError ? e.message : 'Could not hold your seats — please try again',
        reselect: ['INVENTORY.SEAT_UNAVAILABLE', 'INVENTORY.HOLD_EXPIRED', 'INVENTORY.TRIP_CLOSED'].includes(code),
      });
    } finally {
      setHolding(false);
    }
  };

  // ── payment step ──────────────────────────────────────────────────────
  const hold = b.hold;
  const [expired, setExpired] = useState(() => Boolean(hold && Date.parse(hold.holdExpiresAt) <= Date.now()));
  const addonCatalogue = useQuery({ queryKey: ['ancillaries', trip?.tenantId], queryFn: flowApi.ancillaries, enabled: Boolean(hold) });
  const addons = hold?.addons ?? {};
  const addonTotal = hold?.addonTotalMinor ?? 0;
  const [addonBusy, setAddonBusy] = useState(false);
  const addonSeq = useRef(0);
  const [instrument, setInstrument] = useState<ChargeInstrument | null>(null);
  const [terms, setTerms] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const inFlight = useRef(false);
  const testMode = useQuery({ queryKey: ['test-methods'], queryFn: paymentsApi.testMethods, staleTime: 60_000, enabled: Boolean(hold) });
  const realGateway = testMode.data && !testMode.data.testMode;

  const onExpire = useCallback(() => setExpired(true), []);

  const changeAddon = (a: Ancillary, qty: number) => {
    const before = { ...addons };
    const next = { ...addons };
    if (qty <= 0) delete next[a.id];
    else next[a.id] = qty;
    b.setHold({ ...hold!, addons: next });
    const seq = ++addonSeq.current;
    setAddonBusy(true);
    setPayError('');
    flowApi
      .setAncillaries(hold!.bookingId, Object.entries(next).map(([ancillaryId, quantity]) => ({ ancillaryId, quantity })))
      .then((r) => {
        if (seq !== addonSeq.current) return; // a newer change is on its way
        const cur = useBooking.getState().hold;
        if (cur) b.setHold({ ...cur, addons: next, addonTotalMinor: r.totalMinor, payableMinor: r.bookingTotalMinor });
      })
      .catch((e) => {
        if (seq !== addonSeq.current) return;
        toast.error(e instanceof ApiError ? e.message : 'Could not update add-ons');
        const cur = useBooking.getState().hold;
        if (cur) b.setHold({ ...cur, addons: before });
      })
      .finally(() => { if (seq === addonSeq.current) setAddonBusy(false); });
  };

  const payable = hold?.payableMinor ?? hold?.totalMinor ?? 0;
  const currency = quote?.currency ?? 'INR';

  const pay = async () => {
    if (!hold || inFlight.current) return;
    inFlight.current = true;
    setPaying(true);
    setPayError('');
    try {
      let pnr: string;
      if (realGateway) {
        const intent = await paymentsApi.createIntent(hold.bookingId, payable);
        const callback = await openRazorpayCheckout(intent.clientPayload);
        pnr = (await paymentsApi.verify(hold.bookingId, callback)).pnr;
      } else {
        if (!instrument) return;
        const attempt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        pnr = (await paymentsApi.charge(hold.bookingId, instrument, attempt)).pnr;
      }
      b.setConfirmed(hold.bookingId, pnr);
      b.setHold(undefined);
      toast.success('Payment successful — your ticket is booked');
      navigate('/confirmation', { replace: true });
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Payment could not be completed');
    } finally {
      inFlight.current = false;
      setPaying(false);
    }
  };

  // The seat page releases the hold (if any) as it opens.
  const reselect = () => {
    navigate('/trip', { state: { trip } });
  };

  if (!trip || !quote) return null;
  const seatCount = b.seatNumbers.length;
  const discount = b.couponSavingMinor ?? 0;

  const summary = (
    <Card className="lg:sticky lg:top-20">
      <CardHeader title="Booking summary" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div>
          <div className="font-display text-base text-text">{trip.operatorName}</div>
          <div className="text-xs text-text-muted">
            {formatDateLabel(localDateOf(trip.departsAt), { weekday: 'short', day: '2-digit', month: 'short' })} · {SEAT_TYPE_LABEL[b.seatType ?? ''] ?? b.seatType}
          </div>
        </div>
        {b.points && (
          <div className="flex gap-3 rounded-2xl bg-surface-muted p-3 text-xs">
            <div className="flex flex-col items-center py-0.5"><span className="dot-from !h-2.5 !w-2.5" /><span className="dot-line my-0.5 flex-1" /><span className="dot-to !h-2.5 !w-2.5" /></div>
            <div className="flex flex-col gap-2">
              <div><b className="text-sm">{formatTime(b.points.fromAt)}</b> <span className="text-text-muted">{b.points.from}</span></div>
              <div><b className="text-sm">{formatTime(b.points.toAt)}</b> <span className="text-text-muted">{b.points.to}</span></div>
            </div>
          </div>
        )}
        <div className="flex justify-between"><span className="text-text-muted">Seats</span><span className="font-medium">{b.seatNumbers.join(', ')}</span></div>
        <div className="flex justify-between"><span className="text-text-muted">Fare ({seatCount} × incl. GST)</span><span>{formatMoney(quote.totalMinor + discount, currency)}</span></div>
        {discount > 0 && <div className="flex justify-between text-success"><span>Coupon {quote.couponCode}</span><span>− {formatMoney(discount, currency)}</span></div>}
        {hold && hold.totalMinor !== quote.totalMinor && (
          <div className="flex justify-between text-success"><span>Concessions</span><span>− {formatMoney(quote.totalMinor - hold.totalMinor, currency)}</span></div>
        )}
        {addonTotal > 0 && <div className="flex justify-between"><span className="text-text-muted">Add-ons (incl. GST)</span><span>{formatMoney(addonTotal, currency)}</span></div>}
        <div className="flex items-baseline justify-between border-t border-border pt-3 text-base font-semibold">
          <span>{hold ? 'Total to pay' : 'Estimated total'}</span>
          <span className="font-display text-xl text-price">{formatMoney(hold ? payable : quote.totalMinor, currency)}</span>
        </div>
      </CardBody>
    </Card>
  );

  // ── expired hold ──────────────────────────────────────────────────────
  if (hold && expired) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <Card><CardBody className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-lg font-semibold text-text">Your seat hold has expired</h1>
          <p className="text-sm text-text-muted">The seats were released so others can book them. Nothing was charged. Pick your seats again to continue.</p>
          <Button onClick={reselect}>Choose seats again</Button>
        </CardBody></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4">
      <ol className="mb-5 grid grid-cols-3 gap-2 text-[11px] font-semibold sm:text-xs" aria-label="Checkout steps">
        <li>
          {/* Going back gives up the hold (the seat page releases it). Not while a payment is in flight. */}
          <button type="button" onClick={reselect} disabled={paying} className="flex w-full flex-col gap-1.5 text-left text-text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50">
            <span className="h-1.5 rounded-pill bg-accent" />Seats · change
          </button>
        </li>
        <li className={cn('flex flex-col gap-1.5', !hold ? 'text-text' : 'text-text-muted')} aria-current={!hold ? 'step' : undefined}>
          <span className="h-1.5 rounded-pill bg-accent" />Passengers
        </li>
        <li className={cn('flex flex-col gap-1.5', hold ? 'text-text' : 'text-text-muted')} aria-current={hold ? 'step' : undefined}>
          <span className={cn('h-1.5 rounded-pill', hold ? 'bg-accent' : 'bg-border')} />Add-ons & payment
        </li>
      </ol>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {!hold ? (
            <>
              <Card>
                <CardHeader title="Passenger details" subtitle="As on a government photo ID" />
                <CardBody className="flex flex-col gap-4">
                  {rules.isLoading ? <Skeleton className="h-32" /> : passengers.map((p, i) => {
                    const rule = concessions.find((c) => c.category === p.category);
                    return (
                      <div key={p.seatNumber} className="rounded-2xl bg-surface-muted/60 p-4">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-semibold text-text">Passenger {i + 1} · Seat {p.seatNumber}</span>
                          {(b.ladiesSeats ?? []).includes(p.seatNumber) && <span className="rounded-pill bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">Ladies seat</span>}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
                          <div className="sm:col-span-3">
                            <Input label="Full name" autoComplete="name" value={p.fullName} onChange={(e) => patch(i, { fullName: e.target.value })} error={showErr(`${i}.fullName`)} aria-invalid={Boolean(showErr(`${i}.fullName`))} />
                          </div>
                          <div className="sm:col-span-1">
                            <Input label="Age" inputMode="numeric" value={p.age} onChange={(e) => patch(i, { age: e.target.value.replace(/\D/g, '').slice(0, 3) })} error={showErr(`${i}.age`)} aria-invalid={Boolean(showErr(`${i}.age`))} />
                          </div>
                          <div className="sm:col-span-2">
                            <span className="mb-1.5 block text-sm font-medium text-text">Gender</span>
                            <div className="flex gap-1" role="radiogroup" aria-label={`Gender of passenger ${i + 1}`}>
                              {(['male', 'female', 'other'] as const).map((g) => (
                                <button key={g} type="button" role="radio" aria-checked={p.gender === g} onClick={() => patch(i, { gender: g })}
                                  className={cn('h-input flex-1 rounded-input border text-xs capitalize', p.gender === g ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text hover:bg-surface-muted')}>
                                  {g}
                                </button>
                              ))}
                            </div>
                            {showErr(`${i}.gender`) && <p className="mt-1 text-xs text-danger">{showErr(`${i}.gender`)}</p>}
                          </div>
                          {concessions.length > 0 && (
                            <div className="sm:col-span-3">
                              <label className="mb-1.5 block text-sm font-medium text-text" htmlFor={`cat-${i}`}>Concession</label>
                              <select id={`cat-${i}`} value={p.category} onChange={(e) => patch(i, { category: e.target.value as Category })}
                                className="h-input w-full rounded-input border border-border bg-surface px-input-x text-sm focus-ring">
                                <option value="adult">None (adult)</option>
                                {concessions.map((c) => (
                                  <option key={c.category} value={c.category}>{CATEGORY_LABEL[c.category] ?? c.category} — {c.discountPct}% off</option>
                                ))}
                              </select>
                              {showErr(`${i}.category`) && <p className="mt-1 text-xs text-danger">{showErr(`${i}.category`)}</p>}
                            </div>
                          )}
                          {rule?.requiresIdProof && (
                            <div className="sm:col-span-3">
                              <Input label="ID number (shown at boarding)" value={p.idProof} onChange={(e) => patch(i, { idProof: e.target.value.slice(0, 40) })} error={showErr(`${i}.idProof`)} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {showErrors && errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Contact details" subtitle="Your ticket and updates are sent here" />
                <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label="Mobile number" inputMode="tel" autoComplete="tel" value={mobile} onChange={(e) => setMobile(e.target.value.slice(0, 16))} leftIcon={<Phone className="h-4 w-4" />} placeholder="98xxxxxxxx" error={showErrors ? contactErrors.mobile : undefined} />
                  <Input label="Email (optional)" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} leftIcon={<Mail className="h-4 w-4" />} error={showErrors ? contactErrors.email : undefined} />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Offers" />
                <CardBody>
                  {quote.couponCode ? (
                    <div className="flex items-center justify-between rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                      <span className="flex items-center gap-2"><Tag className="h-4 w-4" /> {quote.couponCode} applied</span>
                      <button type="button" onClick={() => { setCoupon(''); void applyCoupon(''); }} disabled={couponBusy} aria-label="Remove coupon"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (coupon.trim()) void applyCoupon(coupon); }}>
                      <div className="flex-1"><Input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 40))} leftIcon={<Tag className="h-4 w-4" />} aria-label="Coupon code" /></div>
                      <Button type="submit" variant="outline" loading={couponBusy} disabled={!coupon.trim()}>Apply</Button>
                    </form>
                  )}
                  {couponMsg && <p className={cn('mt-2 text-xs', couponMsg.ok ? 'text-success' : 'text-danger')}>{couponMsg.text}</p>}
                </CardBody>
              </Card>

              {signingIn && !token && mobileOk && (
                <Card>
                  <CardHeader title="Sign in to continue" subtitle="Your ticket is kept in your Ticketly account" />
                  <CardBody><CheckoutSignIn mobile={mobileOk} onDone={(signedUpEmail) => {
                    setSigningIn(false);
                    if (signedUpEmail && !email.trim()) setEmail(signedUpEmail);
                    void holdSeats(signedUpEmail);
                  }} /></CardBody>
                </Card>
              )}

              {holdError && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                  <span>{holdError.text}</span>
                  {holdError.reselect && <Button size="sm" variant="outline" onClick={reselect}>Choose other seats</Button>}
                </div>
              )}

              <Button size="lg" className="rounded-pill" onClick={() => void holdSeats()} loading={holding} disabled={couponBusy || (signingIn && !token)}>
                Continue to payment
              </Button>
            </>
          ) : (
            <>
              <HoldTimer expiresAt={hold.holdExpiresAt} onExpire={onExpire} />

              <Card>
                <CardHeader title="Add-ons" subtitle="Optional — added to this booking" />
                <CardBody className="flex flex-col gap-2">
                  {addonCatalogue.isLoading ? <Skeleton className="h-16" /> : (addonCatalogue.data?.items ?? []).length === 0 ? (
                    <p className="text-sm text-text-muted">No add-ons on this bus.</p>
                  ) : addonCatalogue.data!.items.map((a) => {
                    const qty = addons[a.id] ?? 0;
                    const max = a.perPassenger ? seatCount : 5;
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-muted/60 px-4 py-3">
                        <div>
                          <div className="text-sm font-medium text-text">{a.name}</div>
                          <div className="text-xs text-text-muted">{formatMoney(a.priceMinor, currency)} {a.perPassenger ? 'per passenger' : 'each'} + GST</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" aria-label={`Fewer ${a.name}`} disabled={qty === 0 || paying} onClick={() => changeAddon(a, qty - 1)} className="rounded-full border border-border p-1 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="w-5 text-center text-sm font-semibold" aria-live="polite">{qty}</span>
                          <button type="button" aria-label={`More ${a.name}`} disabled={qty >= max || paying} onClick={() => changeAddon(a, qty + 1)} className="rounded-full border border-border p-1 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Payment" />
                <CardBody>
                  {realGateway ? (
                    <p className="flex items-center gap-2 text-sm text-text-muted"><ShieldCheck className="h-5 w-5 text-success" /> You will choose UPI, card or net banking on the secure Razorpay window.</p>
                  ) : (
                    <PaymentMethodForm onChange={setInstrument} disabled={paying} />
                  )}
                </CardBody>
              </Card>

              <label className="flex items-start gap-2 text-xs text-text-muted">
                <input type="checkbox" className="mt-0.5" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>
                  I agree to{' '}
                  {(legal.data?.items ?? []).map((p, i, arr) => (
                    <span key={p.slug}>
                      <Link to={`/legal/${p.slug}`} target="_blank" className="text-primary underline">{p.title}</Link>
                      {i < arr.length - 2 ? ', ' : i === arr.length - 2 ? ' and ' : ''}
                    </span>
                  ))}
                  {(legal.data?.items ?? []).length === 0 && 'the terms of travel'}.
                </span>
              </label>
              {payError && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{payError}</p>}
              <Button
                size="lg"
                className="rounded-pill"
                onClick={() => void pay()}
                loading={paying}
                disabled={!terms || addonBusy || (!realGateway && !instrument)}
                leftIcon={<Lock className="h-4 w-4" />}
              >
                {addonBusy ? 'Updating total…' : `Pay ${formatMoney(payable, currency)}`}
              </Button>
              <p className="-mt-3 text-center text-[11px] text-text-muted">Your seats stay held until the timer runs out.</p>
            </>
          )}
        </div>
        <div className="order-first lg:order-none">{summary}</div>
      </div>
    </div>
  );
}
