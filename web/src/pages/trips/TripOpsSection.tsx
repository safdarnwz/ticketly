import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, PageLoader, Select, Table, useToast, type Column } from '@/components/ui';
import { agentsApi } from '@/lib/api/agents';
import { branchesApi } from '@/lib/api/branches';
import type { TripChart } from '@/lib/api/scheduling';
import { fareRulesApi } from '@/lib/api/pricingAdmin';
import { CHANNELS, EXPENSE_CATEGORIES, tripOpsExtraApi, type Channel, type Expense, type ExpenseCategory, type Quota } from '@/lib/api/tripOps';
import { cn, formatDateTime, formatMoney, idempotencyKey } from '@/lib/utils';

type Tab = 'channels' | 'fare' | 'quotas' | 'waitlist' | 'money' | 'forecast';
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Failed');
const label = (c: string) => c.replace(/_/g, ' ');

/** The rest of running one bus: who may sell it, seats kept for agents/branches, the waitlist, its money. */
export function TripOpsSection({ chart, locked, onChanged }: { chart: TripChart; locked: boolean; onChanged: () => void }) {
  const [tab, setTab] = useState<Tab>('channels');
  const tabs: [Tab, string][] = [['channels', 'Sales channels'], ['fare', 'Fare for this trip'], ['quotas', 'Agent & branch seats'], ['waitlist', 'Waitlist'], ['money', 'Expenses & P&L'], ['forecast', 'Forecast']];
  return (
    <Card className="mt-6 print:hidden">
      <CardBody>
        <div className="mb-3 flex flex-wrap gap-2 border-b border-border text-sm" role="tablist">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('border-b-2 px-3 py-1.5', tab === k ? 'border-primary text-text' : 'border-transparent text-text-muted')}>{l}</button>)}
        </div>
        {tab === 'channels' ? <Channels chart={chart} locked={locked} onChanged={onChanged} />
          : tab === 'fare' ? <TripFare tripId={chart.trip.id} locked={locked} />
          : tab === 'quotas' ? <Quotas chart={chart} locked={locked} onChanged={onChanged} />
            : tab === 'waitlist' ? <Waitlist tripId={chart.trip.id} />
              : tab === 'money' ? <Money tripId={chart.trip.id} cancelled={chart.trip.status === 'cancelled'} />
                : <Forecast tripId={chart.trip.id} />}
      </CardBody>
    </Card>
  );
}

function Channels({ chart, locked, onChanged }: { chart: TripChart; locked: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const own = (chart.trip.closedOnTrip ?? []) as Channel[];
  const bySvc = chart.trip.closedByService ?? [];
  const save = useMutation({
    mutationFn: (closed: Channel[]) => tripOpsExtraApi.setClosedChannels(chart.trip.id, closed),
    onSuccess: () => { toast.success('Sales channels updated'); void qc.invalidateQueries({ queryKey: ['partner-sync', chart.trip.id] }); onChanged(); },
    onError: (e) => toast.error(errText(e)),
  });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-text-muted">Stop one kind of seller on this bus while the others keep selling — e.g. keep the last seats for your counter.</p>
      {CHANNELS.map((c) => {
        const service = bySvc.includes(c.key);
        const closed = service || own.includes(c.key);
        return (
          <div key={c.key} aria-label={c.label} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <span>{c.label} {service && <Badge tone="neutral">closed for the whole service</Badge>}</span>
            <span className="flex items-center gap-2">
              <Badge tone={closed ? 'warning' : 'success'}>{closed ? 'Not selling' : 'Selling'}</Badge>
              {!service && !locked && <Button size="sm" variant="outline" loading={save.isPending && save.variables?.includes(c.key) !== own.includes(c.key)} disabled={save.isPending}
                onClick={() => save.mutate(closed ? own.filter((x) => x !== c.key) : [...own, c.key])}>{closed ? `Start selling` : `Stop selling`}</Button>}
            </span>
          </div>
        );
      })}
      {locked && <p className="text-xs text-text-muted">This bus has left or was cancelled — sales cannot change.</p>}
      <PartnerSyncCard tripId={chart.trip.id} own={own} locked={locked} onChanged={onChanged} />
    </div>
  );
}

/** What the OTAs see for this bus right now, and one-click fixes for what stops them. */
function PartnerSyncCard({ tripId, own, locked, onChanged }: { tripId: string; own: Channel[]; locked: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['partner-sync', tripId], queryFn: () => tripOpsExtraApi.partnerSync(tripId) });
  const reopen = useMutation({
    mutationFn: () => tripOpsExtraApi.setClosedChannels(tripId, own.filter((c) => c !== 'ota')),
    onSuccess: () => { toast.success('Partners can sell this bus again'); void qc.invalidateQueries({ queryKey: ['partner-sync', tripId] }); onChanged(); },
    onError: (e) => toast.error(errText(e)),
  });
  // A channel change above moves this too.
  const recheck = () => void q.refetch();
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data!;
  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text">OTA partners — what they see now</span>
        <span className="flex items-center gap-2">
          <Badge tone={d.selling ? 'success' : d.departed ? 'neutral' : 'warning'}>{d.selling ? 'In sync · selling' : d.departed ? 'Departed' : 'Not reaching partners'}</Badge>
          <Button size="sm" variant="ghost" loading={q.isFetching} onClick={recheck}>Check again</Button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><div className="text-xs text-text-muted">Seats partners see</div><div className="font-semibold">{d.seats.freeForPartners} of {d.seats.total}</div></div>
        <div><div className="text-xs text-text-muted">Free for the full journey</div><div className="font-semibold">{d.seats.freeNow}</div></div>
        <div><div className="text-xs text-text-muted">Sold by partners</div><div className="font-semibold">{d.seats.partnerSold}</div></div>
        <div><div className="text-xs text-text-muted">Partner customers paying</div><div className="font-semibold">{d.seats.partnerHolding}</div></div>
      </div>
      <p className="mt-2 text-xs text-text-muted">Partners read the same live seat map as your website, so a seat sold anywhere disappears for them at once. {d.partners.some((p) => p.receiving) ? `${d.partners.filter((p) => p.receiving).map((p) => p.name).join(', ')} ${d.partners.filter((p) => p.receiving).length === 1 ? 'receives' : 'receive'} your seats` : 'No partner receives your seats yet'}{d.partners.some((p) => p.paused) ? `; paused: ${d.partners.filter((p) => p.paused).map((p) => p.name).join(', ')}` : ''}.</p>
      {d.issues.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {d.issues.map((i) => (
            <li key={i.code} className="flex flex-wrap items-center justify-between gap-2 rounded bg-warning/10 px-2 py-1 text-xs text-text">
              <span>{i.message}</span>
              {i.code === 'closed_on_trip' && !locked && <Button size="sm" variant="outline" loading={reopen.isPending} disabled={reopen.isPending} onClick={() => reopen.mutate()}>Reopen for partners</Button>}
              {(i.code === 'no_partner') && <Link className="text-primary" to="/distribution">Distribution → Partners</Link>}
              {i.code === 'closed_on_service' && <Link className="text-primary" to="/schedule">Open the service</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Quotas({ chart, locked, onChanged }: { chart: TripChart; locked: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tripId = chart.trip.id;
  const q = useQuery({ queryKey: ['trip-quotas', tripId], queryFn: () => tripOpsExtraApi.quotas(tripId, true) });
  const agents = useQuery({ queryKey: ['agents', 'active'], queryFn: () => agentsApi.list({ status: 'active' }) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list });
  const [holderType, setHolderType] = useState<'agent' | 'branch'>('agent');
  const [holderId, setHolderId] = useState('');
  const [mode, setMode] = useState<'seats' | 'pct'>('seats');
  const [seats, setSeats] = useState('');
  const [pct, setPct] = useState('');
  const [hours, setHours] = useState('2');
  const [key, setKey] = useState(() => idempotencyKey('quota'));
  const free = chart.seats.filter((s) => s.bookable && !s.blocked && s.occupants.length === 0).map((s) => s.seatNumber);
  const picked = seats.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const unknown = picked.filter((p) => !chart.seats.some((s) => s.seatNumber === p));
  const taken = picked.filter((p) => !unknown.includes(p) && !free.includes(p));
  const e: Record<string, string> = {};
  if (!holderId) e.holder = `Choose the ${holderType}`;
  if (mode === 'seats') {
    if (!picked.length) e.seats = 'Seat numbers, comma-separated';
    else if (unknown.length) e.seats = `Not on this bus: ${unknown.join(', ')}`;
    else if (taken.length) e.seats = `Already sold, blocked or kept: ${taken.join(', ')}`;
  } else if (!(Number(pct) >= 1 && Number(pct) <= 100)) e.pct = '1 to 100 %';
  const minutes = Math.round(Number(hours) * 60);
  if (!(minutes >= 30 && minutes <= 7 * 24 * 60)) e.hours = '0.5 to 168 hours';
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['trip-quotas', tripId] }); onChanged(); };
  const allocate = useMutation({
    mutationFn: () => mode === 'seats'
      ? tripOpsExtraApi.allocate(tripId, { seatNumbers: picked, holderType, holderId, releaseMinutesBefore: minutes }, key)
      : tripOpsExtraApi.allocatePercent(tripId, { percent: Number(pct), holderType, holderId, releaseMinutesBefore: minutes }, key),
    onSuccess: (r) => { toast.success(`${r.allocated} seat(s) kept — unsold ones return to sale ${formatDateTime(r.releaseAt)}`); setSeats(''); setPct(''); setKey(idempotencyKey('quota')); refresh(); },
    onError: (x) => toast.error(errText(x)),
  });
  const release = useMutation({
    mutationFn: (seat: string) => tripOpsExtraApi.release(tripId, [seat], 'Taken back by the operator', idempotencyKey('release')),
    onSuccess: () => { toast.success('Seat back in general sale'); refresh(); },
    onError: (x) => toast.error(errText(x)),
  });
  const holders = holderType === 'agent' ? (agents.data?.items ?? []).map((a) => ({ label: `${a.name} (${a.code})`, value: a.id })) : (branches.data?.items ?? []).filter((b) => b.status === 'active').map((b) => ({ label: b.name, value: b.id }));
  const cols: Column<Quota>[] = [
    { key: 'seat', header: 'Seat', look: 'key', render: (x) => <span className="font-mono">{x.seatNumber}</span> },
    { key: 'for', header: 'Kept for', under: 'seat', render: (x) => <span>{x.holderName ?? x.holderId.slice(0, 8)} <span className="text-xs text-text-muted">{x.holderType}</span></span> },
    { key: 'state', header: 'State', render: (x) => x.consumedAt ? <Badge tone="success">Sold</Badge> : x.releasedAt ? <Badge tone="neutral">Released</Badge> : <span className="text-xs">until {formatDateTime(x.releaseAt)}</span> },
    { key: 'act', header: '', render: (x) => !x.consumedAt && !x.releasedAt && !locked ? <Button size="sm" variant="ghost" disabled={release.isPending} onClick={() => release.mutate(x.seatNumber)}>Take back</Button> : null },
  ];
  return (
    <div className="flex flex-col gap-3 text-sm">
      {!locked && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 md:grid-cols-4">
          <Select label="For" value={holderType} onChange={(x) => { setHolderType(x.target.value as 'agent' | 'branch'); setHolderId(''); }} options={[{ label: 'Travel agent', value: 'agent' }, { label: 'Branch', value: 'branch' }]} />
          <Select label={holderType === 'agent' ? 'Agent' : 'Branch'} value={holderId} error={holderId ? undefined : undefined} onChange={(x) => setHolderId(x.target.value)} options={[{ label: holders.length ? 'Choose…' : `No active ${holderType}s`, value: '' }, ...holders]} />
          <Select label="How many" value={mode} onChange={(x) => setMode(x.target.value as 'seats' | 'pct')} options={[{ label: 'These seats', value: 'seats' }, { label: '% of the bus', value: 'pct' }]} />
          {mode === 'seats' ? <Input label="Seats" placeholder="e.g. 11, 12" value={seats} error={seats ? e.seats : undefined} onChange={(x) => setSeats(x.target.value)} />
            : <Input label="Percent" type="number" value={pct} error={pct ? e.pct : undefined} onChange={(x) => setPct(x.target.value)} />}
          <Input label="Return unsold seats (hours before departure)" type="number" value={hours} error={e.hours} onChange={(x) => setHours(x.target.value)} />
          <div className="flex items-end"><Button loading={allocate.isPending} disabled={allocate.isPending || Object.keys(e).length > 0} onClick={() => allocate.mutate()}>Keep seats</Button></div>
          <p className="col-span-2 self-end text-xs text-text-muted">{free.length} seats free now</p>
        </div>
      )}
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (q.data?.items.length ?? 0) === 0 ? <p className="text-text-muted">No seats kept for agents or branches on this bus.</p> : <Table columns={cols} rows={q.data!.items} />}
    </div>
  );
}

function Waitlist({ tripId }: { tripId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['trip-waitlist', tripId], queryFn: () => tripOpsExtraApi.waitlist(tripId) });
  const remove = useMutation({
    mutationFn: (w: { id: string; contactPhone: string }) => tripOpsExtraApi.leaveWaitlist(tripId, w.id, w.contactPhone),
    onSuccess: () => { toast.success('Removed from the waitlist'); void qc.invalidateQueries({ queryKey: ['trip-waitlist', tripId] }); },
    onError: (x) => toast.error(errText(x)),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState title="Nobody is waiting" description="People join the waitlist when the bus is full; they are told when a seat frees up." />;
  return (
    <ul className="divide-y divide-border rounded-md border border-border text-sm">
      {items.map((w) => (
        <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-2">
          <span><span className="font-mono">{w.contactPhone}</span> · {w.seatCount} seat{w.seatCount === 1 ? '' : 's'} · {w.fromStop} → {w.toStop}</span>
          <span className="flex items-center gap-2 text-xs text-text-muted"><Badge tone={w.status === 'waiting' ? 'warning' : 'neutral'}>{w.status}</Badge>{w.notifiedAt ? `told ${formatDateTime(w.notifiedAt)}` : `since ${formatDateTime(w.createdAt)}`}
            {w.status === 'waiting' && <Button size="sm" variant="ghost" loading={remove.isPending && remove.variables?.id === w.id} disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Remove ${w.contactPhone} from the waitlist?`)) remove.mutate({ id: w.id, contactPhone: w.contactPhone }); }}>Remove</Button>}</span>
        </li>
      ))}
    </ul>
  );
}

const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function Money({ tripId, cancelled }: { tripId: string; cancelled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const exp = useQuery({ queryKey: ['trip-expenses', tripId], queryFn: () => tripOpsExtraApi.expenses(tripId) });
  const pnl = useQuery({ queryKey: ['trip-pnl', tripId], queryFn: () => tripOpsExtraApi.pnl(tripId) });
  const [cat, setCat] = useState<ExpenseCategory>('diesel');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [key, setKey] = useState(() => idempotencyKey('expense'));
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['trip-expenses', tripId] }); void qc.invalidateQueries({ queryKey: ['trip-pnl', tripId] }); };
  const amt = Number(amount);
  const amountErr = amount && !(amt > 0 && amt <= 500000 && /^\d+(\.\d{1,2})?$/.test(amount)) ? '₹0.01 to ₹5,00,000' : undefined;
  const receiptErr = !receipt ? undefined : !RECEIPT_TYPES.includes(receipt.type) ? 'PDF, JPG, PNG or WEBP only' : receipt.size > 5 * 1024 * 1024 ? 'The file is over 5 MB' : undefined;
  const add = useMutation({
    mutationFn: async () => {
      const receiptFileId = receipt ? (await tripOpsExtraApi.uploadReceipt(tripId, receipt)).fileId : undefined;
      return tripOpsExtraApi.addExpense(tripId, { category: cat, amountMinor: Math.round(amt * 100), note: note.trim() || undefined, receiptFileId }, key);
    },
    onSuccess: () => { toast.success('Expense added'); setAmount(''); setNote(''); setReceipt(null); setFileKey((k) => k + 1); setKey(idempotencyKey('expense')); refresh(); },
    onError: (x) => toast.error(errText(x)),
  });
  const voidM = useMutation({
    mutationFn: (v: { id: string; reason: string }) => tripOpsExtraApi.voidExpense(tripId, v.id, v.reason, idempotencyKey('void')),
    onSuccess: () => { toast.success('Expense voided — kept in the history'); setVoiding(null); refresh(); },
    onError: (x) => toast.error(errText(x)),
  });
  const cols: Column<Expense>[] = [
    { key: 'what', header: 'What', look: 'strong', render: (x) => <span className={cn(x.voidedAt && 'text-text-muted line-through')}>{label(x.category)}{x.note ? ` · ${x.note}` : ''}</span> },
    { key: 'receipt', header: 'Receipt', under: 'what', render: (x) => x.receiptFileId ? <Button size="sm" variant="ghost" onClick={() => void tripOpsExtraApi.openReceipt(x.receiptFileId!).catch((e) => toast.error(errText(e)))}>View</Button> : <span className="text-xs text-text-muted">—</span> },
    { key: 'amt', header: 'Amount', look: 'figure', render: (x) => <span className={cn(x.voidedAt && 'text-text-muted line-through')}>{formatMoney(x.amountMinor)}</span> },
    { key: 'who', header: 'Added', look: 'muted', under: 'what', render: (x) => <span className="text-xs text-text-muted">{formatDateTime(x.incurredAt)}{x.createdBy ? ` · ${x.createdBy}` : ''}{x.voidedAt ? ` · voided: ${x.voidReason}` : ''}</span> },
    { key: 'act', header: '', render: (x) => x.voidedAt ? null : voiding?.id === x.id ? (
      <span className="flex items-center gap-1"><input aria-label="Why void" className="h-8 rounded-md border border-border px-2 text-xs" placeholder="Why? (5+ letters)" value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} />
        <Button size="sm" variant="danger" disabled={voiding.reason.trim().length < 5 || voidM.isPending} onClick={() => voidM.mutate({ id: x.id, reason: voiding.reason.trim() })}>Void</Button></span>
    ) : <Button size="sm" variant="ghost" onClick={() => setVoiding({ id: x.id, reason: '' })}>Void</Button> },
  ];
  const p = pnl.data;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {p && (
        <div className="grid grid-cols-2 gap-2 rounded-md bg-surface-muted p-3 md:grid-cols-5">
          <div><div className="text-xs text-text-muted">Net fares</div><div className="font-semibold">{formatMoney(p.netRevenueMinor)}</div></div>
          <div><div className="text-xs text-text-muted">Expenses</div><div className="font-semibold">{formatMoney(p.expensesMinor)}</div></div>
          <div><div className="text-xs text-text-muted">Profit</div><div className={cn('font-semibold', p.profitMinor < 0 ? 'text-danger' : 'text-success')}>{formatMoney(p.profitMinor)}</div></div>
          <div><div className="text-xs text-text-muted">Occupancy</div><div className="font-semibold">{p.seatsSold}/{p.seatsTotal} · {p.occupancyPct}%</div></div>
          <div><div className="text-xs text-text-muted">Cost per seat</div><div className="font-semibold">{formatMoney(p.costPerSeatMinor)}</div></div>
        </div>
      )}
      {!cancelled && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40"><Select label="Expense" value={cat} onChange={(x) => setCat(x.target.value as ExpenseCategory)} options={EXPENSE_CATEGORIES.map((c) => ({ label: label(c), value: c }))} /></div>
          <div className="w-36"><Input label="Amount (₹)" type="number" value={amount} error={amountErr} onChange={(x) => setAmount(x.target.value)} /></div>
          <div className="w-64"><Input label="Note (optional)" value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} /></div>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-text">Receipt (optional)</span>
            <input key={fileKey} type="file" aria-label="Receipt file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" className="text-xs" onChange={(x) => setReceipt(x.target.files?.[0] ?? null)} />
            {receiptErr && <span role="alert" className="text-xs text-danger">{receiptErr}</span>}</label>
          <Button loading={add.isPending} disabled={!amount || !!amountErr || !!receiptErr || add.isPending} onClick={() => add.mutate()}>Add expense</Button>
        </div>
      )}
      {exp.isLoading ? <PageLoader /> : exp.isError ? <ErrorState error={exp.error} onRetry={exp.refetch} /> : (exp.data?.items.length ?? 0) === 0 ? <p className="text-text-muted">No expenses on this trip yet.</p> : <Table columns={cols} rows={exp.data!.items} />}
    </div>
  );
}

function Forecast({ tripId }: { tripId: string }) {
  const q = useQuery({ queryKey: ['trip-forecast', tripId], queryFn: () => tripOpsExtraApi.forecast(tripId) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const f = q.data;
  return (
    <div className="text-sm">
      <p>Sold {f.currentSold} of {f.totalSeats} with {f.daysToDeparture} day(s) to go.</p>
      {f.forecastSeats == null ? <p className="text-text-muted">Not enough past trips on this route yet to forecast ({f.samples} comparable).</p>
        : <p>Expected at departure: <b>{f.forecastSeats} seats ({f.forecastPct}%)</b> · confidence {f.confidence} ({f.samples} comparable trips)</p>}
    </div>
  );
}

/** Cheaper for an empty bus, dearer for a full one — this trip only, new quotes only. */
function TripFare({ tripId, locked }: { tripId: string; locked: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['trip-fare-adj', tripId], queryFn: () => fareRulesApi.tripAdjustment(tripId) });
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(pct);
  const e = pct !== '' && (!(n >= -50 && n <= 100) || n === 0) ? '−50 to +100 %, not 0' : undefined;
  const done = (msg: string) => ({ onSuccess: () => { toast.success(msg); setPct(''); setReason(''); void qc.invalidateQueries({ queryKey: ['trip-fare-adj', tripId] }); }, onError: (x: unknown) => toast.error(errText(x)) });
  const set = useMutation({ mutationFn: () => fareRulesApi.setTripAdjustment(tripId, n, reason.trim()), ...done('Fare changed for this trip — new bookings pay it') });
  const clear = useMutation({ mutationFn: () => fareRulesApi.setTripAdjustment(tripId, null), ...done('Back to the normal fare') });
  if (q.isLoading) return <PageLoader />;
  const cur = q.data;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>{cur?.pct != null ? <>Now <b>{cur.pct > 0 ? '+' : ''}{cur.pct}%</b> — {cur.reason}</> : 'Normal fare (route and yield rules apply).'}</p>
      {!locked && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40"><Input label="Change %" type="number" value={pct} error={e} placeholder="e.g. -15 or 20" onChange={(x) => setPct(x.target.value)} /></div>
          <div className="w-72"><Input label="Reason" value={reason} maxLength={200} error={reason && reason.trim().length < 5 ? 'At least 5 characters' : undefined} onChange={(x) => setReason(x.target.value)} /></div>
          <Button loading={set.isPending} disabled={!pct || !!e || reason.trim().length < 5 || set.isPending} onClick={() => set.mutate()}>Apply</Button>
          {cur?.pct != null && <Button variant="ghost" loading={clear.isPending} disabled={clear.isPending} onClick={() => clear.mutate()}>Remove change</Button>}
        </div>
      )}
      <p className="text-xs text-text-muted">Tickets already sold keep their price. Route limits (lowest / highest fare) still apply.</p>
    </div>
  );
}
