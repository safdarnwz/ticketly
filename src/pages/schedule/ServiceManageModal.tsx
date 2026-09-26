import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, ErrorState, Input, Modal, PageLoader, useToast } from '@/components/ui';
import { serviceAdminApi, type CategoryQuota, type Recurrence, type SalesRules, type ServiceRow } from '@/lib/api/scheduling';
import { addDaysIso, cn, dayDiff, formatDateTime, idempotencyKey, todayLocal } from '@/lib/utils';

export type ManageTab = 'timetable' | 'versions' | 'sales' | 'extra' | 'copy';
const WEEKDAYS = [{ v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 7, l: 'Sun' }];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Failed');

function Weekdays({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-1.5">
      {WEEKDAYS.map((d) => (
        <button key={d.v} type="button" aria-pressed={value.includes(d.v)} onClick={() => onChange(value.includes(d.v) ? value.filter((x) => x !== d.v) : [...value, d.v])}
          className={cn('h-8 w-11 rounded-md border text-xs font-medium', value.includes(d.v) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted')}>{d.l}</button>
      ))}
    </div>
  );
}

/** Everything about one service after it exists: timetable, history, sales rules, extra trips, copies. */
export function ServiceManageModal({ service, routeName, initialTab = 'timetable', initialDate, onClose }: {
  service: ServiceRow; routeName: string; initialTab?: ManageTab; initialDate?: string; onClose: () => void;
}) {
  const [tab, setTab] = useState<ManageTab>(initialTab);
  const ended = service.status === 'ended';
  const tabs: [ManageTab, string][] = [['timetable', 'Timetable'], ['versions', 'History'], ['sales', 'Sales rules'], ['extra', 'Extra trips'], ['copy', 'Copy / season']];
  return (
    <Modal open onClose={onClose} size="lg" title={`${service.code} · ${routeName}`}>
      <div className="mb-3 flex gap-2 border-b border-border text-sm" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('border-b-2 px-3 py-1.5', tab === k ? 'border-primary text-text' : 'border-transparent text-text-muted')}>{l}</button>)}
      </div>
      {tab === 'timetable' ? (ended ? <p className="text-sm text-text-muted">This service has ended. Copy it to run it again.</p> : <TimetableTab service={service} />)
        : tab === 'versions' ? <VersionsTab service={service} />
          : tab === 'sales' ? <SalesTab service={service} />
            : tab === 'extra' ? <ExtraTripsTab service={service} initialDate={initialDate} />
              : <CopyTab service={service} onDone={onClose} />}
    </Modal>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['services'] }); void qc.invalidateQueries({ queryKey: ['service-versions'] }); void qc.invalidateQueries({ queryKey: ['trips'] }); };
}

function TimetableTab({ service }: { service: ServiceRow }) {
  const toast = useToast();
  const refresh = useRefresh();
  const r = service.recurrence;
  const [start, setStart] = useState(hhmm(service.startMinute ?? 0));
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(r?.frequency ?? 'daily');
  const [days, setDays] = useState<number[]>(r?.weekdays ?? [1, 2, 3, 4, 5]);
  const [endDate, setEndDate] = useState(r?.endDate ?? addDaysIso(todayLocal(), 90));
  const [note, setNote] = useState('');
  const today = todayLocal();
  const e: Record<string, string> = {};
  if (!/^\d{2}:\d{2}$/.test(start)) e.start = 'Pick a time';
  if (frequency === 'weekly' && days.length === 0) e.days = 'Pick at least one day';
  if (!endDate || endDate < today) e.endDate = 'From today on';
  else if (r && endDate < r.startDate) e.endDate = 'After the start date';
  else if (r && dayDiff(r.startDate, endDate) > 366) e.endDate = 'At most a year after the start';
  const unchanged = start === hhmm(service.startMinute ?? 0) && frequency === r?.frequency && endDate === r?.endDate && (frequency === 'daily' || [...days].sort().join() === [...(r?.weekdays ?? [])].sort().join());
  const save = useMutation({
    mutationFn: () => serviceAdminApi.update(service.id, {
      startTime: start,
      recurrence: { ...(r as Recurrence), frequency, weekdays: frequency === 'weekly' ? [...days].sort() : undefined, endDate },
      note: note.trim() || undefined,
    }),
    onSuccess: (v) => { toast.success(`Saved as version ${v.version} — new trips follow it; existing trips keep their time`); refresh(); },
    onError: (x) => toast.error(errMsg(x)),
  });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Departs at" type="time" value={start} error={e.start} onChange={(x) => setStart(x.target.value)} />
        <Input label="Runs until" type="date" value={endDate} min={today} error={e.endDate} onChange={(x) => setEndDate(x.target.value)} />
      </div>
      <div className="flex gap-2">
        {(['daily', 'weekly'] as const).map((f) => <button key={f} type="button" onClick={() => setFrequency(f)} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', frequency === f ? 'border-primary bg-surface-muted' : 'border-border')}>{f === 'daily' ? 'Every day' : 'Some weekdays'}</button>)}
      </div>
      {frequency === 'weekly' && <Weekdays value={days} onChange={setDays} />}
      {e.days && <p role="alert" className="text-xs text-danger">{e.days}</p>}
      <Input label="What changed (optional)" placeholder="e.g. winter timing" value={note} maxLength={200} onChange={(x) => setNote(x.target.value)} />
      <p className="text-xs text-text-muted">Trips already created keep their time — move one trip from its chart. Every save is kept in History.</p>
      <div className="flex justify-end"><Button loading={save.isPending} disabled={unchanged || save.isPending || Object.keys(e).length > 0} onClick={() => save.mutate()}>Save timetable</Button></div>
    </div>
  );
}

function VersionsTab({ service }: { service: ServiceRow }) {
  const toast = useToast();
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ['service-versions', service.id], queryFn: () => serviceAdminApi.versions(service.id) });
  const restore = useMutation({
    mutationFn: (n: number) => serviceAdminApi.restore(service.id, n),
    onSuccess: (v, n) => { toast.success(`Version ${n} restored as version ${v.version}`); refresh(); },
    onError: (x) => toast.error(errMsg(x)),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const items = q.data?.items ?? [];
  const today = todayLocal();
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
      {items.map((v, i) => {
        const s = v.snapshot; const r = s.recurrence;
        const past = r.endDate < today;
        return (
          <li key={v.versionNumber} className="flex items-center justify-between gap-2 px-3 py-2">
            <div>
              <div className="font-medium">v{v.versionNumber} {i === 0 && <Badge tone="success">Current</Badge>} <span className="font-normal text-text-muted">{v.note}</span></div>
              <div className="text-xs text-text-muted">{hhmm(s.startMinute)} · {r.frequency === 'daily' ? 'daily' : (r.weekdays ?? []).map((d) => WEEKDAYS[d - 1]?.l).join(', ')} · {r.startDate} → {r.endDate} · {formatDateTime(v.createdAt)}</div>
            </div>
            {i > 0 && <Button size="sm" variant="outline" disabled={past || restore.isPending || service.status === 'ended'} title={past ? 'This version ended in the past' : undefined}
              loading={restore.isPending && restore.variables === v.versionNumber} onClick={() => { if (window.confirm(`Go back to version ${v.versionNumber}?`)) restore.mutate(v.versionNumber); }}>Restore</Button>}
          </li>
        );
      })}
    </ul>
  );
}

type QuotaForm = { on: boolean; mode: 'seats' | 'pct'; value: string; releaseHours: string };
const toForm = (q?: CategoryQuota): QuotaForm => ({ on: !!q, mode: q?.pct !== undefined ? 'pct' : 'seats', value: String(q?.seats ?? q?.pct ?? ''), releaseHours: String(q?.releaseHours ?? 6) });

function SalesTab({ service }: { service: ServiceRow }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['sales-rules', service.id], queryFn: () => serviceAdminApi.salesRules(service.id) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <SalesForm service={service} rules={q.data} toast={toast} />;
}

function SalesForm({ service, rules, toast }: { service: ServiceRow; rules: SalesRules; toast: ReturnType<typeof useToast> }) {
  const qc = useQueryClient();
  const [ota, setOta] = useState(rules.otaReleasePct?.toString() ?? '');
  const [female, setFemale] = useState(toForm(rules.categoryQuotas?.female));
  const [senior, setSenior] = useState(toForm(rules.categoryQuotas?.senior));
  const e: Record<string, string> = {};
  if (ota !== '' && !(/^\d+$/.test(ota) && Number(ota) <= 100)) e.ota = '0 to 100, or empty for the platform default';
  const check = (k: string, f: QuotaForm) => {
    if (!f.on) return;
    const n = Number(f.value);
    if (f.value === '' || !(n >= 1 && (f.mode === 'pct' ? n <= 100 : n <= 100 && Number.isInteger(n)))) e[k] = f.mode === 'pct' ? '1 to 100 %' : '1 to 100 seats';
    if (!/^\d+$/.test(f.releaseHours) || Number(f.releaseHours) > 720) e[`${k}Hours`] = '0 to 720 hours';
  };
  check('female', female); check('senior', senior);
  const quota = (f: QuotaForm): CategoryQuota | undefined => (f.on ? { [f.mode]: Number(f.value), releaseHours: Number(f.releaseHours) } as CategoryQuota : undefined);
  const save = useMutation({
    mutationFn: () => serviceAdminApi.setSalesRules(service.id, { otaReleasePct: ota === '' ? null : Number(ota), categoryQuotas: { female: quota(female), senior: quota(senior) } }),
    onSuccess: () => { toast.success('Sales rules saved'); void qc.invalidateQueries({ queryKey: ['sales-rules', service.id] }); },
    onError: (x) => toast.error(errMsg(x)),
  });
  const Quota = ({ k, label, f, set }: { k: string; label: string; f: QuotaForm; set: (f: QuotaForm) => void }) => (
    <div className="rounded-md border border-border p-3">
      <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={f.on} onChange={(x) => set({ ...f, on: x.target.checked })} /> Keep seats for {label}</label>
      {f.on && (
        <div className="mt-2 grid grid-cols-3 items-end gap-2">
          <select aria-label={`${label} quota unit`} value={f.mode} onChange={(x) => set({ ...f, mode: x.target.value as 'seats' | 'pct' })} className="h-10 rounded-md border border-border bg-surface px-2">
            <option value="seats">Seats</option><option value="pct">% of bus</option>
          </select>
          <Input aria-label={`${label} quota`} type="number" value={f.value} error={e[k]} onChange={(x) => set({ ...f, value: x.target.value })} />
          <Input label="Open to all (hours before)" type="number" value={f.releaseHours} error={e[`${k}Hours`]} onChange={(x) => set({ ...f, releaseHours: x.target.value })} />
        </div>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Input label="Share OTAs may sell (%)" type="number" value={ota} error={e.ota} hint="Empty = platform default. Your website and counter always sell." onChange={(x) => setOta(x.target.value)} />
      {Quota({ k: 'female', label: 'women', f: female, set: setFemale })}
      {Quota({ k: 'senior', label: 'senior citizens', f: senior, set: setSenior })}
      <p className="text-xs text-text-muted">A ladies-special service can keep 100% for women. Kept seats open to everyone at the release time.</p>
      <div className="flex justify-end"><Button loading={save.isPending} disabled={save.isPending || Object.keys(e).length > 0} onClick={() => save.mutate()}>Save sales rules</Button></div>
    </div>
  );
}

function ExtraTripsTab({ service, initialDate }: { service: ServiceRow; initialDate?: string }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [key, setKey] = useState(() => idempotencyKey('extra'));
  const [dates, setDates] = useState<string[]>(initialDate ? [initialDate] : []);
  const [pick, setPick] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [ladies, setLadies] = useState(false);
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<{ created: number; skipped: { journeyDate: string; reason: string }[] } | null>(null);
  const today = todayLocal();
  const add = () => { if (pick && pick >= today && !dates.includes(pick) && dates.length < 31) setDates([...dates, pick].sort()); setPick(''); };
  const e: Record<string, string> = {};
  if (dates.length === 0) e.dates = 'Add at least one date';
  if (reason.trim().length < 3) e.reason = 'Say why (festival, event…)';
  if (pick && pick < today) e.pick = 'Not in the past';
  const go = useMutation({
    mutationFn: () => serviceAdminApi.extraTrips(service.id, { journeyDates: dates, departureTime: time || undefined, reason: reason.trim(), ladiesSpecial: ladies, openForSale: open }, key),
    onSuccess: (r) => { setResult({ created: r.created.length, skipped: r.skipped }); toast.success(`${r.created.length} extra trip(s) created`); setDates([]); setKey(idempotencyKey('extra')); refresh(); },
    onError: (x) => toast.error(errMsg(x)),
  });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-end gap-2">
        <Input label="Add a date" type="date" min={today} value={pick} error={e.pick} onChange={(x) => setPick(x.target.value)} />
        <Button variant="outline" disabled={!pick || pick < today || dates.length >= 31} onClick={add}>Add</Button>
      </div>
      <div className="flex flex-wrap gap-1">{dates.map((d) => <button key={d} onClick={() => setDates(dates.filter((x) => x !== d))} className="rounded-full border border-border px-2 py-0.5 text-xs" title="Remove">{d} ×</button>)}</div>
      {e.dates && <p className="text-xs text-text-muted">{e.dates}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Departs at (optional)" type="time" value={time} hint={`Empty = the usual ${hhmm(service.startMinute ?? 0)}`} onChange={(x) => setTime(x.target.value)} />
        <Input label="Reason" value={reason} maxLength={200} error={reason ? e.reason : undefined} onChange={(x) => setReason(x.target.value)} />
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={ladies} onChange={(x) => setLadies(x.target.checked)} /> Ladies special</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={open} onChange={(x) => setOpen(x.target.checked)} /> Open for sale straight away</label>
      {result && result.skipped.length > 0 && <div className="rounded-md bg-warning/10 p-2 text-xs">Not created: {result.skipped.map((s) => `${s.journeyDate} (${s.reason})`).join('; ')}</div>}
      <div className="flex justify-end"><Button loading={go.isPending} disabled={go.isPending || Object.keys(e).length > 0} onClick={() => go.mutate()}>Create {dates.length || ''} extra trip{dates.length === 1 ? '' : 's'}</Button></div>
    </div>
  );
}

function CopyTab({ service, onDone }: { service: ServiceRow; onDone: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [key] = useState(() => idempotencyKey('clone'));
  const today = todayLocal();
  const [f, setF] = useState({ code: `${service.code}-2`.slice(0, 40), startDate: addDaysIso(today, 1), endDate: addDaysIso(today, 60), startTime: '', season: false });
  const [days, setDays] = useState<number[] | null>(null);
  const e: Record<string, string> = {};
  if (!/^[A-Za-z0-9-]{2,40}$/.test(f.code.trim())) e.code = '2–40 letters, digits or dashes';
  else if (f.code.trim().toUpperCase() === service.code.toUpperCase()) e.code = 'Give the copy its own code';
  if (!f.startDate || f.startDate < today) e.startDate = 'From today on';
  if (!f.endDate || f.endDate < f.startDate) e.endDate = 'After the start';
  else if (dayDiff(f.startDate, f.endDate) > 366) e.endDate = 'At most a year';
  if (days && days.length === 0) e.days = 'Pick at least one day';
  const clone = useMutation({
    mutationFn: () => serviceAdminApi.clone(service.id, { code: f.code.trim().toUpperCase(), startDate: f.startDate, endDate: f.endDate, startTime: f.startTime || undefined, weekdays: days ?? undefined, season: f.season }, key),
    onSuccess: () => { toast.success(f.season ? 'Season created — the original skips those dates. Activate the copy to sell it.' : 'Copy created as a draft — activate it to sell'); refresh(); onDone(); },
    onError: (x) => toast.error(errMsg(x)),
  });
  const remove = useMutation({
    mutationFn: () => serviceAdminApi.remove(service.id),
    onSuccess: (r) => { toast.success(`Service deleted with ${r.tripsDeleted} unsold trip(s)`); refresh(); onDone(); },
    onError: (x) => toast.error(errMsg(x)),
  });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Code of the copy" value={f.code} error={e.code} onChange={(x) => setF({ ...f, code: x.target.value.toUpperCase() })} />
        <Input label="Departs at (optional)" type="time" value={f.startTime} onChange={(x) => setF({ ...f, startTime: x.target.value })} />
        <Input label="From" type="date" min={today} value={f.startDate} error={e.startDate} onChange={(x) => setF({ ...f, startDate: x.target.value })} />
        <Input label="To" type="date" min={f.startDate} value={f.endDate} error={e.endDate} onChange={(x) => setF({ ...f, endDate: x.target.value })} />
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={days !== null} onChange={(x) => setDays(x.target.checked ? [1, 2, 3, 4, 5] : null)} /> Only on some weekdays</label>
      {days && <Weekdays value={days} onChange={setDays} />}
      {e.days && <p role="alert" className="text-xs text-danger">{e.days}</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.season} onChange={(x) => setF({ ...f, season: x.target.checked })} /> Seasonal: the original does not run on these dates</label>
      <div className="flex justify-between">
        <Button variant="ghost" className="text-danger" loading={remove.isPending} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${service.code} for good? Only possible if it never sold or ran.`)) remove.mutate(); }}>Delete service</Button>
        <Button loading={clone.isPending} disabled={clone.isPending || Object.keys(e).length > 0} onClick={() => clone.mutate()}>Create copy</Button>
      </div>
    </div>
  );
}
