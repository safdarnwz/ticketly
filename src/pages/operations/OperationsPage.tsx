import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, ClipboardList, Navigation, PackageSearch, Plus, ShieldAlert } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, type Column, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { branchesApi } from '@/lib/api/branches';
import { DELAY_CATEGORIES, INCIDENT_TYPES, operationsApi, type BusOnRoad, type Incident, type LostItem } from '@/lib/api/operations';
import { schedulingApi } from '@/lib/api/scheduling';
import { cn, formatDateTime, formatTime, idempotencyKey, todayLocal } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const typeLabel = (t: string) => INCIDENT_TYPES.find((x) => x.value === t)?.label ?? (t === 'sos' ? 'SOS / panic' : t);
const SEVERITY_TONE = { critical: 'danger', high: 'warning', normal: 'neutral' } as const;
const STATUS_TONE = { open: 'danger', acknowledged: 'warning', resolved: 'success', closed: 'neutral' } as const;
const DISPOSE_AFTER_DAYS = 30;

type Tab = 'road' | 'incidents' | 'lost' | 'notes';

/** The dispatch desk: incidents on the road, lost & found, and shift handover notes. */
export function OperationsPage() {
  const [tab, setTab] = useState<Tab>('road');
  const tabs = [
    { key: 'road' as const, label: 'On the road', icon: Navigation },
    { key: 'incidents' as const, label: 'Incidents', icon: ShieldAlert },
    { key: 'lost' as const, label: 'Lost & found', icon: PackageSearch },
    { key: 'notes' as const, label: 'Shift notes', icon: ClipboardList },
  ];
  return (
    <>
      <PageHeader title="Operations" subtitle="Incidents on the road, lost & found, and handover between shifts" />
      <div className="mb-6 flex gap-2 border-b border-border">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'road' && <OnTheRoad />}
      {tab === 'incidents' && <Incidents />}
      {tab === 'lost' && <LostFound />}
      {tab === 'notes' && <ShiftNotes />}
    </>
  );
}

/** Pick a trip by day — optional, e.g. for a depot incident. */
function TripPicker({ value, onChange, label = 'Trip' }: { value: string; onChange: (id: string) => void; label?: string }) {
  const [date, setDate] = useState(todayLocal());
  const trips = useQuery({ queryKey: ['trips', date], queryFn: () => schedulingApi.listTrips(date) });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Input label={`${label} date`} type="date" value={date} onChange={(e) => { setDate(e.target.value); onChange(''); }} />
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}
        options={[{ label: trips.isLoading ? 'Loading…' : trips.data?.items.length ? 'Not tied to a trip' : 'No trips that day', value: '' },
          ...(trips.data?.items ?? []).map((t) => ({ value: t.id, label: `${t.routeName} · ${formatDateTime(t.departsAt)}${t.status === 'cancelled' ? ' (cancelled)' : ''}` }))]} />
    </div>
  );
}

/* ── on the road ───────────────────────────────────────────────────────── */

const SIGNAL_LOST_MS = 10 * 60_000;

/** Every bus that has left and not arrived, with its last GPS fix — refreshes every 30 seconds. */
function OnTheRoad() {
  const q = useQuery({ queryKey: ['on-the-road'], queryFn: operationsApi.onTheRoad, refetchInterval: 30_000 });
  const now = Date.now();
  const columns: Column<BusOnRoad>[] = [
    { key: 'bus', header: 'Bus', render: (r) => <div><Link className="font-medium text-primary hover:underline" to={`/trips/${r.tripId}`}>{r.routeName}</Link><div className="font-mono text-xs text-text-muted">{r.bus ?? 'no bus assigned'} · left {formatTime(r.departsAt)}</div></div> },
    { key: 'where', header: 'Where', render: (r) => r.lat == null || r.lng == null ? <span className="text-text-muted">No GPS yet</span>
      : <a className="text-primary underline" href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">{Number(r.lat).toFixed(4)}, {Number(r.lng).toFixed(4)}</a> },
    { key: 'speed', header: 'Speed', render: (r) => (r.speedKmph == null ? '—' : `${Math.round(Number(r.speedKmph))} km/h`) },
    { key: 'next', header: 'Next stop', render: (r) => r.nextStop ? <span>{r.nextStop}{r.nextStopEtaAt ? <span className="text-text-muted"> · {formatTime(r.nextStopEtaAt)}</span> : null}</span> : '—' },
    { key: 'late', header: 'Running', render: (r) => { const d = Number(r.delayMinutes); return d > 0 && d < 1440 ? <Badge tone="warning">{d} min late</Badge> : d < -5 && d > -1440 ? <Badge tone="success">{-d} min early</Badge> : <span className="text-text-muted">on time</span>; } },
    { key: 'ping', header: 'Signal', render: (r) => !r.lastPingAt ? <Badge tone="danger">none</Badge>
      : now - new Date(r.lastPingAt).getTime() > SIGNAL_LOST_MS ? <Badge tone="danger">lost · {formatTime(r.lastPingAt)}</Badge>
        : <span className="text-xs text-text-muted">{formatTime(r.lastPingAt)}</span> },
  ];
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const items = q.data?.items ?? [];
  const lost = items.filter((r) => !r.lastPingAt || now - new Date(r.lastPingAt).getTime() > SIGNAL_LOST_MS).length;
  return (
    <>
      <p className="mb-3 text-sm text-text-muted">{items.length} bus{items.length === 1 ? '' : 'es'} on the road{lost ? ` · ${lost} without a recent GPS signal` : ''}. Positions come from the crew app.</p>
      {items.length ? <Table columns={columns} rows={items} /> : <EmptyState title="No bus is on the road right now" icon={<Navigation className="h-10 w-10" />} />}
    </>
  );
}

/* ── incidents ─────────────────────────────────────────────────────────── */

function Incidents() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('active');
  const [reporting, setReporting] = useState(false);
  const [resolving, setResolving] = useState<Incident | null>(null);
  const q = useQuery({ queryKey: ['incidents', status], queryFn: () => operationsApi.incidents({ status: status || undefined }), refetchInterval: 30_000 });
  const move = useMutation({
    mutationFn: (v: { id: string; to: 'acknowledged' | 'closed' }) => operationsApi.moveIncident(v.id, v.to),
    onSuccess: (r) => { toast.success(r.status === 'acknowledged' ? 'Acknowledged — the reporter knows someone is on it' : 'Closed'); void qc.invalidateQueries({ queryKey: ['incidents'] }); },
    onError: (e) => toast.error(errText(e, 'Could not update')),
  });
  const columns: Column<Incident>[] = [
    { key: 'what', header: 'Incident', render: (r) => (
      <div className="max-w-md">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge><span className="font-medium text-text">{typeLabel(r.type)}</span>
          {r.overdue && <span className="flex items-center gap-1 text-xs text-danger"><AlertTriangle className="h-3 w-3" /> not acknowledged in time</span>}</div>
        {r.description && <p className="mt-1 text-sm text-text-muted">{r.description}</p>}
        {r.type === 'delay' && <p className="text-xs text-text-muted">{r.delay_minutes} min · {r.delay_category?.replace('_', ' ')}</p>}
        {r.diversion_via && <p className="text-xs text-text-muted">Via {r.diversion_via}</p>}
        {r.resolution_note && <p className="mt-1 text-xs text-success">Resolved: {r.resolution_note}</p>}
      </div>
    ) },
    { key: 'trip', header: 'Trip', render: (r) => <span className="text-text-muted">{r.trip_label ?? '—'}</span> },
    { key: 'when', header: 'Reported', render: (r) => <div className="text-sm">{formatDateTime(r.created_at)}<div className="text-xs text-text-muted">{r.reported_by_name ?? ''}</div></div> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge> },
    { key: 'act', header: '', render: (r) => (
      <div className="flex justify-end gap-1">
        {r.status === 'open' && <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ id: r.id, to: 'acknowledged' })}>Acknowledge</Button>}
        {(r.status === 'open' || r.status === 'acknowledged') && <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => setResolving(r)}>Resolve</Button>}
        {r.status === 'resolved' && <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ id: r.id, to: 'closed' })}>Close</Button>}
      </div>
    ) },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ label: 'Needs attention (open + acknowledged)', value: 'active' }, { label: 'Resolved', value: 'resolved' }, { label: 'Closed', value: 'closed' }, { label: 'All', value: '' }]} />
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setReporting(true)}>Report incident</Button>
      </div>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> :
        q.data?.items.length ? <Table columns={columns} rows={q.data.items} /> : <EmptyState title={status === 'active' ? 'Nothing needs attention' : 'No incidents here'} icon={<ShieldAlert className="h-10 w-10" />} />}
      {reporting && <ReportIncidentModal onClose={() => setReporting(false)} />}
      {resolving && <ResolveModal incident={resolving} onClose={() => setResolving(null)} />}
    </>
  );
}

function ReportIncidentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('incident'));
  const [f, setF] = useState({ type: 'breakdown', tripId: '', description: '', delayCategory: '', delayMinutes: '', diversionVia: '' });
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (f.description.trim().length < 5) errors.description = 'Describe what happened (at least 5 characters)';
  if (f.type === 'delay') {
    if (!f.tripId) errors.tripId = 'A delay is for a trip — pick it';
    if (!f.delayCategory) errors.delayCategory = 'Why is it late?';
    const m = Number(f.delayMinutes);
    if (!Number.isInteger(m) || m < 1 || m > 1440) errors.delayMinutes = '1 minute to 24 hours';
  }
  if (f.type === 'diversion') {
    if (!f.tripId) errors.tripId = 'A diversion is for a trip — pick it';
    if (f.diversionVia.trim().length < 3) errors.diversionVia = 'Which way is the bus going?';
  }
  const save = useMutation({
    mutationFn: () => operationsApi.reportIncident({
      type: f.type, tripId: f.tripId || undefined, description: f.description.trim(),
      ...(f.type === 'delay' ? { delayCategory: f.delayCategory, delayMinutes: Number(f.delayMinutes) } : {}),
      ...(f.type === 'diversion' ? { diversionVia: f.diversionVia.trim() } : {}),
    }, key),
    onSuccess: (r) => {
      toast.success(r.severity === 'critical' ? 'Reported — emergency contacts are being alerted' : f.type === 'delay' || f.type === 'diversion' ? 'Reported — passengers are being told' : 'Incident reported');
      void qc.invalidateQueries({ queryKey: ['incidents'] });
      onClose();
    },
    onError: (e) => toast.error(errText(e, 'Could not report')),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const critical = ['accident', 'medical', 'security'].includes(f.type);
  return (
    <Modal open onClose={onClose} title="Report an incident"
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant={critical ? 'danger' : 'primary'} loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) save.mutate(); }}>Report</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <Select label="What happened" value={f.type} onChange={set('type')} options={INCIDENT_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        {critical && <p className="rounded-md bg-danger/10 px-3 py-2 text-danger">Critical — emergency contacts are alerted as soon as you report, and it must be acknowledged within 5 minutes.</p>}
        <TripPicker value={f.tripId} onChange={(id) => setF((x) => ({ ...x, tripId: id }))} />
        {tried && errors.tripId && <span role="alert" className="-mt-2 text-xs text-danger">{errors.tripId}</span>}
        {f.type === 'delay' && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Reason" value={f.delayCategory} onChange={set('delayCategory')} error={tried ? errors.delayCategory : undefined}
              options={[{ label: 'Choose…', value: '' }, ...DELAY_CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') }))]} />
            <Input label="Minutes late" type="number" min={1} max={1440} value={f.delayMinutes} onChange={set('delayMinutes')} error={tried ? errors.delayMinutes : undefined} />
          </div>
        )}
        {f.type === 'diversion' && <Input label="Diverted via" value={f.diversionVia} maxLength={300} onChange={set('diversionVia')} error={tried ? errors.diversionVia : undefined} placeholder="e.g. Rewari bypass" />}
        <label className="flex flex-col gap-1"><span className="font-medium text-text">Details</span>
          <textarea className="min-h-20 rounded-md border border-border bg-surface p-2" maxLength={2000} value={f.description} onChange={set('description')} />
          {tried && errors.description && <span role="alert" className="text-xs text-danger">{errors.description}</span>}</label>
      </div>
    </Modal>
  );
}

function ResolveModal({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const error = note.trim().length < 5 ? 'Say how it was resolved (at least 5 characters)' : '';
  const save = useMutation({
    mutationFn: () => operationsApi.moveIncident(incident.id, 'resolved', note.trim()),
    onSuccess: () => { toast.success('Resolved'); void qc.invalidateQueries({ queryKey: ['incidents'] }); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not resolve')),
  });
  return (
    <Modal open onClose={onClose} title={`Resolve: ${typeLabel(incident.type)}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!error) save.mutate(); }}>Resolve</Button></>}>
      <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-text">Resolution</span>
        <textarea className="min-h-20 rounded-md border border-border bg-surface p-2" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        {tried && error && <span role="alert" className="text-xs text-danger">{error}</span>}</label>
    </Modal>
  );
}

/* ── lost & found ──────────────────────────────────────────────────────── */

function LostFound() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('found');
  const [logging, setLogging] = useState(false);
  const [claiming, setClaiming] = useState<LostItem | null>(null);
  const q = useQuery({ queryKey: ['lost-found', status], queryFn: () => operationsApi.lostItems(status || undefined) });
  const dispose = useMutation({
    mutationFn: (id: string) => operationsApi.disposeItem(id),
    onSuccess: () => { toast.success('Marked disposed'); void qc.invalidateQueries({ queryKey: ['lost-found'] }); },
    onError: (e) => toast.error(errText(e, 'Could not dispose')),
  });
  const now = Date.now();
  const columns: Column<LostItem>[] = [
    { key: 'item', header: 'Item', render: (r) => <div><div className="font-medium text-text">{r.description}</div><div className="text-xs text-text-muted">{[r.seat_number && `seat ${r.seat_number}`, r.stored_at && `kept at ${r.stored_at}`].filter(Boolean).join(' · ') || '—'}</div></div> },
    { key: 'trip', header: 'Found on', render: (r) => <span className="text-text-muted">{r.trip_label ?? 'Not tied to a trip'}</span> },
    { key: 'when', header: 'Found', render: (r) => formatDateTime(r.found_at) },
    { key: 'status', header: 'Status', render: (r) => (
      <div><Badge tone={r.status === 'found' ? 'warning' : r.status === 'claimed' ? 'success' : 'neutral'}>{r.status}</Badge>
        {r.status === 'claimed' && <div className="text-xs text-text-muted">{r.claimant_name}{r.claim_pnr ? ` · ${r.claim_pnr}` : ''}</div>}</div>
    ) },
    { key: 'act', header: '', render: (r) => {
      if (r.status !== 'found') return null;
      const daysKept = Math.floor((now - new Date(r.found_at).getTime()) / 86_400_000);
      const canDispose = daysKept >= DISPOSE_AFTER_DAYS;
      return (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setClaiming(r)}>Hand back</Button>
          <Button size="sm" variant="ghost" leftIcon={<Archive className="h-3.5 w-3.5" />} disabled={!canDispose || dispose.isPending}
            title={canDispose ? undefined : `Kept ${DISPOSE_AFTER_DAYS} days before disposal — ${DISPOSE_AFTER_DAYS - daysKept} to go`}
            onClick={() => { if (window.confirm('Mark this item disposed? This cannot be undone.')) dispose.mutate(r.id); }}>Dispose</Button>
        </div>
      );
    } },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ label: 'Waiting to be claimed', value: 'found' }, { label: 'Handed back', value: 'claimed' }, { label: 'Disposed', value: 'disposed' }, { label: 'All', value: '' }]} />
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setLogging(true)}>Log found item</Button>
      </div>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> :
        q.data?.items.length ? <Table columns={columns} rows={q.data.items} /> : <EmptyState title="Nothing here" icon={<PackageSearch className="h-10 w-10" />} />}
      {logging && <LogItemModal onClose={() => setLogging(false)} />}
      {claiming && <ClaimModal item={claiming} onClose={() => setClaiming(null)} />}
    </>
  );
}

function LogItemModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('lost'));
  const [f, setF] = useState({ tripId: '', description: '', seatNumber: '', storedAt: '' });
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (f.description.trim().length < 3) errors.description = 'What is it? (at least 3 characters)';
  const save = useMutation({
    mutationFn: () => operationsApi.logItem({ tripId: f.tripId || undefined, description: f.description.trim(), seatNumber: f.seatNumber.trim() || undefined, storedAt: f.storedAt.trim() || undefined }, key),
    onSuccess: () => { toast.success('Item logged'); void qc.invalidateQueries({ queryKey: ['lost-found'] }); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not log')),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title="Log a found item"
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) save.mutate(); }}>Log item</Button></>}>
      <div className="flex flex-col gap-3">
        <Input label="Item" value={f.description} maxLength={500} onChange={set('description')} error={tried ? errors.description : undefined} placeholder="e.g. Black backpack with laptop" />
        <TripPicker value={f.tripId} onChange={(id) => setF((x) => ({ ...x, tripId: id }))} label="Found on trip" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Seat (optional)" value={f.seatNumber} maxLength={10} onChange={set('seatNumber')} />
          <Input label="Kept at (optional)" value={f.storedAt} maxLength={120} onChange={set('storedAt')} placeholder="e.g. Jaipur office locker 3" />
        </div>
        {f.tripId && <p className="text-xs text-text-muted">Only a passenger of this trip (by PNR) can collect it.</p>}
      </div>
    </Modal>
  );
}

function ClaimModal({ item, onClose }: { item: LostItem; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [pnr, setPnr] = useState('');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState('');
  const errors: Record<string, string> = {};
  if (name.trim().length < 2) errors.name = 'Who is collecting it?';
  if (item.trip_id && !pnr.trim()) errors.pnr = 'Their PNR for this trip';
  const save = useMutation({
    mutationFn: () => operationsApi.claimItem(item.id, { claimantName: name.trim(), pnr: pnr.trim() || undefined }),
    onSuccess: () => { toast.success('Handed back'); void qc.invalidateQueries({ queryKey: ['lost-found'] }); onClose(); },
    onError: (e) => { const m = errText(e, 'Could not hand back'); setServerError(e instanceof ApiError && e.status === 422 ? m : ''); toast.error(m); },
  });
  return (
    <Modal open onClose={onClose} title={`Hand back: ${item.description}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); setServerError(''); if (!Object.keys(errors).length) save.mutate(); }}>Hand back</Button></>}>
      <div className="flex flex-col gap-3">
        {serverError && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{serverError}</p>}
        <Input label="Collected by" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} error={tried ? errors.name : undefined} />
        <Input label={`PNR${item.trip_id ? ' *' : ' (optional)'}`} value={pnr} maxLength={20} onChange={(e) => { setPnr(e.target.value.toUpperCase()); setServerError(''); }} error={tried ? errors.pnr : undefined}
          hint={item.trip_label ? `Must be a booking on ${item.trip_label}` : undefined} />
      </div>
    </Modal>
  );
}

/* ── shift notes ───────────────────────────────────────────────────────── */

function ShiftNotes() {
  const qc = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<'dispatch' | 'branch'>('dispatch');
  const [branchId, setBranchId] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(() => idempotencyKey('note'));
  const [tried, setTried] = useState(false);
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list, enabled: scope === 'branch' });
  const active = (branches.data?.items ?? []).filter((b) => b.status === 'active');
  const q = useQuery({ queryKey: ['shift-notes', scope, branchId], queryFn: () => operationsApi.notes(scope, branchId || undefined), enabled: scope === 'dispatch' || !!branchId });
  const errors: Record<string, string> = {};
  if (note.trim().length < 2) errors.note = 'Write the note';
  if (scope === 'branch' && !branchId) errors.branch = 'Pick the branch';
  const save = useMutation({
    mutationFn: () => operationsApi.addNote({ scope, note: note.trim(), branchId: scope === 'branch' ? branchId : undefined }, key),
    onSuccess: () => { toast.success('Note saved for the next shift'); setNote(''); setTried(false); setKey(idempotencyKey('note')); void qc.invalidateQueries({ queryKey: ['shift-notes'] }); },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2"><CardBody className="flex flex-col gap-3">
        <div className="font-semibold text-text">Leave a note for the next shift</div>
        <Select label="For" value={scope} onChange={(e) => { setScope(e.target.value as 'dispatch' | 'branch'); setBranchId(''); }} options={[{ label: 'Dispatch desk', value: 'dispatch' }, { label: 'A branch counter', value: 'branch' }]} />
        {scope === 'branch' && (
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} error={tried ? errors.branch : undefined}
            options={[{ label: branches.isLoading ? 'Loading…' : active.length ? 'Choose…' : 'No open branches', value: '' }, ...active.map((b) => ({ value: b.id, label: b.name }))]} />
        )}
        <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-text">Note</span>
          <textarea className="min-h-28 rounded-md border border-border bg-surface p-2" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bus RJ14PA1234 AC weak — mechanic booked 6 am" />
          {tried && errors.note && <span role="alert" className="text-xs text-danger">{errors.note}</span>}</label>
        <div className="flex justify-end"><Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) save.mutate(); }}>Save note</Button></div>
      </CardBody></Card>
      <div className="lg:col-span-3">
        <div className="mb-2 text-sm font-semibold text-text">Latest notes {scope === 'dispatch' ? 'for the dispatch desk' : 'for this branch'}</div>
        {scope === 'branch' && !branchId ? <EmptyState title="Pick a branch to see its notes" /> :
          q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data?.items.length ? <EmptyState title="No notes yet" /> : (
            <ul className="flex flex-col gap-2">
              {q.data.items.map((n) => (
                <li key={n.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <p className="whitespace-pre-line text-text">{n.note}</p>
                  <div className="mt-1 text-xs text-text-muted">{n.writtenBy ?? 'Someone'} · {formatDateTime(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
