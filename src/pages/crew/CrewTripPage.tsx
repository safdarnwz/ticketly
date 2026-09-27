import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Luggage, MapPin, Navigation, Phone, Search, TriangleAlert } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, PageLoader, Select, useToast } from '@/components/ui';
import { crewAppApi, CREW_REPORT_TYPES, SOS_KINDS, type ManifestRow } from '@/lib/api/crewApp';
import { flowApi, type SeatCell } from '@/lib/api/booking-flow';
import { SeatMap } from '@/components/customer/SeatMap';
import type { SeatView } from '@/lib/seat-tones';
import { DELAY_CATEGORIES } from '@/lib/api/operations';
import { cn, formatDateTime, formatTime, idempotencyKey } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const PING_EVERY_MS = 30_000;

/** Where the phone is, if the crew member lets the app know (for reports and the panic button). */
/**
 * Where the bus is, if the phone says within a few seconds. The browser's own
 * timeout does not count while the permission prompt is open, so a report or
 * an SOS never waits on a prompt nobody answers — it goes without a location.
 */
function here(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const give = window.setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => { window.clearTimeout(give); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { window.clearTimeout(give); resolve(null); },
      { timeout: 4000, maximumAge: 60_000 },
    );
  });
}

/** One trip in the crew app: who boards where, boarding, the bus's status, GPS, reports and the panic button. */
export function CrewTripPage() {
  const { tripId = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['crew-me'], queryFn: crewAppApi.me });
  const manifest = useQuery({ queryKey: ['crew-manifest', tripId], queryFn: () => crewAppApi.manifest(tripId), refetchInterval: 20_000 });
  const duty = me.data?.duties.find((d) => d.tripId === tripId);
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [dialog, setDialog] = useState<'report' | 'sos' | 'lost' | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['crew-manifest', tripId] }); void qc.invalidateQueries({ queryKey: ['crew-me'] }); };

  const board = useMutation({
    mutationFn: (ticketId: string) => crewAppApi.board(tripId, ticketId),
    onSuccess: (r) => { toast.success(r.status === 'already_boarded' ? `Seat ${r.seatNumber} was already boarded` : `${r.passenger ?? 'Passenger'} boarded · seat ${r.seatNumber}`); refresh(); },
    onError: (e) => toast.error(errText(e, 'Could not board')),
  });
  const scan = useMutation({
    mutationFn: () => crewAppApi.scan(tripId, code.trim()),
    onSuccess: (r) => { setCode(''); toast.success(r.status === 'already_boarded' ? `Seat ${r.seatNumber} was already boarded` : `${r.passenger ?? 'Passenger'} boarded · seat ${r.seatNumber}`); refresh(); },
    onError: (e) => toast.error(errText(e, 'Not a valid ticket for this bus')),
  });
  const status = useMutation({
    mutationFn: (s: 'departed' | 'closed') => crewAppApi.setStatus(tripId, s),
    onSuccess: (_r, s) => { toast.success(s === 'departed' ? 'Bus marked departed — passengers can track it' : 'Trip closed'); refresh(); },
    onError: (e) => toast.error(errText(e, 'Could not change the trip')),
  });

  const rows = manifest.data?.passengers ?? [];
  const live = rows.filter((r) => r.ticketStatus !== 'cancelled');
  const boarded = live.filter((r) => r.ticketStatus === 'boarded').length;
  const term = q.trim().toLowerCase();
  const shown = live.filter((r) => !term || r.pnr.toLowerCase().includes(term) || r.fullName.toLowerCase().includes(term) || r.seatNumber.toLowerCase() === term || r.contactPhone.includes(term));
  const groups = useMemo(() => {
    const m = new Map<string, { at: string | null; rows: ManifestRow[] }>();
    for (const r of shown) {
      const k = r.boardingPoint ?? 'Boarding point';
      if (!m.has(k)) m.set(k, { at: r.boardsAt, rows: [] });
      m.get(k)!.rows.push(r);
    }
    return [...m.entries()];
  }, [shown]);
  const departed = duty?.tripStatus === 'departed';
  const closed = duty?.tripStatus === 'closed' || duty?.tripStatus === 'completed';

  if (me.isLoading || manifest.isLoading) return <PageLoader />;
  if (manifest.isError) return <ErrorState error={manifest.error} onRetry={manifest.refetch} />;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-lg font-semibold text-text">{duty?.routeName ?? 'Trip'}</span>
            <Badge tone={departed ? 'info' : closed ? 'neutral' : 'success'}>{duty?.tripStatus ?? '—'}</Badge>
          </div>
          <div className="text-text-muted">{duty?.departsAt ? `Leaves ${formatDateTime(duty.departsAt)}` : ''}{duty?.arrivesAt ? ` · arrives ${formatTime(duty.arrivesAt)}` : ''}{duty?.bus ? ` · ${duty.bus}` : ''}</div>
          <div className="flex items-center gap-2"><span className="text-2xl font-semibold text-text">{boarded}</span><span className="text-text-muted">of {live.length} passengers boarded</span></div>
          <div className="flex flex-wrap gap-2">
            {!departed && !closed && <Button loading={status.isPending} disabled={status.isPending} onClick={() => { if (window.confirm('Mark the bus departed? Passengers are told it has left.')) status.mutate('departed'); }}>Bus departed</Button>}
            {departed && <Button variant="outline" loading={status.isPending} disabled={status.isPending} onClick={() => { if (window.confirm('Close the trip — the bus has arrived?')) status.mutate('closed'); }}>Trip complete</Button>}
            <Button variant="outline" leftIcon={<TriangleAlert className="h-4 w-4" />} onClick={() => setDialog('report')}>Report a problem</Button>
            <Button variant="outline" leftIcon={<Luggage className="h-4 w-4" />} onClick={() => setDialog('lost')}>Item left behind</Button>
            <Button variant="danger" leftIcon={<AlertOctagon className="h-4 w-4" />} onClick={() => setDialog('sos')}>Emergency</Button>
          </div>
          <GpsSharing tripId={tripId} active={departed} />
        </CardBody>
      </Card>

      <BusLayout tripId={tripId} rows={live} onChanged={refresh} />

      <Card>
        <CardHeader title="Boarding" subtitle="Check the PNR or ID, then tap Board — or type the code on the e-ticket" />
        <CardBody className="flex flex-col gap-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 3) scan.mutate(); }}>
            <Input aria-label="Ticket code" placeholder="Code on the e-ticket" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <Button type="submit" loading={scan.isPending} disabled={code.trim().length < 3 || scan.isPending}>Check in</Button>
          </form>
          <Input aria-label="Find a passenger" placeholder="PNR, name, seat or mobile" leftIcon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} />
          {live.length === 0 ? <EmptyState title="No passengers booked yet" /> : shown.length === 0 ? <EmptyState title="Nobody matches" /> : groups.map(([point, g]) => (
            <div key={point}>
              <div className="mb-1 flex items-center gap-1 text-sm font-semibold text-text"><MapPin className="h-4 w-4 text-primary" /> {point}{g.at ? <span className="font-normal text-text-muted"> · {formatTime(g.at)}</span> : null}</div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {g.rows.map((r) => (
                  <li key={`${r.pnr}-${r.seatNumber}`} className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm', r.ticketStatus === 'boarded' && 'bg-success/5')}>
                    <div>
                      <div className="font-medium text-text">Seat {r.seatNumber} · {r.fullName}{r.age != null ? `, ${r.age}` : ''}{r.gender ? ` ${r.gender[0].toUpperCase()}` : ''} {r.ladiesSeat && <Badge tone="warning">ladies seat</Badge>}</div>
                      <div className="text-xs text-text-muted">PNR <span className="font-mono">{r.pnr}</span> · to {r.droppingPoint ?? '—'} · <a className="text-primary" href={`tel:${r.contactPhone}`}><Phone className="inline h-3 w-3" /> {r.contactPhone}</a></div>
                      {r.ladiesSeat && r.gender && r.gender !== 'female' && <div className="text-xs text-danger">Ladies seat — a man cannot sit here; move him or call the depot.</div>}
                    </div>
                    {r.ticketStatus === 'boarded' ? <Badge tone="success">boarded</Badge>
                      : r.ticketStatus === 'no_show' ? <Badge tone="danger">no-show</Badge>
                      : <Button size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={board.isPending && board.variables === r.ticketId} disabled={!r.ticketId || board.isPending} onClick={() => r.ticketId && board.mutate(r.ticketId)}>Board</Button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>
      {dialog === 'report' && <ReportModal tripId={tripId} onClose={() => setDialog(null)} />}
      {dialog === 'sos' && <SosModal tripId={tripId} onClose={() => setDialog(null)} />}
      {dialog === 'lost' && <LostModal tripId={tripId} seats={live.map((r) => r.seatNumber)} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** While the bus is on the road, the phone sends its position every 30 s for live tracking. */
function GpsSharing({ tripId, active }: { tripId: string; active: boolean }) {
  const [on, setOn] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const pos = useRef<{ lat: number; lng: number; speed: number; heading?: number } | null>(null);
  useEffect(() => {
    if (!on || !active || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => { pos.current = { lat: p.coords.latitude, lng: p.coords.longitude, speed: Math.max(0, (p.coords.speed ?? 0) * 3.6), heading: p.coords.heading ?? undefined }; setErr(''); },
      (e) => setErr(e.code === 1 ? 'Location permission is off — allow it for live tracking' : 'No GPS signal'),
      { enableHighAccuracy: true },
    );
    const send = () => {
      const p = pos.current;
      if (!p) return;
      crewAppApi.ping(tripId, { lat: p.lat, lng: p.lng, speedKmph: Math.min(200, Math.round(p.speed)), headingDeg: p.heading })
        .then(() => setLast(new Date().toISOString())).catch((e: unknown) => setErr(errText(e, 'Could not send the position')));
    };
    const t = setInterval(send, PING_EVERY_MS);
    setTimeout(send, 3000);
    return () => { navigator.geolocation.clearWatch(watch); clearInterval(t); };
  }, [on, active, tripId]);
  if (!active) return <p className="flex items-center gap-1 text-xs text-text-muted"><Navigation className="h-3.5 w-3.5" /> Live tracking starts once the bus is marked departed.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label="Share live location" /> Share live location</label>
      {on && <span className={err ? 'text-danger' : 'text-text-muted'}>{err || (last ? `last sent ${formatTime(last)}` : 'waiting for GPS…')}</span>}
    </div>
  );
}

function ReportModal({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ type: 'delay', description: '', delayCategory: '', delayMinutes: '' });
  const [tried, setTried] = useState(false);
  const [key] = useState(() => idempotencyKey('crew-report'));
  const errors: Record<string, string> = {};
  if (f.description.trim().length < 5) errors.description = 'Say what happened (a few words)';
  if (f.type === 'delay') {
    if (!f.delayCategory) errors.delayCategory = 'Why is the bus late?';
    const m = Number(f.delayMinutes);
    if (!Number.isInteger(m) || m < 1 || m > 1440) errors.delayMinutes = '1 minute to 24 hours';
  }
  const go = useMutation({
    mutationFn: async () => {
      const at = await here();
      return crewAppApi.report(tripId, { type: f.type, description: f.description.trim(), ...(f.type === 'delay' ? { delayCategory: f.delayCategory, delayMinutes: Number(f.delayMinutes) } : {}), ...(at ?? {}) }, key);
    },
    onSuccess: () => { toast.success(f.type === 'delay' ? 'Reported — passengers are being told' : 'Reported to the depot'); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not report')),
  });
  const err = (k: string) => (tried ? errors[k] : undefined);
  return (
    <Modal open onClose={onClose} title="Report a problem"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={go.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) go.mutate(); }}>Send</Button></>}>
      <div className="flex flex-col gap-3">
        <Select label="What happened" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={CREW_REPORT_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        {f.type === 'delay' && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Reason" value={f.delayCategory} error={err('delayCategory')} onChange={(e) => setF({ ...f, delayCategory: e.target.value })} options={[{ value: '', label: 'Choose' }, ...DELAY_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') }))]} />
            <Input label="Minutes late" type="number" min={1} max={1440} value={f.delayMinutes} error={err('delayMinutes')} onChange={(e) => setF({ ...f, delayMinutes: e.target.value })} />
          </div>
        )}
        <Input label="Details" value={f.description} maxLength={2000} error={err('description')} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={f.type === 'complaint' ? 'What the passenger said (seat / PNR helps)' : 'Where and what'} />
      </div>
    </Modal>
  );
}

function SosModal({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState('medical');
  const [note, setNote] = useState('');
  const [key] = useState(() => idempotencyKey('crew-sos'));
  const go = useMutation({
    mutationFn: async () => crewAppApi.sos(tripId, { kind, description: note.trim() || undefined, ...((await here()) ?? {}) }, key),
    onSuccess: () => { toast.success('Emergency team alerted — stay with the passengers, help is on the way'); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not send — call the depot now')),
  });
  return (
    <Modal open onClose={onClose} title="Emergency"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button variant="danger" loading={go.isPending} disabled={go.isPending} onClick={() => go.mutate()}>Send alert now</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-danger">Only for a real emergency — the emergency team and the depot are alerted at once, with your location.</p>
        <Select label="What kind" value={kind} onChange={(e) => setKind(e.target.value)} options={SOS_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <Input label="Anything to add (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function LostModal({ tripId, seats, onClose }: { tripId: string; seats: string[]; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ description: '', seatNumber: '', storedAt: '' });
  const [tried, setTried] = useState(false);
  const [key] = useState(() => idempotencyKey('crew-lost'));
  const bad = f.description.trim().length < 3;
  const go = useMutation({
    mutationFn: () => crewAppApi.lostItem(tripId, { description: f.description.trim(), seatNumber: f.seatNumber || undefined, storedAt: f.storedAt.trim() || undefined }, key),
    onSuccess: () => { toast.success('Logged — the depot keeps it for the owner'); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not log it')),
  });
  return (
    <Modal open onClose={onClose} title="Item left behind"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={go.isPending} onClick={() => { setTried(true); if (!bad) go.mutate(); }}>Log item</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label="What is it" value={f.description} maxLength={500} error={tried && bad ? 'Describe the item' : undefined} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Black backpack with a laptop" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Found at seat" value={f.seatNumber} onChange={(e) => setF({ ...f, seatNumber: e.target.value })} options={[{ value: '', label: 'Not sure' }, ...seats.map((s) => ({ value: s, label: s }))]} />
          <Input label="Kept where" value={f.storedAt} maxLength={120} onChange={(e) => setF({ ...f, storedAt: e.target.value })} placeholder="e.g. Jaipur depot" />
        </div>
      </div>
    </Modal>
  );
}

/** How a seat looks to the crew: who is on it and where they are in the journey. */
function crewView(rows: ManifestRow[] | undefined): SeatView {
  if (!rows?.length) return { tone: 'empty', clickable: false };
  const r = rows.find((x) => x.ticketStatus === 'boarded' && !x.checkedOutAt) ?? rows.find((x) => x.ticketStatus === 'valid') ?? rows[0];
  const bags = rows.reduce((a, x) => a + (x.luggageCount ?? 0), 0);
  const tone = r.checkedOutAt ? 'checkedOut' : r.ticketStatus === 'boarded' ? 'boarded' : r.ticketStatus === 'no_show' ? 'noShow' : 'pending';
  return { tone, caption: r.fullName.split(' ')[0].slice(0, 7), badge: bags ? `${bags}🧳` : undefined, clickable: true };
}

/**
 * The bus as it is laid out, for the crew: every booked seat shows who is on
 * it and whether they have checked in or out; tapping a seat opens the
 * passenger to check in, count and tag their bags, and check out.
 */
function BusLayout({ tripId, rows, onChanged }: { tripId: string; rows: ManifestRow[]; onChanged: () => void }) {
  const trip = useQuery({ queryKey: ['crew-trip-detail', tripId], queryFn: () => flowApi.trip(tripId) });
  const stops = trip.data?.stops ?? [];
  const first = stops[0]?.stopId;
  const last = stops[stops.length - 1]?.stopId;
  const map = useQuery({
    queryKey: ['crew-layout', tripId, first, last],
    queryFn: () => flowApi.availability(tripId, first!, last!),
    enabled: Boolean(first && last && first !== last),
    refetchInterval: 30_000,
  });
  const bySeat = useMemo(() => {
    const m = new Map<string, ManifestRow[]>();
    for (const r of rows) m.set(r.seatNumber, [...(m.get(r.seatNumber) ?? []), r]);
    return m;
  }, [rows]);
  const [open, setOpen] = useState<string | null>(null);
  const counts = {
    toBoard: rows.filter((r) => r.ticketStatus === 'valid').length,
    onBoard: rows.filter((r) => r.ticketStatus === 'boarded' && !r.checkedOutAt).length,
    out: rows.filter((r) => r.checkedOutAt).length,
    bags: rows.reduce((a, r) => a + (r.luggageCount ?? 0), 0),
  };
  return (
    <Card>
      <CardHeader title="Bus layout" subtitle="Tap a seat to check the passenger in, record their bags, or check them out" />
      <CardBody className="flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          {[['To board', counts.toBoard], ['On board', counts.onBoard], ['Checked out', counts.out], ['Bags', counts.bags]].map(([k, v]) => (
            <div key={k} className="rounded-md border border-border px-2 py-1.5"><div className="text-lg font-semibold text-text">{v}</div><div className="text-text-muted">{k}</div></div>
          ))}
        </div>
        {trip.isLoading || map.isLoading ? <PageLoader /> : map.isError ? <ErrorState error={map.error} onRetry={map.refetch} /> : map.data ? (
          <SeatMap map={map.data} legend="crew" viewOf={(s: SeatCell) => crewView(bySeat.get(s.seatNumber))} onSeatClick={(s) => setOpen(s.seatNumber)} />
        ) : null}
      </CardBody>
      {open && <SeatPassengers tripId={tripId} seat={open} rows={bySeat.get(open) ?? []} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </Card>
  );
}

/** One seat's passenger(s): details, check-in, bags with tag numbers, check-out. */
function SeatPassengers({ tripId, seat, rows, onClose, onChanged }: { tripId: string; seat: string; rows: ManifestRow[]; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Seat ${seat}`} size="md">
      <div className="flex flex-col gap-4">
        {rows.length === 0 ? <EmptyState title="Nobody booked on this seat" /> : rows.map((r) => <PassengerCard key={`${r.pnr}-${r.ticketId}`} tripId={tripId} row={r} onChanged={onChanged} />)}
      </div>
    </Modal>
  );
}

function PassengerCard({ tripId, row, onChanged }: { tripId: string; row: ManifestRow; onChanged: () => void }) {
  const toast = useToast();
  const [count, setCount] = useState(row.luggageCount ?? 0);
  const [tags, setTags] = useState<string[]>(row.luggageTags ?? []);
  const [err, setErr] = useState('');
  const boarded = row.ticketStatus === 'boarded';
  const out = Boolean(row.checkedOutAt);
  const ticketId = row.ticketId ?? '';
  const done = (m: string) => { toast.success(m); onChanged(); };
  const board = useMutation({ mutationFn: () => crewAppApi.board(tripId, ticketId), onSuccess: () => done(`${row.fullName} checked in`), onError: (e) => setErr(errText(e, 'Could not check in')) });
  const bags = useMutation({
    mutationFn: () => crewAppApi.luggage(tripId, ticketId, count, tags.map((t) => t.trim().toUpperCase()).filter(Boolean)),
    onSuccess: (r) => done(`${r.luggageCount} bag${r.luggageCount === 1 ? '' : 's'} saved for seat ${r.seatNumber}`),
    onError: (e) => setErr(errText(e, 'Could not save the bags')),
  });
  const checkout = useMutation({ mutationFn: () => crewAppApi.checkout(tripId, ticketId), onSuccess: () => done(`${row.fullName} checked out`), onError: (e) => setErr(errText(e, 'Could not check out')) });
  const busy = board.isPending || bags.isPending || checkout.isPending;
  const setCountTo = (n: number) => { const c = Math.max(0, Math.min(20, n)); setCount(c); setTags((t) => t.slice(0, c)); };
  const tagProblem = tags.filter(Boolean).some((t) => !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(t.trim())) ? 'A tag is 1–20 letters, digits or dashes'
    : new Set(tags.filter(Boolean).map((t) => t.trim().toUpperCase())).size !== tags.filter(Boolean).length ? 'A tag number is listed twice' : '';
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-text">{row.fullName}</div>
          <div className="text-text-muted">{[row.age != null ? `${row.age} yrs` : null, row.gender, row.category && row.category !== 'adult' ? row.category : null].filter(Boolean).join(' · ')}</div>
        </div>
        <Badge tone={out ? 'neutral' : boarded ? 'success' : row.ticketStatus === 'no_show' ? 'danger' : 'warning'}>{out ? 'checked out' : boarded ? 'on board' : row.ticketStatus === 'no_show' ? 'no-show' : 'to board'}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-muted">PNR</dt><dd className="font-mono text-text">{row.pnr}</dd>
        <dt className="text-text-muted">Mobile</dt><dd><a className="text-primary" href={`tel:${row.contactPhone}`}><Phone className="inline h-3 w-3" /> {row.contactPhone}</a></dd>
        <dt className="text-text-muted">Boards at</dt><dd className="text-text">{row.boardingPoint ?? '—'}{row.boardsAt ? ` · ${formatTime(row.boardsAt)}` : ''}</dd>
        <dt className="text-text-muted">Gets off at</dt><dd className="text-text">{row.droppingPoint ?? '—'}</dd>
        {row.boardedAt && <><dt className="text-text-muted">Checked in</dt><dd className="text-text">{formatTime(row.boardedAt)}</dd></>}
        {row.checkedOutAt && <><dt className="text-text-muted">Checked out</dt><dd className="text-text">{formatTime(row.checkedOutAt)}</dd></>}
      </dl>
      {row.ladiesSeat && row.gender && row.gender !== 'female' && <div className="mt-2 text-xs text-danger">Ladies seat — a man cannot sit here; move him or call the depot.</div>}

      <div className="mt-3 rounded-md bg-surface-muted p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1 font-medium text-text"><Luggage className="h-4 w-4" /> Bags</span>
          <div className="flex items-center gap-2" role="group" aria-label="Number of bags">
            <Button size="sm" variant="outline" aria-label="One bag less" disabled={out || busy || count === 0} onClick={() => setCountTo(count - 1)}>−</Button>
            <span className="w-6 text-center text-base font-semibold text-text" aria-live="polite">{count}</span>
            <Button size="sm" variant="outline" aria-label="One bag more" disabled={out || busy || count >= 20} onClick={() => setCountTo(count + 1)}>+</Button>
          </div>
        </div>
        {count > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: count }, (_, i) => (
              <Input key={i} aria-label={`Tag number of bag ${i + 1}`} placeholder={`Bag ${i + 1} tag`} value={tags[i] ?? ''} disabled={out || busy}
                onChange={(e) => setTags((t) => { const n = [...t]; n[i] = e.target.value.toUpperCase(); return n; })} />
            ))}
          </div>
        )}
        {tagProblem && <div className="mt-1 text-xs text-danger">{tagProblem}</div>}
        {!out && <Button size="sm" className="mt-2" variant="outline" loading={bags.isPending} disabled={busy || Boolean(tagProblem) || !ticketId} onClick={() => { setErr(''); bags.mutate(); }}>Save bags</Button>}
      </div>

      {err && <div role="alert" className="mt-2 text-xs text-danger">{err}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {row.ticketStatus === 'valid' && <Button leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={board.isPending} disabled={busy || !ticketId} onClick={() => { setErr(''); board.mutate(); }}>Check in</Button>}
        {boarded && !out && <Button variant="outline" loading={checkout.isPending} disabled={busy} onClick={() => { if (window.confirm(`Check ${row.fullName} out at ${row.droppingPoint ?? 'the drop point'}? Bags handed back?`)) { setErr(''); checkout.mutate(); } }}>Check out</Button>}
      </div>
    </div>
  );
}
