import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Bus as BusIcon, Clock, Lock, PauseCircle, PlayCircle, Printer, TimerReset, Unlock, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, PageLoader, Select, statusTone, useToast } from '@/components/ui';
import { TripOpsSection } from './TripOpsSection';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { tripOpsApi, type ChartOccupant, type ChartSeat, type TripChart } from '@/lib/api/scheduling';
import { TRIP_STATUS_LABEL } from '@/lib/trip-status';
import { fleetApi, type Vehicle } from '@/lib/api/fleet';
import { cn, formatDateLabel, formatDateTime, formatTime, fromAppDateTimeInput, SEAT_TYPE_LABEL, toAppDateTimeInput } from '@/lib/utils';

const CELL_REM = 4.2;
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const short = (name: string) => (name.length > 11 ? `${name.slice(0, 10)}…` : name);

/** What a seat is, for its colour and label. */
function seatState(s: ChartSeat): 'booked' | 'hold' | 'blocked' | 'closed' | 'free' {
  if (s.occupants.some((o) => !o.onHold)) return 'booked';
  if (s.occupants.length) return 'hold';
  if (!s.bookable) return 'closed';
  if (s.blocked) return 'blocked';
  return 'free';
}
const STATE_STYLE = {
  booked: 'border-primary bg-primary/10 text-text',
  hold: 'border-warning bg-warning/15 text-text',
  blocked: 'border-border bg-surface-muted text-text-muted [background-image:repeating-linear-gradient(45deg,transparent_0_6px,rgba(0,0,0,.06)_6px_12px)]',
  closed: 'border-border bg-surface-muted text-text-muted opacity-60',
  free: 'border-border bg-surface text-text-muted',
} as const;

/**
 * A bus's reservation chart: the seat layout with who sits where (boarding →
 * dropping), seats being paid for right now, blocked seats; the passenger
 * list by boarding point (printable); and the trip's operations — stop /
 * resume sales, release holds, block seats, re-time, cancel — each refused
 * once the bus has left.
 */
export function TripChartPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const chart = useQuery({ queryKey: ['trip-chart', id], queryFn: () => tripOpsApi.chart(id), refetchInterval: 20_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  const [picked, setPicked] = useState<string | null>(null);
  const [blockMode, setBlockMode] = useState(false);
  const [blockSel, setBlockSel] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'cancel' | 'retime' | 'bus' | null>(null);
  const vehicles = useQuery({ queryKey: ['vehicles', 'active-all'], queryFn: () => fleetApi.listVehicles({ status: 'active', pageSize: 100 }), staleTime: 60_000 });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['trip-chart', id] });
    void qc.invalidateQueries({ queryKey: ['trips'] });
  };
  const act = <T,>(fn: () => Promise<T>, ok: (r: T) => string) => ({
    mutationFn: fn,
    onSuccess: (r: T) => { toast.success(ok(r)); refresh(); },
    onError: (e: unknown) => toast.error(errText(e, 'That did not work')),
  });
  const stopSales = useMutation(act(() => tripOpsApi.stopSales(id), () => 'Sales stopped — no channel can sell this bus'));
  const resumeSales = useMutation(act(() => tripOpsApi.resumeSales(id), () => 'Back on sale'));
  const releaseHolds = useMutation(act(() => tripOpsApi.releaseHolds(id), (r) => `${r.released} hold${r.released === 1 ? '' : 's'} released`));
  const block = useMutation({
    ...act(async () => {
      const c = chart.data!;
      const first = c.stops[0]!;
      const last = c.stops[c.stops.length - 1]!;
      const toBlock = blockSel.filter((n) => c.seats.find((s) => s.seatNumber === n)?.blocked === false);
      const toFree = blockSel.filter((n) => c.seats.find((s) => s.seatNumber === n)?.blocked === true);
      if (toBlock.length) await tripOpsApi.blockSeats(id, { seatNumbers: toBlock, fromStopId: first.stopId, toStopId: last.stopId, block: true });
      if (toFree.length) await tripOpsApi.blockSeats(id, { seatNumbers: toFree, fromStopId: first.stopId, toStopId: last.stopId, block: false });
      return { toBlock, toFree };
    }, (r) => [r.toBlock.length && `Blocked ${r.toBlock.join(', ')}`, r.toFree.length && `Opened ${r.toFree.join(', ')}`].filter(Boolean).join(' · ')),
    onSettled: () => { setBlockSel([]); setBlockMode(false); },
  });

  const c = chart.data;
  const occupant = useMemo(() => (picked && c ? c.seats.find((s) => s.seatNumber === picked) ?? null : null), [picked, c]);

  if (chart.isLoading) return <PageLoader />;
  if (chart.isError) {
    return chart.error instanceof ApiError && chart.error.status === 404
      ? <EmptyState title="Trip not found" description="It may belong to another operator or have been removed." action={<Link to="/trips"><Button variant="outline">All trips</Button></Link>} />
      : <ErrorState error={chart.error} onRetry={chart.refetch} />;
  }
  const data = c!;
  const t = data.trip;
  const first = data.stops[0];
  const last = data.stops[data.stops.length - 1];
  const locked = t.hasRun || t.status === 'departed' || t.status === 'cancelled';
  const future = new Date(t.departsAt).getTime() > Date.now();
  const busy = stopSales.isPending || resumeSales.isPending || releaseHolds.isPending || block.isPending;

  const clickSeat = (s: ChartSeat) => {
    if (blockMode) {
      const st = seatState(s);
      if (st !== 'free' && st !== 'blocked') { toast.error(`Seat ${s.seatNumber} has a passenger — it cannot be blocked`); return; }
      setBlockSel((cur) => (cur.includes(s.seatNumber) ? cur.filter((x) => x !== s.seatNumber) : [...cur, s.seatNumber]));
      return;
    }
    setPicked(s.seatNumber === picked ? null : s.seatNumber);
  };

  return (
    <div className="print:text-black">
      <PageHeader
        title={`${first?.name ?? 'Trip'} → ${last?.name ?? ''}`}
        subtitle={`${formatDateLabel(t.journeyDate, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })} · departs ${formatTime(t.departsAt)} · arrives ${formatTime(t.arrivesAt)}`}
        action={<div className="flex items-center gap-2">{t.vehicleId && <span className="font-mono text-sm text-text-muted">{vehicles.data?.items.find((v) => v.id === t.vehicleId)?.registrationNo ?? 'Bus assigned'}</span>}<Badge tone={statusTone(t.status === 'closed' ? 'held' : t.status)}>{t.hasRun && t.status === 'closed' ? 'journey over' : TRIP_STATUS_LABEL[t.status] ?? t.status}</Badge></div>}
      />

      <Card className="mb-4 print:hidden">
        <CardBody className="flex flex-wrap gap-2">
          {t.status === 'open' && <Button variant="outline" leftIcon={<PauseCircle className="h-4 w-4" />} loading={stopSales.isPending} disabled={busy} onClick={() => stopSales.mutate()}>Stop sales</Button>}
          {(t.status === 'closed' || t.status === 'scheduled') && !locked && future && <Button variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={resumeSales.isPending} disabled={busy} onClick={() => resumeSales.mutate()}>{t.status === 'scheduled' ? 'Put on sale' : 'Resume sales'}</Button>}
          {!locked && data.totals.onHold > 0 && <Button variant="outline" leftIcon={<TimerReset className="h-4 w-4" />} loading={releaseHolds.isPending} disabled={busy} onClick={() => releaseHolds.mutate()}>Release {data.totals.onHold} hold{data.totals.onHold === 1 ? '' : 's'}</Button>}
          {!locked && (blockMode ? (
            <>
              <Button leftIcon={<Lock className="h-4 w-4" />} loading={block.isPending} disabled={busy || blockSel.length === 0} onClick={() => block.mutate()}>Apply to {blockSel.length} seat{blockSel.length === 1 ? '' : 's'}</Button>
              <Button variant="ghost" onClick={() => { setBlockMode(false); setBlockSel([]); }}>Done</Button>
              <span className="self-center text-sm text-text-muted">Click free seats to block them, blocked seats to open them.</span>
            </>
          ) : (
            <Button variant="outline" leftIcon={<Unlock className="h-4 w-4" />} disabled={busy} onClick={() => { setBlockMode(true); setPicked(null); }}>Block / open seats</Button>
          ))}
          {!locked && future && <Button variant="outline" leftIcon={<Clock className="h-4 w-4" />} disabled={busy} onClick={() => setDialog('retime')}>Change departure time</Button>}
          {!locked && future && <Button variant="outline" leftIcon={<BusIcon className="h-4 w-4" />} disabled={busy} onClick={() => setDialog('bus')}>{t.vehicleId ? 'Change bus' : 'Assign bus'}</Button>}
          <Button variant="outline" leftIcon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print chart</Button>
          {!locked && <Button variant="danger" className="ml-auto" leftIcon={<XCircle className="h-4 w-4" />} disabled={busy} onClick={() => setDialog('cancel')}>Cancel trip</Button>}
          {locked && <span className="self-center text-sm text-text-muted"><Ban className="mr-1 inline h-4 w-4" />{t.status === 'cancelled' ? 'This trip was cancelled.' : 'This bus has left — the chart is read-only.'}</span>}
        </CardBody>
      </Card>

      <div className="mb-4 grid grid-cols-3 gap-3 md:grid-cols-6">
        {[
          ['Passengers', data.totals.passengers], ['Bookings', data.totals.bookings], ['Free seats', data.totals.free],
          ['Paying now', data.totals.onHold], ['Blocked', data.totals.blocked], ['Boarded', data.totals.boarded],
        ].map(([k, v]) => (
          <Card key={k}><CardBody className="py-3"><div className="text-xs text-text-muted">{k}</div><div className="font-display text-xl text-text">{v}</div></CardBody></Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Seat chart" subtitle={blockMode ? `${blockSel.length} selected` : 'Click a seat for its passenger'} />
          <CardBody>
            <ChartGrid chart={data} picked={picked} selection={blockSel} blockMode={blockMode} onClick={clickSeat} />
            <Legend />
          </CardBody>
        </Card>
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card className="print:hidden">
            <CardHeader title={occupant ? `Seat ${occupant.seatNumber}` : 'Seat details'} subtitle={occupant ? `${SEAT_TYPE_LABEL[occupant.seatType] ?? occupant.seatType}${occupant.ladiesOnly ? ' · ladies' : ''}` : undefined} />
            <CardBody>
              {!occupant ? <p className="text-sm text-text-muted">Pick a seat on the chart.</p> : occupant.occupants.length === 0 ? (
                <p className="text-sm text-text-muted">{occupant.blocked ? 'Blocked — not for sale.' : !occupant.bookable ? 'Not for sale.' : 'Free on the whole route.'}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {occupant.occupants.map((o) => <OccupantCard key={o.bookingId + o.seatNumber} o={o} />)}
                </div>
              )}
            </CardBody>
          </Card>
          <Remarks tripId={id} locked={t.status === 'cancelled'} />
        </div>
      </div>

      <TripOpsSection chart={data} locked={locked} onChanged={refresh} />

      <Manifest chart={data} />

      {dialog === 'cancel' && <CancelTripModal tripId={id} bookings={data.totals.bookings} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'bus' && <ChangeBusModal trip={t} vehicles={vehicles.data?.items ?? []} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === 'retime' && <RetimeModal trip={t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}

function ChartGrid({ chart, picked, selection, blockMode, onClick }: {
  chart: TripChart; picked: string | null; selection: string[]; blockMode: boolean; onClick: (s: ChartSeat) => void;
}) {
  const decks = Array.from({ length: Math.max(1, chart.layout.decks) }, (_, d) => d);
  return (
    <div className="flex flex-wrap justify-center gap-6 overflow-x-auto">
      {decks.map((deck) => {
        const seats = chart.seats.filter((s) => s.deck === deck);
        if (!seats.length) return null;
        return (
          <div key={deck} className="rounded-card border border-border bg-surface-muted/40 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{chart.layout.decks > 1 ? (deck === 0 ? 'Lower deck' : 'Upper deck') : 'Seats'} · front ↑</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${chart.layout.columns}, ${CELL_REM}rem)`, gridTemplateRows: `repeat(${chart.layout.rows}, ${CELL_REM}rem)` }}>
              {seats.map((s) => {
                const st = seatState(s);
                const lead = s.occupants.find((o) => !o.onHold) ?? s.occupants[0];
                const sel = selection.includes(s.seatNumber);
                const label = `Seat ${s.seatNumber}: ${st === 'booked' ? `${lead!.name}, ${lead!.from} to ${lead!.to}` : st === 'hold' ? 'being paid for' : st}`;
                return (
                  <button key={s.seatNumber} type="button" aria-label={label} title={label} aria-pressed={blockMode ? sel : picked === s.seatNumber}
                    onClick={() => onClick(s)}
                    style={{ gridColumn: `${s.column + 1} / span ${s.colSpan}`, gridRow: `${s.row + 1} / span ${s.rowSpan}` }}
                    className={cn('flex flex-col items-start overflow-hidden rounded-md border p-1 text-left text-[10px] leading-tight transition focus-ring',
                      STATE_STYLE[st], s.ladiesOnly && 'ring-1 ring-pink-400', (picked === s.seatNumber || sel) && 'outline outline-2 outline-offset-1 outline-primary')}>
                    <span className="font-bold">{s.seatNumber}{s.occupants.length > 1 ? ` ×${s.occupants.length}` : ''}</span>
                    {lead && <span className="w-full truncate">{short(lead.name)}</span>}
                    {lead && <span className="w-full truncate text-text-muted">{lead.from?.split(' ')[0]}→{lead.to?.split(' ')[0]}</span>}
                    {st === 'blocked' && <Lock className="mt-auto h-3 w-3" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  const items: [keyof typeof STATE_STYLE, string][] = [['booked', 'Booked'], ['hold', 'Paying now'], ['blocked', 'Blocked'], ['free', 'Free'], ['closed', 'Not for sale']];
  return (
    <div className="mt-4 flex flex-wrap justify-center gap-3 text-xs text-text-muted">
      {items.map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className={cn('inline-block h-3 w-3 rounded border', STATE_STYLE[k])} />{l}</span>)}
      <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border ring-1 ring-pink-400" />Ladies</span>
    </div>
  );
}

function OccupantCard({ o }: { o: ChartOccupant }) {
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-text">{o.name}{o.age ? `, ${o.age}` : ''}{o.gender ? ` ${o.gender[0]!.toUpperCase()}` : ''}</span>
        <Badge tone={o.onHold ? 'warning' : o.ticketStatus === 'boarded' ? 'success' : o.ticketStatus === 'no_show' ? 'danger' : 'info'}>{o.onHold ? 'paying now' : o.ticketStatus ?? o.status}</Badge>
      </div>
      <div className="mt-1 text-text-muted">{o.from} → {o.to}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
        <Link className="font-mono text-primary hover:underline" to={`/bookings/${o.pnr}`}>{o.pnr}</Link>
        {o.contactPhone && <a className="text-primary" href={`tel:${o.contactPhone}`}>{o.contactPhone}</a>}
      </div>
    </div>
  );
}

/** Passengers by boarding point, in route order — what the conductor works from. */
function Manifest({ chart }: { chart: TripChart }) {
  const groups = useMemo(() => {
    const all = chart.seats.flatMap((s) => s.occupants.filter((o) => !o.onHold));
    return chart.stops
      .map((st) => ({ stop: st, people: all.filter((o) => o.fromSeq === st.sequence).sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, 'en', { numeric: true })) }))
      .filter((g) => g.people.length);
  }, [chart]);
  return (
    <Card className="mt-6">
      <CardHeader title="Passenger list" subtitle="By boarding point — prints with the chart" />
      <CardBody>
        {groups.length === 0 ? <p className="text-sm text-text-muted">No passengers booked yet.</p> : groups.map((g) => (
          <div key={g.stop.sequence} className="mb-4 break-inside-avoid">
            <div className="mb-1 text-sm font-semibold text-text">{formatTime(g.stop.departsAt)} · {g.stop.name} <span className="font-normal text-text-muted">({g.people.length})</span></div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-text-muted"><th className="py-1">Seat</th><th>Passenger</th><th>PNR</th><th>Mobile</th><th>Getting off</th><th>Status</th></tr></thead>
              <tbody>
                {g.people.map((o) => (
                  <tr key={o.bookingId + o.seatNumber} className="border-t border-border">
                    <td className="py-1 font-semibold">{o.seatNumber}</td>
                    <td>{o.name}{o.age ? `, ${o.age}` : ''}{o.gender ? ` ${o.gender[0]!.toUpperCase()}` : ''}</td>
                    <td className="font-mono">{o.pnr}</td>
                    <td>{o.contactPhone ?? '—'}</td>
                    <td>{o.to}</td>
                    <td>{o.ticketStatus ?? o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function Remarks({ tripId, locked }: { tripId: string; locked: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const list = useQuery({ queryKey: ['trip-remarks', tripId], queryFn: () => tripOpsApi.remarks(tripId) });
  const add = useMutation({
    mutationFn: () => tripOpsApi.addRemark(tripId, text.trim()),
    onSuccess: () => { setText(''); setTouched(false); void qc.invalidateQueries({ queryKey: ['trip-remarks', tripId] }); },
    onError: (e) => toast.error(errText(e, 'Could not save the remark')),
  });
  const error = text.trim().length < 2 ? 'Write at least 2 characters' : '';
  return (
    <Card className="print:hidden">
      <CardHeader title="Staff remarks" subtitle="Internal — never shown to passengers" />
      <CardBody className="flex flex-col gap-3">
        {!locked && (
          <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!error) add.mutate(); }}>
            <div className="flex-1"><Input label="New remark" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} error={touched ? error : undefined} placeholder="e.g. AC not cooling, mechanic informed" /></div>
            <Button type="submit" className="mt-7" loading={add.isPending} disabled={add.isPending}>Add</Button>
          </form>
        )}
        {list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.data?.items.length ? (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
            {list.data.items.map((r) => (
              <li key={r.id} className="rounded-md bg-surface-muted px-3 py-2">
                <div>{r.remark}</div>
                <div className="text-xs text-text-muted">{r.by ?? 'Staff'} · {new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-text-muted">No remarks yet.</p>}
      </CardBody>
    </Card>
  );
}

function CancelTripModal({ tripId, bookings, onClose, onDone }: { tripId: string; bookings: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [touched, setTouched] = useState(false);
  const inFlight = useRef(false);
  const reasonError = reason.trim().length < 3 ? 'Say why (at least 3 characters)' : '';
  const confirmError = confirmText.trim().toUpperCase() !== 'CANCEL' ? 'Type CANCEL to confirm' : '';
  const cancel = useMutation({
    mutationFn: () => tripOpsApi.cancel(tripId, reason.trim()),
    onSuccess: (r) => { toast.success(`Trip cancelled — ${r.cancelledBookings} booking${r.cancelledBookings === 1 ? '' : 's'} refunded in full${r.failed ? `, ${r.failed} need follow-up` : ''}`); onDone(); },
    onError: (e) => toast.error(errText(e, 'Could not cancel the trip')),
    onSettled: () => { inFlight.current = false; },
  });
  return (
    <Modal open onClose={onClose} title="Cancel this trip"
      footer={<><Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>Keep trip</Button><Button variant="danger" loading={cancel.isPending} disabled={cancel.isPending} onClick={() => { setTouched(true); if (reasonError || confirmError || inFlight.current) return; inFlight.current = true; cancel.mutate(); }}>Cancel trip & refund everyone</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-danger">{bookings} booking{bookings === 1 ? '' : 's'} will be cancelled and refunded in full, and every passenger is told. This cannot be undone.</p>
        <Input label="Reason (sent to passengers)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} error={touched ? reasonError : undefined} placeholder="e.g. Bus breakdown" />
        <Input label="Type CANCEL to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} error={touched ? confirmError : undefined} />
      </div>
    </Modal>
  );
}

function RetimeModal({ trip, onClose, onDone }: { trip: TripChart['trip']; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const current = new Date(trip.departsAt);
  const [value, setValue] = useState(toAppDateTimeInput(current.getTime()));
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const target = value ? new Date(fromAppDateTimeInput(value)) : null;
  const shift = target ? Math.round((target.getTime() - current.getTime()) / 60_000) : 0;
  const timeError = !target || Number.isNaN(target.getTime()) ? 'Pick the new time'
    : target.getTime() <= Date.now() ? 'The new time must be in the future'
    : shift === 0 ? 'That is the current departure time'
    : Math.abs(shift) > 12 * 60 ? 'Move a trip by at most 12 hours — cancel it and add an extra trip instead' : '';
  const reasonError = reason.trim().length < 3 ? 'Say why (at least 3 characters)' : '';
  const retime = useMutation({
    mutationFn: () => tripOpsApi.retime(trip.id, target!.toISOString(), reason.trim()),
    onSuccess: (r) => { toast.success(`Departure moved by ${r.shiftMinutes > 0 ? '+' : ''}${r.shiftMinutes} min — passengers are being told`); onDone(); },
    onError: (e) => toast.error(errText(e, 'Could not change the time')),
  });
  return (
    <Modal open onClose={onClose} title="Change departure time"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={retime.isPending} disabled={retime.isPending} onClick={() => { setTouched(true); if (!timeError && !reasonError) retime.mutate(); }}>Move trip</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Now departs {formatTime(trip.departsAt)}. Every stop moves by the same amount and every passenger gets an SMS/email.</p>
        <Input label="New departure (IST)" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} error={touched ? timeError : undefined} />
        {!timeError && <p className="text-text-muted">{shift > 0 ? `${shift} min later` : `${-shift} min earlier`}</p>}
        <Input label="Reason (sent to passengers)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} error={touched ? reasonError : undefined} placeholder="e.g. Heavy traffic on NH48" />
      </div>
    </Modal>
  );
}

function ChangeBusModal({ trip, vehicles, onClose, onDone }: { trip: TripChart['trip']; vehicles: Vehicle[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  // Only a verified bus with a seat layout can run.
  const options = vehicles.filter((v) => v.id !== trip.vehicleId && v.verificationStatus === 'approved' && v.seatLayoutId);
  const notReady = vehicles.filter((v) => v.id !== trip.vehicleId && !(v.verificationStatus === 'approved' && v.seatLayoutId)).length;
  const busError = vehicleId ? '' : options.length ? 'Choose a bus' : 'No other bus is ready — verify one and give it a seat layout in Fleet';
  const reasonError = reason.trim().length < 5 ? 'Say why (at least 5 characters)' : '';
  const change = useMutation({
    mutationFn: () => tripOpsApi.changeBus(trip.id, vehicleId, reason.trim()),
    onSuccess: (r) => {
      toast.success(!r.changed ? 'That bus is already on this trip' : r.layoutChanged
        ? `Bus changed — ${r.seatMoves.length} passenger${r.seatMoves.length === 1 ? '' : 's'} moved to matching seats`
        : 'Bus changed — every passenger keeps their seat');
      onDone();
    },
    onError: (e) => toast.error(errText(e, 'Could not change the bus')),
  });
  return (
    <Modal open onClose={onClose} title={trip.vehicleId ? 'Change bus' : 'Assign bus'}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={change.isPending} disabled={change.isPending || !options.length} onClick={() => { setTouched(true); if (!busError && !reasonError) change.mutate(); }}>{trip.vehicleId ? 'Change bus' : 'Assign'}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <Select label="Bus" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} error={touched ? busError : undefined}
          options={[{ value: '', label: options.length ? 'Choose…' : 'No other active bus' }, ...options.map((v) => ({ value: v.id, label: `${v.registrationNo}${v.make ? ` · ${v.make} ${v.model ?? ''}` : ''}` }))]} />
        <Input label="Reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} error={touched ? reasonError : undefined} placeholder="e.g. Regular bus in for servicing" />
        <p className="text-text-muted">Only a platform-verified, active bus with a seat layout can run{notReady ? ` (${notReady} not ready yet)` : ''}. If its layout differs, passengers move to the same seat type.</p>
        <BusHistory tripId={trip.id} />
      </div>
    </Modal>
  );
}

/** Every bus change on this trip: from → to, why, who, and how many passengers were re-seated. */
function BusHistory({ tripId }: { tripId: string }) {
  const q = useQuery({ queryKey: ['bus-history', tripId], queryFn: () => tripOpsApi.busHistory(tripId) });
  if (q.isLoading) return null;
  if (q.isError) return <p className="text-xs text-danger">{errText(q.error, 'Could not load the bus history')}</p>;
  const items = q.data?.items ?? [];
  if (!items.length) return <p className="text-xs text-text-muted">This trip has kept its first bus.</p>;
  return (
    <div>
      <div className="mb-1 font-semibold text-text">Earlier changes</div>
      <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border text-xs">
        {items.map((h) => (
          <li key={h.id} className="px-3 py-1.5">
            <div className="text-text">{h.fromBus ?? 'No bus'} → {h.toBus}{h.seatMoves?.length ? ` · ${h.seatMoves.length} re-seated` : ''}</div>
            <div className="text-text-muted">{h.reason} · {formatDateTime(h.createdAt)}{h.changedBy ? ` · ${h.changedBy}` : ''}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
