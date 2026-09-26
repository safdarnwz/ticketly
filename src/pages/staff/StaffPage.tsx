import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, LogOut, Plus, ShieldCheck, Search, Trophy, UserCog, UserPlus, X } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { branchesApi } from '@/lib/api/branches';
import { RolesTab } from './RolesTab';
import { staffApi, type Staff, type StaffPerformance } from '@/lib/api/staff';
import { useAuth } from '@/stores/auth';
import { addDaysIso, cn, formatDateTime, formatMoney, todayLocal } from '@/lib/utils';

type Tab = 'directory' | 'roles' | 'performance';

/**
 * The operator's staff: who they are, their roles and branch, what they did,
 * and how their counter sales went. Guard rails come from the API — nobody
 * disables themselves or removes the last person who can manage staff.
 */
export function StaffPage() {
  const [tab, setTab] = useState<Tab>('directory');
  return (
    <>
      <PageHeader title="Staff" subtitle="Your team — roles, branches, access and counter sales" />
      <div className="mb-4 flex gap-2 border-b border-border">
        {([['directory', 'Directory', UserCog], ['roles', 'Roles & permissions', ShieldCheck], ['performance', 'Performance', Trophy]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'directory' ? <Directory /> : tab === 'roles' ? <RolesTab /> : <Performance />}
    </>
  );
}

function Directory() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [branchId, setBranchId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const roles = useQuery({ queryKey: ['roles'], queryFn: staffApi.roles });
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list });
  const list = useQuery({
    queryKey: ['staff', q.trim(), status, branchId, roleId, page],
    queryFn: () => staffApi.list({ q: q.trim() || undefined, status: status || undefined, branchId: branchId || undefined, roleId: roleId || undefined, page }),
    placeholderData: keepPreviousData,
  });
  const exp = useMutation({ mutationFn: staffApi.exportCsv, onError: (e) => toast.error(e instanceof Error ? e.message : 'Download failed') });
  const rows = list.data?.items ?? [];
  const reset = () => setPage(1);

  const columns: Column<Staff>[] = [
    { key: 'name', header: 'Name', render: (s) => <div><div className="font-medium text-text">{s.fullName}</div><div className="text-xs text-text-muted">{s.email}</div></div> },
    { key: 'phone', header: 'Mobile', render: (s) => <span className="font-mono text-sm">{s.phone ?? '—'}</span> },
    { key: 'roles', header: 'Roles', render: (s) => <div className="flex flex-wrap gap-1">{s.roles.map((r) => <Badge key={r.id}>{r.name}{r.expiresAt ? ' ⏳' : ''}</Badge>)}</div> },
    { key: 'branch', header: 'Branch', render: (s) => <span className={cn('text-sm', !s.branchName && 'text-text-muted')}>{s.branchName ?? 'None'}</span> },
    { key: 'login', header: 'Last sign-in', render: (s) => <span className="text-xs text-text-muted">{s.lastLoginAt ? formatDateTime(s.lastLoginAt) : 'Never'}</span> },
    { key: 'status', header: 'Status', render: (s) => <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status === 'active' ? 'Active' : 'Disabled'}</Badge> },
  ];

  return (
    <>
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Input aria-label="Search staff" placeholder="Name, or exact email / mobile" leftIcon={<Search className="h-4 w-4" />} value={q} onChange={(e) => { setQ(e.target.value); reset(); }} /></div>
          <div className="w-36"><Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} options={[{ label: 'Active', value: 'active' }, { label: 'Disabled', value: 'disabled' }, { label: 'All', value: '' }]} /></div>
          <div className="w-44"><Select label="Branch" value={branchId} onChange={(e) => { setBranchId(e.target.value); reset(); }} options={[{ label: 'Any branch', value: '' }, ...(branches.data?.items ?? []).map((b) => ({ label: b.name, value: b.id }))]} /></div>
          <div className="w-44"><Select label="Role" value={roleId} onChange={(e) => { setRoleId(e.target.value); reset(); }} options={[{ label: 'Any role', value: '' }, ...(roles.data?.items ?? []).map((r) => ({ label: r.name, value: r.id }))]} /></div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" leftIcon={<Download className="h-4 w-4" />} loading={exp.isPending} onClick={() => exp.mutate()}>Export CSV</Button>
            <Button leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setInviting(true)}>Add staff</Button>
          </div>
        </CardBody>
      </Card>

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? (
        <EmptyState title="No staff here" description={q ? 'Nobody matches — email and mobile must be exact.' : 'Add your team to give them access.'} icon={<UserCog className="h-10 w-10" />} />
      ) : (
        <>
          <Table columns={columns} rows={rows} onRowClick={(s) => setOpen(s.id)} />
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-text-muted">Page {page}</span>
            <Button variant="outline" size="sm" disabled={!list.data?.hasMore} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </>
      )}

      {open && <StaffModal id={open} onClose={() => setOpen(null)} />}
      {inviting && <InviteModal onClose={() => setInviting(false)} onDone={(id) => { setInviting(false); setOpen(id); }} />}
    </>
  );
}

function StaffModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user?.id);
  const [addRole, setAddRole] = useState('');
  const [until, setUntil] = useState('');
  const s = useQuery({ queryKey: ['staff-member', id], queryFn: () => staffApi.get(id) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: staffApi.roles });
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['staff-member', id] }); void qc.invalidateQueries({ queryKey: ['staff'] }); void qc.invalidateQueries({ queryKey: ['roles'] }); };
  const act = <T,>(fn: (v: T) => Promise<unknown>, ok: string) => ({
    mutationFn: fn,
    onSuccess: () => { toast.success(ok); refresh(); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const branch = useMutation(act((b: string) => staffApi.setBranch(id, b || null), 'Branch updated'));
  const grant = useMutation(act((v: { roleId: string; until: string }) => staffApi.grantRole(id, v.roleId, v.until ? new Date(v.until).toISOString() : null), 'Role given — it applies on their next click'));
  const revoke = useMutation(act((roleId: string) => staffApi.removeRole(id, roleId), 'Role removed — they sign in again'));
  const status = useMutation(act((v: 'active' | 'disabled') => staffApi.update(id, { status: v }), 'Status updated'));
  const logout = useMutation(act(() => staffApi.forceLogout(id), 'Signed out everywhere'));
  const busy = branch.isPending || grant.isPending || revoke.isPending || status.isPending || logout.isPending;
  const d = s.data;
  const self = d?.id === me;
  const addable = (roles.data?.items ?? []).filter((r) => !d?.roles.some((x) => x.id === r.id));
  const untilPast = !!until && new Date(until).getTime() <= Date.now();

  return (
    <Modal open onClose={onClose} size="lg" title={d?.fullName ?? 'Staff member'}>
      {s.isLoading ? <PageLoader /> : s.isError ? <ErrorState error={s.error} onRetry={s.refetch} /> : d && (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-text-muted">
            <span>{d.email}</span>{d.phone && <span className="font-mono">· {d.phone}</span>}
            <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status === 'active' ? 'Active' : 'Disabled'}</Badge>
            {self && <Badge tone="info">You</Badge>}
            <span className="ml-auto text-xs">Last sign-in {d.lastLoginAt ? formatDateTime(d.lastLoginAt) : 'never'}</span>
          </div>

          <div>
            <div className="mb-1.5 font-semibold text-text">Roles</div>
            <div className="flex flex-wrap items-center gap-2">
              {d.roles.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
                  {r.name}{r.expiresAt && <span className="text-xs text-text-muted">until {formatDateTime(r.expiresAt)}</span>}
                  <button type="button" aria-label={`Remove ${r.name}`} disabled={busy} onClick={() => revoke.mutate(r.id)} className="text-text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                </span>
              ))}
              {addable.length > 0 && (
                <div className="flex flex-wrap items-end gap-1">
                  <select aria-label="Add a role" value={addRole} onChange={(e) => setAddRole(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm">
                    <option value="">Add a role…</option>
                    {addable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <input type="datetime-local" aria-label="Until (optional)" title="Leave empty for a permanent role" value={until} min={nowLocalInput()} onChange={(e) => setUntil(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm" />
                  <Button size="sm" variant="outline" leftIcon={<Plus className="h-3.5 w-3.5" />} disabled={!addRole || busy || untilPast} onClick={() => { grant.mutate({ roleId: addRole, until }); setAddRole(''); setUntil(''); }}>{until ? 'Add until then' : 'Add'}</Button>
                  {untilPast && <span role="alert" className="text-xs text-danger">The end must be in the future</span>}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Branch" value={d.branchId ?? ''} disabled={busy} onChange={(e) => branch.mutate(e.target.value)}
              options={[{ label: 'No branch', value: '' }, ...(branches.data?.items ?? []).filter((b) => b.status === 'active' || b.id === d.branchId).map((b) => ({ label: b.name, value: b.id }))]} />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text">Access</span>
              <div className="flex flex-wrap gap-2">
                {d.status === 'active'
                  ? <Button size="sm" variant="ghost" className="text-danger" disabled={busy || self} title={self ? 'You cannot disable yourself' : undefined} onClick={() => status.mutate('disabled')}>Disable account</Button>
                  : <Button size="sm" variant="outline" disabled={busy} onClick={() => status.mutate('active')}>Enable account</Button>}
                <Button size="sm" variant="ghost" leftIcon={<LogOut className="h-3.5 w-3.5" />} disabled={busy || d.status !== 'active'} onClick={() => logout.mutate(undefined)}>Sign out everywhere</Button>
              </div>
            </div>
          </div>

          <AccessSection staff={d} self={self} onSaved={refresh} />
          {!self && d.status === 'active' && <PasswordSection id={d.id} />}

          <div>
            <div className="mb-1.5 font-semibold text-text">Recent activity</div>
            {d.activity.length === 0 ? <p className="text-text-muted">Nothing recorded yet.</p> : (
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {d.activity.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                    <span><span className="font-mono text-xs">{a.action}</span> <span className="text-text-muted">{a.resourceType}</span></span>
                    <span className="shrink-0 text-xs text-text-muted">{formatDateTime(a.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHm = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
/** `datetime-local` value for now / for an ISO instant, in the browser's time. */
function nowLocalInput(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Contractor end date, allowed hours and reporting manager. Nobody limits their own access. */
function AccessSection({ staff, self, onSaved }: { staff: Staff; self: boolean; onSaved: () => void }) {
  const toast = useToast();
  const w = staff.loginWindow;
  const [until, setUntil] = useState(staff.accessExpiresAt ? nowLocalInput(staff.accessExpiresAt) : '');
  const [limited, setLimited] = useState(!!w);
  const [days, setDays] = useState<number[]>(w?.days ?? [1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(toHm(w?.startMinute ?? 480));
  const [end, setEnd] = useState(toHm(w?.endMinute ?? 1200));
  const [managerId, setManagerId] = useState(staff.managerId ?? '');
  const people = useQuery({ queryKey: ['staff', 'managers'], queryFn: () => staffApi.list({ status: 'active', page: 1 }) });
  const errors: Record<string, string> = {};
  if (until && new Date(until).getTime() <= Date.now()) errors.until = 'Pick a moment in the future — or disable the account';
  if (limited && days.length === 0) errors.days = 'Pick at least one day';
  if (limited && start === end) errors.time = 'Start and end cannot be the same';
  const save = useMutation({
    mutationFn: () => staffApi.setAccess(staff.id, {
      accessExpiresAt: until ? new Date(until).toISOString() : null,
      loginWindow: limited ? { days: [...days].sort(), startMinute: fromHm(start), endMinute: fromHm(end) } : null,
      managerId: managerId || null,
    }),
    onSuccess: () => { toast.success('Access saved — applies on their next click'); onSaved(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const bad = Object.keys(errors).length > 0;
  const overnight = limited && fromHm(end) < fromHm(start);

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3" disabled={save.isPending}>
      <legend className="px-1 font-semibold text-text">Access &amp; hours</legend>
      {self && <p className="text-xs text-text-muted">You cannot limit your own access — ask another admin. You can still pick who you report to.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Access ends" type="datetime-local" value={until} disabled={self} min={nowLocalInput()} error={errors.until} hint="For contractors — empty means no end" onChange={(e) => setUntil(e.target.value)} />
        <Select label="Reports to" value={managerId} onChange={(e) => setManagerId(e.target.value)}
          options={[{ label: 'Nobody', value: '' }, ...(people.data?.items ?? []).filter((p) => p.id !== staff.id).map((p) => ({ label: p.fullName, value: p.id }))]} />
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={limited} disabled={self} onChange={(e) => setLimited(e.target.checked)} /> Only allow sign-in during set hours</label>
      {limited && (
        <div className="flex flex-col gap-2 pl-6">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {DAYS.map((label, i) => {
              const day = i + 1; const on = days.includes(day);
              return <button type="button" key={day} aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== day) : [...days, day])}
                className={cn('rounded-md border px-2 py-1 text-xs', on ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text')}>{label}</button>;
            })}
          </div>
          {errors.days && <span role="alert" className="text-xs text-danger">{errors.days}</span>}
          <div className="flex items-end gap-2">
            <Input label="From" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input label="To" type="time" value={end} error={errors.time} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {overnight && <span className="text-xs text-text-muted">Overnight shift — ends the next morning.</span>}
        </div>
      )}
      <div className="flex justify-end"><Button size="sm" loading={save.isPending} disabled={bad || save.isPending} onClick={() => save.mutate()}>Save access</Button></div>
    </fieldset>
  );
}

/** Set a new password for someone who is locked out; they are signed out everywhere. */
function PasswordSection({ id }: { id: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (pw.length < 8) errors.pw = 'At least 8 characters';
  if (again !== pw) errors.again = 'The two passwords differ';
  const reset = useMutation({
    mutationFn: () => staffApi.resetPassword(id, pw),
    onSuccess: () => { toast.success('New password set — they were signed out everywhere'); setOpen(false); setPw(''); setAgain(''); setTried(false); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  if (!open) return <div><Button size="sm" variant="ghost" leftIcon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Set a new password</Button></div>;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="New password" type="password" autoComplete="new-password" value={pw} error={tried ? errors.pw : undefined} onChange={(e) => setPw(e.target.value)} />
        <Input label="Type it again" type="password" autoComplete="new-password" value={again} error={tried ? errors.again : undefined} onChange={(e) => setAgain(e.target.value)} />
      </div>
      <p className="text-xs text-text-muted">Share it with them privately. It also lifts a lock from wrong attempts.</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={reset.isPending} onClick={() => { setOpen(false); setTried(false); }}>Cancel</Button>
        <Button size="sm" loading={reset.isPending} disabled={reset.isPending} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) reset.mutate(); }}>Set password</Button>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const roles = useQuery({ queryKey: ['roles'], queryFn: staffApi.roles });
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '', role: '' });
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (f.fullName.trim().length < 2) errors.fullName = 'At least 2 characters';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.email = 'Enter an email address';
  const digits = f.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (f.phone.trim() && !/^[6-9]\d{9}$/.test(digits)) errors.phone = 'Enter a 10-digit mobile number';
  if (f.password.length < 8) errors.password = 'At least 8 characters';
  if (!f.role) errors.role = 'Choose a role';
  const invite = useMutation({
    mutationFn: () => staffApi.invite({ fullName: f.fullName.trim(), email: f.email.trim(), phone: f.phone.trim() || undefined, password: f.password, roles: [f.role] }),
    onSuccess: (r) => { toast.success(`${f.fullName.trim()} can sign in now`); onDone(r.id); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const server = invite.error instanceof ApiError ? invite.error.fieldErrors : {};
  const err = (k: string) => (tried ? errors[k] : undefined) ?? server[k];
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal open onClose={onClose} title="Add a staff member"
      footer={<><Button variant="ghost" onClick={onClose} disabled={invite.isPending}>Cancel</Button><Button loading={invite.isPending} disabled={invite.isPending || (tried && Object.keys(errors).length > 0)} onClick={() => { setTried(true); if (!Object.keys(errors).length) invite.mutate(); }}>Add staff</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Input label="Full name" value={f.fullName} error={err('fullName')} onChange={(e) => set('fullName', e.target.value)} /></div>
        <Input label="Email (sign-in)" type="email" value={f.email} error={err('email')} onChange={(e) => set('email', e.target.value)} />
        <Input label="Mobile (optional)" inputMode="tel" value={f.phone} error={err('phone')} onChange={(e) => set('phone', e.target.value)} />
        <Input label="Starting password" type="password" value={f.password} error={err('password')} hint="Share it privately; they can change it" onChange={(e) => set('password', e.target.value)} />
        <Select label="Role" value={f.role} error={err('role')} onChange={(e) => set('role', e.target.value)} options={[{ label: 'Choose…', value: '' }, ...(roles.data?.items ?? []).map((r) => ({ label: r.name, value: r.code }))]} />
      </div>
    </Modal>
  );
}

function Performance() {
  const [range, setRange] = useState({ from: addDaysIso(todayLocal(), -29), to: todayLocal() });
  const valid = range.from && range.to && range.from <= range.to;
  const q = useQuery({ queryKey: ['staff-performance', range], queryFn: () => staffApi.performance(range.from, range.to), enabled: !!valid, placeholderData: keepPreviousData });
  const rows = q.data?.items ?? [];
  const selling = rows.filter((r) => r.bookings > 0);
  const avg = selling.length ? selling.reduce((a, r) => a + r.revenueMinor, 0) / selling.length : 0;
  const columns: Column<StaffPerformance>[] = [
    { key: 'name', header: 'Staff', render: (r) => <div><div className="font-medium">{r.fullName}</div><div className="text-xs text-text-muted">{r.branchName ?? 'No branch'}</div></div> },
    { key: 'bookings', header: 'Bookings', render: (r) => r.bookings },
    { key: 'seats', header: 'Seats', render: (r) => r.seats },
    { key: 'revenue', header: 'Revenue', render: (r) => formatMoney(r.revenueMinor, 'INR') },
    { key: 'cancel', header: 'Cancelled', render: (r) => <span className={cn(r.cancellationRatePct > 20 && 'text-danger')}>{r.cancelled} ({r.cancellationRatePct}%)</span> },
    {
      key: 'flag', header: '', render: (r) => r.bookings === 0 ? <span className="text-xs text-text-muted">No counter sales</span>
        : r === selling[0] ? <Badge tone="success">Top seller</Badge>
          : selling.length > 2 && r.revenueMinor < avg / 2 ? <Badge tone="warning">Below half the average</Badge> : null,
    },
  ];
  return (
    <>
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <Input label="From" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} error={valid ? undefined : "'From' is after 'To'"} />
          <Input label="To" type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          <p className="ml-auto max-w-sm text-xs text-text-muted">Counter sales made by each staff member (Search & Book). Online sales by customers are not counted.</p>
        </CardBody>
      </Card>
      {!valid ? <EmptyState title="Pick a valid period" /> : q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : <Table columns={columns} rows={rows} />}
    </>
  );
}
