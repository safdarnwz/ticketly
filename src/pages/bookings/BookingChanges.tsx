import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button, ErrorState, Input, Modal, PageLoader, Select, useToast } from '@/components/ui';
import { amendmentsApi } from '@/lib/api/amendments';
import { agentPortalApi } from '@/lib/api/agentPortal';
import { flowApi } from '@/lib/api/booking-flow';
import { openRazorpayCheckout, paymentsApi } from '@/lib/api/payments';
import { schedulingApi, tripOpsApi, type TripChart } from '@/lib/api/scheduling';
import { cn, formatDateTime, formatMoney, fromAppDateTimeInput, idempotencyKey, todayLocal } from '@/lib/utils';

export type ChangeKind = 'seats' | 'points' | 'name' | 'reschedule' | 'hold';
interface Props {
  bookingId: string; pnr: string; tripId: string; seats: string[]; passengers: { seatNumber: string; fullName: string }[]; onClose: () => void; onDone: () => void;
  /** A travel agent changing their own booking: its leg, read from the booking (agents have no trip chart). */
  agentLeg?: { fromSeq: number; toSeq: number };
  /** The customer changing their own booking on the customer site: its leg and operator, and the booking mobile when not signed in. */
  customer?: { leg: { fromSeq: number; toSeq: number }; tenantId: string; mobile?: string };
}
type Stop = { stopId: string; sequence: number; name: string | null; departsAt: string; arrivesAt: string; canBoard: boolean; canAlight: boolean };

/**
 * What the change dialogs need: the trip's stops, this booking's leg, and the
 * seats free on it. Staff read the trip chart; an agent reads the public trip
 * and seat map (their own seats show as taken there, and are excluded anyway).
 */
function useLeg(p: Props) {
  // Agents and customers read the public trip and seat map; staff read the trip chart.
  const publicLeg = p.agentLeg ?? p.customer?.leg;
  const tenantId = p.customer?.tenantId;
  const staff = useQuery({ queryKey: ['trip-chart', p.tripId], queryFn: () => tripOpsApi.chart(p.tripId), enabled: !publicLeg });
  const trip = useQuery({ queryKey: ['trip-public', p.tripId], queryFn: () => flowApi.trip(p.tripId, tenantId), enabled: !!publicLeg });
  const stops: Stop[] = (publicLeg ? trip.data?.stops : staff.data?.stops) ?? [];
  const leg = publicLeg
    ? (() => { const from = stops.find((s) => s.sequence === publicLeg.fromSeq); const to = stops.find((s) => s.sequence === publicLeg.toSeq); return from && to ? { from, to } : null; })()
    : legOf(staff.data, p.bookingId);
  const seatMap = useQuery({
    queryKey: ['seat-map', p.tripId, leg?.from.stopId, leg?.to.stopId],
    queryFn: () => flowApi.availability(p.tripId, leg!.from.stopId, leg!.to.stopId, tenantId),
    enabled: !!publicLeg && !!leg,
  });
  const free = publicLeg
    ? (seatMap.data?.seats ?? []).filter((s) => s.available).map((s) => s.seatNumber)
    : staff.data && leg ? freeSeats(staff.data, leg.from.sequence, leg.to.sequence, p.bookingId).map((s) => s.seatNumber) : [];
  const q = publicLeg ? (trip.isError ? trip : seatMap) : staff;
  return { stops, leg, free, isLoading: publicLeg ? trip.isLoading || seatMap.isLoading : staff.isLoading, isError: q.isError, error: q.error, refetch: q.refetch };
}
/** Who makes the change: the agent portal, the customer (with the booking mobile), or staff. */
function apiFor(p: Props) {
  if (p.agentLeg) return agentPortalApi;
  if (!p.customer) return amendmentsApi;
  const m = p.customer.mobile;
  return {
    changeSeats: (id: string, seats: string[], key: string) => amendmentsApi.changeSeats(id, seats, key, m),
    changePoints: (id: string, body: { fromStopId?: string; toStopId?: string }, key: string) => amendmentsApi.changePoints(id, body, key, m),
    correctName: (id: string, seat: string, name: string, key: string) => amendmentsApi.correctName(id, seat, name, key, m),
  };
}
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Failed');

function useTripChart(tripId: string | null) {
  return useQuery({ queryKey: ['trip-chart', tripId], queryFn: () => tripOpsApi.chart(tripId!), enabled: !!tripId });
}
/** The booking's own boarding/dropping, read from the chart occupants. */
function legOf(chart: TripChart | undefined, bookingId: string) {
  const o = chart?.seats.flatMap((s) => s.occupants).find((x) => x.bookingId === bookingId);
  if (!o || !chart) return null;
  const from = chart.stops.find((s) => s.sequence === o.fromSeq);
  const to = chart.stops.find((s) => s.sequence === o.toSeq);
  return from && to ? { from, to } : null;
}
function freeSeats(chart: TripChart, fromSeq: number, toSeq: number, exceptBooking?: string) {
  return chart.seats.filter((s) => s.bookable && !s.blocked && s.occupants.every((o) => o.bookingId === exceptBooking || o.toSeq <= fromSeq || o.fromSeq >= toSeq));
}

function SeatPicker({ seats, picked, max, onChange }: { seats: string[]; picked: string[]; max: number; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
      {[...seats].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((n) => {
        const on = picked.includes(n);
        return <button key={n} type="button" aria-pressed={on} disabled={!on && picked.length >= max}
          onClick={() => onChange(on ? picked.filter((x) => x !== n) : [...picked, n])}
          className={cn('h-9 w-12 rounded-md border text-xs font-medium disabled:opacity-40', on ? 'border-primary bg-primary text-white' : 'border-border')}>{n}</button>;
      })}
    </div>
  );
}

export function BookingChangeModal({ kind, ...p }: Props & { kind: ChangeKind }) {
  return kind === 'seats' ? <SeatsChange {...p} /> : kind === 'points' ? <PointsChange {...p} /> : kind === 'name' ? <NameChange {...p} /> : kind === 'reschedule' ? (p.customer ? <CustomerReschedule {...p} /> : <Reschedule {...p} />) : <HoldChange {...p} />;
}

function SeatsChange(p: Props) {
  const { bookingId, seats, onClose, onDone } = p;
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('seats'));
  const chart = useLeg(p);
  const [picked, setPicked] = useState<string[]>([]);
  const options = chart.free.filter((n) => !seats.includes(n));
  const go = useMutation({
    mutationFn: () => apiFor(p).changeSeats(bookingId, picked, key),
    onSuccess: () => { toast.success(`Moved to seat ${picked.join(', ')} — the ticket was re-issued`); onDone(); },
    onError: (e) => toast.error(errText(e)),
  });
  return (
    <Modal open onClose={onClose} title="Change seats (same bus)"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={picked.length !== seats.length || go.isPending} onClick={() => go.mutate()}>Move</Button></>}>
      {chart.isLoading ? <PageLoader /> : chart.isError ? <ErrorState error={chart.error} onRetry={chart.refetch} /> : (
        <div className="flex flex-col gap-2 text-sm">
          <p>Now in {seats.join(', ')}. Pick {seats.length} free seat{seats.length === 1 ? '' : 's'} ({picked.length}/{seats.length}).</p>
          {options.length < seats.length ? <p className="text-danger">Not enough free seats on this bus.</p> : <SeatPicker seats={options} picked={picked} max={seats.length} onChange={setPicked} />}
          <p className="text-xs text-text-muted">Same fare type only; a costlier seat is an upgrade (from the ticket).</p>
        </div>
      )}
    </Modal>
  );
}

function PointsChange(p: Props) {
  const { bookingId, onClose, onDone } = p;
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('points'));
  const chart = useLeg(p);
  const leg = chart.leg;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const stops = chart.stops;
  const fromId = from || leg?.from.stopId || '';
  const toId = to || leg?.to.stopId || '';
  const seqOf = (id: string) => stops.find((s) => s.stopId === id)?.sequence ?? 0;
  const e = fromId && toId && seqOf(fromId) >= seqOf(toId) ? 'The drop must come after the boarding point' : undefined;
  const unchanged = fromId === leg?.from.stopId && toId === leg?.to.stopId;
  const go = useMutation({
    mutationFn: () => apiFor(p).changePoints(bookingId, { fromStopId: fromId !== leg?.from.stopId ? fromId : undefined, toStopId: toId !== leg?.to.stopId ? toId : undefined }, key),
    onSuccess: () => { toast.success('Boarding / drop point changed — the passenger is told'); onDone(); },
    onError: (x) => toast.error(errText(x)),
  });
  return (
    <Modal open onClose={onClose} title="Change boarding or drop point"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={unchanged || !!e || go.isPending} onClick={() => go.mutate()}>Save</Button></>}>
      {chart.isLoading ? <PageLoader /> : chart.isError ? <ErrorState error={chart.error} onRetry={chart.refetch} /> : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Select label="Boards at" value={fromId} onChange={(x) => setFrom(x.target.value)} options={stops.filter((s) => s.canBoard).map((s) => ({ label: `${s.name ?? 'Stop'} · ${formatDateTime(s.departsAt)}`, value: s.stopId }))} />
          <Select label="Gets off at" value={toId} error={e} onChange={(x) => setTo(x.target.value)} options={stops.filter((s) => s.canAlight).map((s) => ({ label: `${s.name ?? 'Stop'} · ${formatDateTime(s.arrivesAt)}`, value: s.stopId }))} />
          <p className="col-span-2 text-xs text-text-muted">Only within the same fare stage, up to 60 minutes before boarding. A longer trip is a reschedule.</p>
        </div>
      )}
    </Modal>
  );
}

function NameChange(p: Props) {
  const { bookingId, passengers, onClose, onDone } = p;
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('name'));
  const [seat, setSeat] = useState(passengers[0]?.seatNumber ?? '');
  const current = passengers.find((p) => p.seatNumber === seat)?.fullName ?? '';
  const [name, setName] = useState('');
  const e = name && name.trim().length < 2 ? 'At least 2 characters' : name.trim().toLowerCase() === current.toLowerCase() ? 'Same as now' : undefined;
  const go = useMutation({
    mutationFn: () => apiFor(p).correctName(bookingId, seat, name.trim(), key),
    onSuccess: () => { toast.success('Name corrected — the ticket was re-issued'); onDone(); },
    onError: (x) => toast.error(errText(x)),
  });
  return (
    <Modal open onClose={onClose} title="Correct a name spelling"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={!name.trim() || !!e || go.isPending} onClick={() => go.mutate()}>Correct</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <Select label="Passenger" value={seat} onChange={(x) => { setSeat(x.target.value); setName(''); }} options={passengers.map((p) => ({ label: `Seat ${p.seatNumber} · ${p.fullName}`, value: p.seatNumber }))} />
        <Input label="Correct spelling" value={name} error={e} placeholder={current} onChange={(x) => setName(x.target.value)} />
        <p className="text-xs text-text-muted">Spelling fixes only — a ticket cannot be passed to a different person.</p>
      </div>
    </Modal>
  );
}

function Reschedule({ bookingId, tripId, seats, onClose, onDone }: Props) {
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('resched'));
  const current = useTripChart(tripId);
  const leg = legOf(current.data, bookingId);
  const [date, setDate] = useState('');
  const [newTrip, setNewTrip] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState<{ intentId: string; amount: number; payload: unknown } | null>(null);
  const trips = useQuery({ queryKey: ['trips', date], queryFn: () => schedulingApi.listTrips(date), enabled: !!date });
  const target = useTripChart(newTrip || null);
  const sameRoute = (trips.data?.items ?? []).filter((t) => t.routeId === current.data?.trip.routeId && t.id !== tripId && ['open', 'scheduled'].includes(t.status) && new Date(t.departsAt).getTime() > Date.now());
  const tLeg = useMemo(() => {
    if (!target.data || !leg) return null;
    const from = target.data.stops.find((s) => s.stopId === leg.from.stopId);
    const to = target.data.stops.find((s) => s.stopId === leg.to.stopId);
    return from && to ? { from, to } : null;
  }, [target.data, leg]);
  const options = target.data && tLeg ? freeSeats(target.data, tLeg.from.sequence, tLeg.to.sequence).map((s) => s.seatNumber) : [];
  const testMode = useQuery({ queryKey: ['payment-test-methods'], queryFn: paymentsApi.testMethods, staleTime: 300_000 });
  const go = useMutation({
    mutationFn: () => amendmentsApi.reschedule(bookingId, { newTripId: newTrip, newFromStopId: leg!.from.stopId, newToStopId: leg!.to.stopId, newSeatNumbers: picked }, key),
    onSuccess: (r) => {
      if (r.status === 'rescheduled') { toast.success(r.refundMinor > 0 ? `Moved — ${formatMoney(r.refundMinor)} goes back to the customer` : 'Moved to the new trip'); onDone(); }
      else if (r.status === 'payment_required') setDue({ intentId: r.payment.intentId, amount: r.amountDueMinor, payload: r.payment.clientPayload });
    },
    onError: (x) => toast.error(errText(x)),
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (testMode.data?.testMode) return amendmentsApi.payChangeTest(due!.intentId, `pay-${due!.intentId}`);
      await openRazorpayCheckout(due!.payload as never);
      return { status: 'captured' };
    },
    onSuccess: () => { toast.success('Paid — the booking moves to the new trip'); onDone(); },
    onError: (x) => toast.error(errText(x)),
  });
  return (
    <Modal open onClose={onClose} size="lg" title="Move to another date or bus"
      footer={due ? <><Button variant="ghost" onClick={onClose} disabled={pay.isPending}>Not now</Button><Button loading={pay.isPending} disabled={pay.isPending} onClick={() => pay.mutate()}>Collect {formatMoney(due.amount)}</Button></>
        : <><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={!newTrip || picked.length !== seats.length || !tLeg || go.isPending} onClick={() => go.mutate()}>Move booking</Button></>}>
      {current.isLoading ? <PageLoader /> : !leg ? <p className="text-sm text-danger">This booking has no seats on the chart to move.</p> : due ? (
        <div className="text-sm">
          <p>The new trip costs more. Collect <b>{formatMoney(due.amount)}</b> (fare difference and fee) — the booking moves only once it is paid.</p>
          {testMode.data?.testMode && <p className="mt-1 text-xs text-text-muted">Test mode: paid through the sandbox gateway.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>{leg.from.name} → {leg.to.name} · {seats.length} seat{seats.length === 1 ? '' : 's'}. A reschedule fee applies; the difference is collected or refunded.</p>
          <Input label="New journey date" type="date" min={todayLocal()} value={date} onChange={(x) => { setDate(x.target.value); setNewTrip(''); setPicked([]); }} />
          {date && (trips.isLoading ? <PageLoader /> : sameRoute.length === 0 ? <p className="text-text-muted">No other bus on this route that day.</p> : (
            <Select label="Bus" value={newTrip} onChange={(x) => { setNewTrip(x.target.value); setPicked([]); }} options={[{ label: 'Choose…', value: '' }, ...sameRoute.map((t) => ({ label: `${formatDateTime(t.departsAt)} · ${t.totalSeats - t.bookedSeats - t.heldSeats} free`, value: t.id }))]} />
          ))}
          {newTrip && (target.isLoading ? <PageLoader /> : !tLeg ? <p className="text-danger">That bus does not stop at the same points.</p> : options.length < seats.length ? <p className="text-danger">Not enough free seats on that bus.</p> : (
            <>
              <p>Pick {seats.length} seat{seats.length === 1 ? '' : 's'} ({picked.length}/{seats.length})</p>
              <SeatPicker seats={options} picked={picked} max={seats.length} onChange={setPicked} />
            </>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * The customer moving their own booking to another day: the operator's buses
 * that day through the same boarding and drop points, seats free on that
 * stretch, the exact price of the change before confirming, then payment when
 * money is due (the booking moves only once it is paid).
 */
function CustomerReschedule({ bookingId, seats, customer, onClose, onDone }: Props) {
  const toast = useToast();
  const m = customer?.mobile;
  const tenantId = customer?.tenantId;
  const [key] = useState(() => idempotencyKey('resched'));
  const [date, setDate] = useState('');
  const [tripId, setTripId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState<{ intentId: string; amount: number; payload: unknown } | null>(null);
  const options = useQuery({ queryKey: ['resched-options', bookingId, date], queryFn: () => amendmentsApi.rescheduleOptions(bookingId, date, m), enabled: !!date });
  const need = options.data?.seatsNeeded ?? seats.length;
  const seatMap = useQuery({
    queryKey: ['seat-map', tripId, options.data?.fromStopId, options.data?.toStopId],
    queryFn: () => flowApi.availability(tripId, options.data!.fromStopId, options.data!.toStopId, tenantId),
    enabled: !!tripId && !!options.data,
  });
  const free = (seatMap.data?.seats ?? []).filter((x) => x.available).map((x) => x.seatNumber);
  const target = tripId && options.data && picked.length === need
    ? { newTripId: tripId, newFromStopId: options.data.fromStopId, newToStopId: options.data.toStopId, newSeatNumbers: picked }
    : null;
  const quote = useQuery({ queryKey: ['resched-quote', bookingId, target], queryFn: () => amendmentsApi.rescheduleQuote(bookingId, target!, m), enabled: !!target, retry: false });
  const testMode = useQuery({ queryKey: ['payment-test-methods'], queryFn: paymentsApi.testMethods, staleTime: 300_000 });
  const go = useMutation({
    mutationFn: () => amendmentsApi.reschedule(bookingId, target!, key, m),
    onSuccess: (r) => {
      if (r.status === 'rescheduled') { toast.success(r.refundMinor > 0 ? `Moved — ${formatMoney(r.refundMinor)} will be refunded to you` : 'Moved to the new bus — your ticket was re-issued'); onDone(); }
      else if (r.status === 'payment_required') setDue({ intentId: r.payment.intentId, amount: r.amountDueMinor, payload: r.payment.clientPayload });
    },
    onError: (x) => toast.error(errText(x)),
  });
  const pay = useMutation({
    mutationFn: async () => {
      if (testMode.data?.testMode) return amendmentsApi.payChangeTest(due!.intentId, `pay-${due!.intentId}`);
      await openRazorpayCheckout(due!.payload as never);
      return { status: 'captured' };
    },
    onSuccess: () => { toast.success('Paid — your booking is on the new bus and the ticket was re-issued'); onDone(); },
    onError: (x) => toast.error(errText(x)),
  });
  const q = quote.data;
  return (
    <Modal open onClose={onClose} size="lg" title="Change travel date"
      footer={due
        ? <><Button variant="ghost" onClick={onClose} disabled={pay.isPending}>Not now</Button><Button loading={pay.isPending} disabled={pay.isPending} onClick={() => pay.mutate()}>Pay {formatMoney(due.amount)}</Button></>
        : <><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={!target || !q || go.isPending} onClick={() => go.mutate()}>{q && q.amountDueMinor > 0 ? `Continue to pay ${formatMoney(q.amountDueMinor)}` : 'Move my booking'}</Button></>}>
      {due ? (
        <div className="text-sm">
          <p>Pay <b>{formatMoney(due.amount)}</b> (fare difference and change fee). Your booking moves to the new bus only once it is paid — until then your current ticket stays valid.</p>
          {testMode.data?.testMode && <p className="mt-1 text-xs text-text-muted">Test mode: paid through the sandbox gateway.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-text-muted">Same boarding and drop points, {need} seat{need === 1 ? '' : 's'}. A change fee applies; a costlier bus is paid for, a cheaper one refunded.</p>
          <Input label="New travel date" type="date" min={todayLocal()} value={date} onChange={(x) => { setDate(x.target.value); setTripId(''); setPicked([]); }} />
          {date && (options.isLoading ? <PageLoader /> : options.isError ? <ErrorState error={options.error} onRetry={options.refetch} /> : options.data!.trips.length === 0 ? (
            <p className="text-text-muted">No bus of this operator through your points that day. Try another date.</p>
          ) : (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Bus">
              {options.data!.trips.map((t) => {
                const full = t.freeSeats < need;
                return (
                  <button key={t.tripId} type="button" role="radio" aria-checked={tripId === t.tripId} disabled={full}
                    onClick={() => { setTripId(t.tripId); setPicked([]); }}
                    className={cn('flex items-center justify-between rounded-md border px-3 py-2 text-left disabled:opacity-50', tripId === t.tripId ? 'border-primary bg-surface-muted' : 'border-border')}>
                    <span><span className="font-medium">{formatDateTime(t.boardsAt)}</span> <span className="text-text-muted">→ {formatDateTime(t.dropsAt)} · {t.routeName}</span></span>
                    <span className={cn('text-xs', full ? 'text-danger' : 'text-text-muted')}>{full ? 'not enough seats' : `${t.freeSeats} free`}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {tripId && (seatMap.isLoading ? <PageLoader /> : seatMap.isError ? <ErrorState error={seatMap.error} onRetry={seatMap.refetch} /> : (
            <>
              <p>Pick {need} seat{need === 1 ? '' : 's'} ({picked.length}/{need})</p>
              <SeatPicker seats={free} picked={picked} max={need} onChange={setPicked} />
            </>
          ))}
          {target && (quote.isLoading ? <PageLoader /> : quote.isError ? <p className="text-danger">{errText(quote.error)}</p> : q && (
            <div className="rounded-md border border-border p-3">
              <div className="flex justify-between"><span className="text-text-muted">Change fee</span><span>{formatMoney(q.feeMinor)}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Fare difference</span><span>{formatMoney(q.fareDiffMinor)}</span></div>
              <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                {q.amountDueMinor > 0 ? <><span>You pay</span><span>{formatMoney(q.amountDueMinor)}</span></> : <><span>Refund to you</span><span>{formatMoney(q.refundMinor)}</span></>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function HoldChange({ bookingId, onClose, onDone }: Props) {
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('hold'));
  const [at, setAt] = useState('');
  const e = at && fromAppDateTimeInput(at) <= Date.now() ? 'Pick a time in the future' : undefined;
  const qc = useQueryClient();
  const go = useMutation({
    mutationFn: () => amendmentsApi.extendHold(bookingId, new Date(fromAppDateTimeInput(at)).toISOString(), key),
    onSuccess: (r) => { toast.success(`Seats kept until ${formatDateTime(r.holdExpiresAt)}`); void qc.invalidateQueries({ queryKey: ['booking'] }); onDone(); },
    onError: (x) => toast.error(errText(x)),
  });
  return (
    <Modal open onClose={onClose} title="Change when the phone booking is released"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={!at || !!e || go.isPending} onClick={() => go.mutate()}>Save</Button></>}>
      <Input label="Release unpaid seats at" type="datetime-local" value={at} error={e} hint="Must be before the bus leaves" onChange={(x) => setAt(x.target.value)} />
    </Modal>
  );
}
