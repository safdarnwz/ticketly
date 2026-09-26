import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileWarning, Pencil, Plus, ShieldCheck, Users, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, type Column, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { fleetApi, type ComplianceRow, type Crew, type CrewPatch, type CrewRules, type CrewStatus, type Duty } from '@/lib/api/fleet';
import { schedulingApi } from '@/lib/api/scheduling';
import { normalizeMobile } from '@/lib/checkout';
import { addDaysIso, cn, formatDateTime, minutesToHm, todayLocal } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const ROLES = [{ label: 'Driver', value: 'driver' }, { label: 'Conductor', value: 'conductor' }, { label: 'Attendant', value: 'attendant' }];
const STATUS_LABEL: Record<CrewStatus, string> = { active: 'Active', on_leave: 'On leave', inactive: 'Inactive' };
const STATUS_TONE: Record<CrewStatus, 'success' | 'warning' | 'neutral'> = { active: 'success', on_leave: 'warning', inactive: 'neutral' };
const ATTENDANCE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { present: 'success', late: 'warning', absent: 'danger', pending: 'neutral' };
const LICENCE_RE = /^[A-Z0-9]{6,20}$/;
const normLicence = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();

type Sub = 'crew' | 'roster' | 'rules' | 'compliance';

/** Crew & duties: the team, the duty roster with attendance, rest rules and the compliance report. */
export function CrewTab() {
  const [sub, setSub] = useState<Sub>('crew');
  const subs: { key: Sub; label: string }[] = [
    { key: 'crew', label: 'Crew' }, { key: 'roster', label: 'Duty roster' }, { key: 'rules', label: 'Rest rules' }, { key: 'compliance', label: 'Compliance' },
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {subs.map((s) => (
          <button key={s.key} role="tab" aria-selected={sub === s.key} onClick={() => setSub(s.key)}
            className={cn('rounded-full border px-3 py-1 text-sm', sub === s.key ? 'border-primary bg-primary/10 text-text' : 'border-border text-text-muted hover:text-text')}>{s.label}</button>
        ))}
      </div>
      {sub === 'crew' && <CrewList />}
      {sub === 'roster' && <Roster />}
      {sub === 'rules' && <RulesForm />}
      {sub === 'compliance' && <Compliance />}
    </>
  );
}

/* ── crew list ─────────────────────────────────────────────────────────── */

function CrewList() {
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Crew | 'new' | null>(null);
  const crew = useQuery({ queryKey: ['crew', role, status], queryFn: () => fleetApi.listCrew({ role, status }) });
  const today = todayLocal();
  const soon = addDaysIso(today, 30);
  const columns: Column<Crew>[] = [
    { key: 'name', header: 'Name', render: (r) => <div><div className="font-medium text-text">{r.fullName}</div><div className="text-xs text-text-muted">{[r.phone, r.employeeCode].filter(Boolean).join(' · ') || '—'}</div></div> },
    { key: 'role', header: 'Role', render: (r) => <Badge>{r.role}</Badge> },
    { key: 'licence', header: 'Licence', render: (r) => r.licenceNo ? (
      <div><div className="text-text-muted">{r.licenceNo}</div>
        {r.licenceExpiresOn && <div className={cn('text-xs', r.licenceExpiresOn < today ? 'text-danger' : r.licenceExpiresOn <= soon ? 'text-warning' : 'text-text-muted')}>
          {r.licenceExpiresOn < today ? 'expired' : 'valid till'} {r.licenceExpiresOn}</div>}</div>
    ) : <span className="text-text-muted">{r.role === 'driver' ? <span className="text-danger">missing</span> : '—'}</span> },
    { key: 'duties', header: 'Upcoming duties', render: (r) => r.upcomingDuties },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge> },
    { key: 'act', header: '', render: (r) => <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(r)}>Edit</Button> },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={[{ label: 'All roles', value: '' }, ...ROLES]} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ label: 'Any status', value: '' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add crew</Button>
      </div>
      {crew.isLoading ? <PageLoader /> : crew.isError ? <ErrorState error={crew.error} onRetry={crew.refetch} /> :
        crew.data?.items.length ? <Table columns={columns} rows={crew.data.items} />
          : <EmptyState title={role || status ? 'Nobody matches these filters' : 'No crew yet'} icon={<Users className="h-10 w-10" />} />}
      {editing && <CrewModal crew={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CrewModal({ crew, onClose }: { crew: Crew | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    role: crew?.role ?? 'driver', fullName: crew?.fullName ?? '', phone: crew?.phone ?? '', licenceNo: crew?.licenceNo ?? '',
    licenceExpiresOn: crew?.licenceExpiresOn ?? '', employeeCode: crew?.employeeCode ?? '', status: (crew?.status ?? 'active') as CrewStatus,
  });
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const today = todayLocal();
  const isDriver = f.role === 'driver';
  const errors: Record<string, string> = {};
  if (f.fullName.trim().length < 2) errors.fullName = 'Enter the full name';
  if (f.phone.trim() && !normalizeMobile(f.phone)) errors.phone = 'Enter a 10-digit mobile number';
  if (f.licenceNo.trim() && !LICENCE_RE.test(normLicence(f.licenceNo))) errors.licenceNo = '6 to 20 letters and digits';
  if (isDriver && !f.licenceNo.trim()) errors.licenceNo = 'A driver needs a licence number';
  if (isDriver && !f.licenceExpiresOn) errors.licenceExpiresOn = 'Enter when the licence expires';
  else if (!crew && f.licenceExpiresOn && f.licenceExpiresOn < today) errors.licenceExpiresOn = 'This licence has already expired';
  const holdsDuties = !!crew && crew.upcomingDuties > 0 && f.status !== 'active' && crew.status === 'active';
  if (holdsDuties) errors.status = `Still holds ${crew!.upcomingDuties} upcoming ${crew!.upcomingDuties === 1 ? 'duty' : 'duties'} — cancel them in the roster first`;

  const save = useMutation({
    mutationFn: async () => {
      const phone = f.phone.trim() ? normalizeMobile(f.phone) || f.phone.trim() : '';
      const licenceNo = f.licenceNo.trim() ? normLicence(f.licenceNo) : '';
      if (!crew) {
        return fleetApi.createCrew({ role: f.role, fullName: f.fullName.trim(), phone: phone || undefined, licenceNo: licenceNo || undefined, licenceExpiresOn: f.licenceExpiresOn || undefined, employeeCode: f.employeeCode.trim() || undefined });
      }
      const changes: CrewPatch = {};
      if (f.fullName.trim() !== crew.fullName) changes.fullName = f.fullName.trim();
      if (phone !== (crew.phone ?? '')) changes.phone = phone || null;
      if (licenceNo !== (crew.licenceNo ?? '')) changes.licenceNo = licenceNo || null;
      if (f.licenceExpiresOn !== (crew.licenceExpiresOn ?? '')) changes.licenceExpiresOn = f.licenceExpiresOn || null;
      if (f.employeeCode.trim() !== (crew.employeeCode ?? '')) changes.employeeCode = f.employeeCode.trim() || null;
      if (f.status !== crew.status) changes.status = f.status;
      if (Object.keys(changes).length === 0) return null;
      return fleetApi.updateCrew(crew.id, changes);
    },
    onSuccess: (r) => {
      toast.success(r === null ? 'Nothing changed' : crew ? 'Saved' : 'Crew member added');
      void qc.invalidateQueries({ queryKey: ['crew'] });
      onClose();
    },
    onError: (e) => { setServerErrors(e instanceof ApiError ? e.fieldErrors : {}); toast.error(errText(e, 'Could not save')); },
  });
  const err = (k: string) => (tried ? errors[k] : undefined) ?? serverErrors[k];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setServerErrors({}); };

  return (
    <Modal open onClose={onClose} title={crew ? `Edit ${crew.fullName}` : 'Add crew member'}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) save.mutate(); }}>{crew ? 'Save' : 'Add'}</Button></>}>
      <div className="flex flex-col gap-3">
        {!crew && <Select label="Role" value={f.role} onChange={set('role')} options={ROLES} />}
        <Input label="Full name" value={f.fullName} maxLength={120} onChange={set('fullName')} error={err('fullName')} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Mobile" inputMode="tel" value={f.phone} onChange={set('phone')} error={err('phone')} hint="One mobile per person" />
          <Input label="Employee code" value={f.employeeCode} maxLength={40} onChange={set('employeeCode')} error={err('employeeCode')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label={`Licence no.${isDriver ? ' *' : ''}`} value={f.licenceNo} maxLength={24} onChange={(e) => { setF((x) => ({ ...x, licenceNo: e.target.value.toUpperCase() })); setServerErrors({}); }} error={err('licenceNo')} />
          <Input label={`Licence expires${isDriver ? ' *' : ''}`} type="date" value={f.licenceExpiresOn} onChange={set('licenceExpiresOn')} error={err('licenceExpiresOn')} />
        </div>
        {crew && (
          <Select label="Status" value={f.status} onChange={set('status')} error={err('status')}
            options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
        )}
        {crew && f.status !== 'active' && !holdsDuties && <p className="text-xs text-text-muted">{STATUS_LABEL[f.status]} crew cannot be given new duties.</p>}
      </div>
    </Modal>
  );
}

/* ── roster ────────────────────────────────────────────────────────────── */

function Roster() {
  const qc = useQueryClient();
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [allowanceFor, setAllowanceFor] = useState<Duty | null>(null);
  const duties = useQuery({ queryKey: ['duties'], queryFn: () => fleetApi.listDuties() });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['duties'] }); void qc.invalidateQueries({ queryKey: ['crew'] }); };
  const cancel = useMutation({
    mutationFn: (id: string) => fleetApi.cancelDuty(id),
    onSuccess: () => { toast.success('Duty cancelled'); refresh(); },
    onError: (e) => toast.error(errText(e, 'Could not cancel')),
  });
  const mark = useMutation({
    mutationFn: (v: { id: string; status: 'present' | 'absent' }) => fleetApi.markAttendance(v.id, v.status),
    onSuccess: (r) => { toast.success(r.attendance === 'late' ? 'Marked present — late' : r.attendance === 'absent' ? 'Marked absent — dispatch is told to find cover' : 'Marked present'); refresh(); },
    onError: (e) => toast.error(errText(e, 'Could not mark attendance')),
  });
  const now = Date.now();
  const busy = cancel.isPending || mark.isPending;
  const columns: Column<Duty>[] = [
    { key: 'crew', header: 'Crew', render: (r) => <div><div className="font-medium text-text">{r.crewName}</div><div className="text-xs text-text-muted">{r.crewRole}</div></div> },
    { key: 'trip', header: 'Trip', render: (r) => <span className="text-text-muted">{r.tripLabel ?? 'Not tied to a trip'}</span> },
    { key: 'when', header: 'When', render: (r) => <div className="text-sm">{formatDateTime(r.startsAt)}<div className="text-xs text-text-muted">to {formatDateTime(r.endsAt)}</div></div> },
    { key: 'driving', header: 'Driving', render: (r) => minutesToHm(r.drivingMinutes) },
    { key: 'att', header: 'Attendance', render: (r) => <div className="flex flex-col gap-1"><Badge tone={ATTENDANCE_TONE[r.attendance] ?? 'neutral'}>{r.attendance === 'pending' ? 'not marked' : r.attendance}</Badge>{r.overrideReason && <span className="text-xs text-warning" title={r.overrideReason}>rule exception</span>}</div> },
    { key: 'act', header: '', render: (r) => {
      const canMark = new Date(r.startsAt).getTime() - now <= 6 * 3_600_000;
      const pending = r.attendance === 'pending';
      return (
        <div className="flex flex-wrap justify-end gap-1">
          {pending && <Button size="sm" variant="outline" disabled={busy || !canMark} title={canMark ? undefined : 'Attendance opens 6 hours before the duty'} onClick={() => mark.mutate({ id: r.id, status: 'present' })}>Present</Button>}
          {pending && <Button size="sm" variant="outline" disabled={busy || !canMark} title={canMark ? undefined : 'Attendance opens 6 hours before the duty'} onClick={() => mark.mutate({ id: r.id, status: 'absent' })}>Absent</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAllowanceFor(r)}>Hours left</Button>
          {pending && <Button size="sm" variant="ghost" leftIcon={<XCircle className="h-3.5 w-3.5" />} loading={cancel.isPending && cancel.variables === r.id} disabled={busy}
            onClick={() => { if (window.confirm(`Cancel ${r.crewName}'s duty on ${formatDateTime(r.startsAt)}?`)) cancel.mutate(r.id); }}>Cancel</Button>}
        </div>
      );
    } },
  ];
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-text-muted">Every duty that has not ended yet. Attendance opens 6 hours before a duty; after 15 minutes a present mark counts as late.</p>
        <Button leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => setAssigning(true)}>Assign duty</Button>
      </div>
      {duties.isLoading ? <PageLoader /> : duties.isError ? <ErrorState error={duties.error} onRetry={duties.refetch} /> :
        duties.data?.duties.length ? <Table columns={columns} rows={duties.data.duties} /> : <EmptyState title="No upcoming duties" icon={<FileWarning className="h-10 w-10" />} />}
      {assigning && <AssignDutyModal onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); refresh(); }} />}
      {allowanceFor && <AllowanceModal crewId={allowanceFor.crewId} name={allowanceFor.crewName} onClose={() => setAllowanceFor(null)} />}
    </>
  );
}

const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function AssignDutyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const crew = useQuery({ queryKey: ['crew', '', 'active'], queryFn: () => fleetApi.listCrew({ status: 'active' }) });
  const [date, setDate] = useState(todayLocal());
  const trips = useQuery({ queryKey: ['trips', date], queryFn: () => schedulingApi.listTrips(date) });
  const [f, setF] = useState({ crewId: '', tripId: '', startsAt: '', endsAt: '', driving: '' });
  const [conflicts, setConflicts] = useState<{ kind: string; message: string }[] | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const selectedTrip = trips.data?.items.find((t) => t.id === f.tripId);
  // Picking a trip fills the times: report 30 minutes before departure, off at arrival.
  useEffect(() => {
    if (!selectedTrip) return;
    const dep = new Date(selectedTrip.departsAt).getTime();
    const arr = new Date(selectedTrip.arrivesAt).getTime();
    setF((x) => ({ ...x, startsAt: toLocalInput(dep - 30 * 60_000), endsAt: toLocalInput(arr), driving: x.driving || String(Math.round((arr - dep) / 60_000)) }));
  }, [selectedTrip]);
  const member = crew.data?.items.find((c) => c.id === f.crewId);
  const start = f.startsAt ? new Date(f.startsAt).getTime() : NaN;
  const end = f.endsAt ? new Date(f.endsAt).getTime() : NaN;
  const driving = Number(f.driving);
  const errors: Record<string, string> = {};
  if (!f.crewId) errors.crewId = 'Pick who does this duty';
  if (!f.startsAt) errors.startsAt = 'When does the duty start?';
  if (!f.endsAt) errors.endsAt = 'When does it end?';
  else if (end <= Date.now()) errors.endsAt = 'This time has already passed';
  else if (!Number.isNaN(start) && end <= start) errors.endsAt = 'Must be after the start';
  if (f.driving === '' || !Number.isInteger(driving) || driving < 0) errors.driving = 'Minutes of driving, 0 or more';
  else if (!Number.isNaN(start) && !Number.isNaN(end) && driving > (end - start) / 60_000) errors.driving = 'Cannot be longer than the duty';
  if (member?.role === 'driver' && member.licenceExpiresOn && f.endsAt && member.licenceExpiresOn < f.endsAt.slice(0, 10)) errors.crewId = `Licence expires ${member.licenceExpiresOn}, before this duty ends`;
  if (conflicts && reason.trim().length < 10) errors.reason = 'Explain why this exception is approved (at least 10 characters)';

  const save = useMutation({
    mutationFn: () => fleetApi.assignDuty({
      crewId: f.crewId, tripId: f.tripId || undefined, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
      drivingMinutes: driving, overrideReason: conflicts ? reason.trim() : undefined,
    }),
    onSuccess: () => { toast.success(conflicts ? 'Duty assigned as an approved exception' : 'Duty assigned'); onDone(); },
    onError: (e) => {
      const list = e instanceof ApiError ? ((e.details as { conflicts?: { kind: string; message: string }[] } | undefined)?.conflicts ?? null) : null;
      if (list && list.length && list.every((c) => c.kind !== 'overlap')) { setConflicts(list); setTried(false); return; }
      toast.error(errText(e, 'Could not assign'));
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setConflicts(null); setReason(''); };
  return (
    <Modal open onClose={onClose} size="lg" title="Assign a duty"
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Close</Button>
        <Button variant={conflicts ? 'danger' : 'primary'} loading={save.isPending} disabled={save.isPending || crew.isLoading} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) save.mutate(); }}>{conflicts ? 'Approve exception and assign' : 'Assign'}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        {crew.isError && <ErrorState error={crew.error} onRetry={crew.refetch} />}
        {crew.data && crew.data.items.length === 0 && <p className="text-warning">No active crew — add someone under Crew first.</p>}
        <Select label="Crew member" value={f.crewId} onChange={set('crewId')} error={tried ? errors.crewId : undefined}
          options={[{ label: crew.isLoading ? 'Loading…' : 'Choose…', value: '' }, ...(crew.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.fullName} · ${c.role}` }))]} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Trip date" type="date" value={date} min={todayLocal()} onChange={(e) => { setDate(e.target.value); setF((x) => ({ ...x, tripId: '' })); }} />
          <Select label="Trip (optional)" value={f.tripId} onChange={set('tripId')}
            options={[{ label: trips.isLoading ? 'Loading…' : trips.data?.items.length ? 'No trip — standby / depot duty' : 'No trips on this day', value: '' },
              ...(trips.data?.items ?? []).filter((t) => t.status !== 'cancelled' && new Date(t.arrivesAt).getTime() > Date.now()).map((t) => ({ value: t.id, label: `${t.routeName} · ${formatDateTime(t.departsAt)}` }))]} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input label="Starts" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} error={tried ? errors.startsAt : undefined} />
          <Input label="Ends" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} error={tried ? errors.endsAt : undefined} />
          <Input label="Driving (minutes)" type="number" min={0} value={f.driving} onChange={set('driving')} error={tried ? errors.driving : undefined} />
        </div>
        {conflicts && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/5 p-3">
            <div className="font-semibold text-text">This duty breaks the rest rules</div>
            <ul className="list-disc pl-5 text-text-muted">{conflicts.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
            <p className="text-xs text-text-muted">A manager can approve it as an exception (e.g. emergency cover). It is recorded in the compliance report with your name.</p>
            <label className="flex flex-col gap-1"><span className="font-medium text-text">Why is this approved?</span>
              <textarea className="min-h-16 rounded-md border border-border bg-surface p-2" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              {tried && errors.reason && <span role="alert" className="text-xs text-danger">{errors.reason}</span>}</label>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AllowanceModal({ crewId, name, onClose }: { crewId: string; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['allowance', crewId], queryFn: () => fleetApi.allowance(crewId) });
  return (
    <Modal open onClose={onClose} title={`${name} — driving left`} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data && (
        <div className="flex flex-col gap-2 text-sm">
          <div><span className="text-2xl font-semibold text-text">{minutesToHm(q.data.remainingDrivingMinutes)}</span> <span className="text-text-muted">of driving still allowed in the last 24 hours (limit {minutesToHm(q.data.rules.maxDailyDrivingMinutes)})</span></div>
          <div className="text-text-muted">{q.data.nextAvailableAt ? `Rested and free from ${formatDateTime(q.data.nextAvailableAt)}` : 'Rested now'}</div>
        </div>
      )}
    </Modal>
  );
}

/* ── rules ─────────────────────────────────────────────────────────────── */

function RulesForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['crew-rules'], queryFn: fleetApi.crewRules });
  const [f, setF] = useState<Record<keyof CrewRules, string> | null>(null);
  useEffect(() => {
    if (q.data) setF({
      minRestMinutes: String(q.data.minRestMinutes / 60), maxDailyDrivingMinutes: String(q.data.maxDailyDrivingMinutes / 60),
      maxDutyMinutes: String(q.data.maxDutyMinutes / 60), maxContinuousDrivingMinutes: q.data.maxContinuousDrivingMinutes ? String(q.data.maxContinuousDrivingMinutes / 60) : '',
    });
  }, [q.data]);
  const save = useMutation({
    mutationFn: (r: CrewRules) => fleetApi.setCrewRules(r),
    onSuccess: () => { toast.success('Rest rules saved — they apply to new duties'); void qc.invalidateQueries({ queryKey: ['crew-rules'] }); },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  if (q.isLoading || !f) return q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : <PageLoader />;
  const hours = (k: keyof CrewRules) => Math.round(Number(f[k]) * 60);
  const errors: Record<string, string> = {};
  const inRange = (k: keyof CrewRules) => f[k] !== '' && Number.isFinite(Number(f[k])) && hours(k) >= 60 && hours(k) <= 1440;
  for (const k of ['minRestMinutes', 'maxDailyDrivingMinutes', 'maxDutyMinutes'] as const) if (!inRange(k)) errors[k] = 'Between 1 and 24 hours';
  if (f.maxContinuousDrivingMinutes && !inRange('maxContinuousDrivingMinutes')) errors.maxContinuousDrivingMinutes = 'Between 1 and 24 hours, or empty';
  else if (f.maxContinuousDrivingMinutes && !errors.maxDutyMinutes && hours('maxContinuousDrivingMinutes') > hours('maxDutyMinutes')) errors.maxContinuousDrivingMinutes = 'Cannot be longer than a whole duty';
  if (!errors.maxDailyDrivingMinutes && !errors.maxDutyMinutes && hours('maxDailyDrivingMinutes') > 1440 - hours('minRestMinutes')) errors.maxDailyDrivingMinutes = 'Leaves no time for the minimum rest';
  const field = (k: keyof CrewRules, label: string, hint: string) => (
    <Input label={label} type="number" step="0.5" min={1} max={24} value={f[k]} hint={hint} error={errors[k]} onChange={(e) => setF((x) => x && ({ ...x, [k]: e.target.value }))} />
  );
  return (
    <Card className="max-w-2xl">
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-semibold text-text"><ShieldCheck className="h-4 w-4" /> Rest rules (hours)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('minRestMinutes', 'Minimum rest between duties', 'Recommended 8')}
          {field('maxDailyDrivingMinutes', 'Driving in any 24 hours', 'Recommended 9')}
          {field('maxDutyMinutes', 'Longest single duty', 'Recommended 16')}
          {field('maxContinuousDrivingMinutes', 'Continuous driving before a break', 'Motor Transport Workers Act: 5')}
        </div>
        <p className="text-xs text-text-muted">Duties already assigned stay. New duties that break these need a manager's written reason.</p>
        <div className="flex justify-end"><Button loading={save.isPending} disabled={save.isPending || Object.keys(errors).length > 0}
          onClick={() => save.mutate({ minRestMinutes: hours('minRestMinutes'), maxDailyDrivingMinutes: hours('maxDailyDrivingMinutes'), maxDutyMinutes: hours('maxDutyMinutes'), ...(f.maxContinuousDrivingMinutes ? { maxContinuousDrivingMinutes: hours('maxContinuousDrivingMinutes') } : {}) })}>Save rules</Button></div>
      </CardBody>
    </Card>
  );
}

/* ── compliance ────────────────────────────────────────────────────────── */

function Compliance() {
  const [from, setFrom] = useState(addDaysIso(todayLocal(), -7));
  const [to, setTo] = useState(todayLocal());
  const bad = !from || !to || from > to;
  const q = useQuery({ queryKey: ['crew-compliance', from, to], queryFn: () => fleetApi.crewCompliance(from, to), enabled: !bad });
  const columns: Column<ComplianceRow>[] = [
    { key: 'crew', header: 'Crew', render: (r) => <div><div className="font-medium text-text">{r.crewName}</div><div className="text-xs text-text-muted">{r.role}</div></div> },
    { key: 'when', header: 'Duty', render: (r) => formatDateTime(r.startsAt) },
    { key: 'what', header: 'Issue', render: (r) => (
      <div className="flex flex-col gap-1 text-sm">
        {r.overrideReason && <span><Badge tone="warning">rule exception</Badge> {r.overrideReason}{r.approvedBy ? <span className="text-xs text-text-muted"> — approved by {r.approvedBy}</span> : null}</span>}
        {r.attendance !== 'present' && <span><Badge tone={ATTENDANCE_TONE[r.attendance] ?? 'neutral'}>{r.attendance === 'pending' ? 'attendance not marked' : r.attendance}</Badge></span>}
      </div>
    ) },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} error={bad ? 'Pick a range that ends after it starts' : undefined} />
      </div>
      {bad ? null : q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> :
        q.data?.items.length ? <Table columns={columns} rows={q.data.items} /> : <EmptyState title="Nothing to report" description="No rule exceptions, late or missed attendance in this period." icon={<ShieldCheck className="h-10 w-10" />} />}
    </>
  );
}
