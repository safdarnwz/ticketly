import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, PauseCircle, PlayCircle, Pencil } from 'lucide-react';

import { Button, Badge, Table, type Column, Modal, Input, PageLoader, ErrorState, EmptyState, useToast, Select } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { branchesApi, WEEKDAYS, type Branch, type Weekday, type WorkingHours } from '@/lib/api/branches';
import { staffApi } from '@/lib/api/staff';

const DAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const DEFAULT_HOURS: WorkingHours = Object.fromEntries(WEEKDAYS.map((d) => [d, { open: '06:00', close: '22:00' }]));
const EMPTY = { name: '', code: '', address: '', phone: '', managerUserId: '', hours: DEFAULT_HOURS };
type Form = typeof EMPTY;

/** Same rules as the API, shown next to each field. */
function formErrors(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = 'At least 2 characters';
  if (f.code.trim() && !/^[A-Z0-9][A-Z0-9-]{1,11}$/i.test(f.code.trim())) e.code = '2 to 12 letters, digits or dashes';
  const digits = f.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (f.phone.trim() && (!/^\+?[\d\s-]{10,16}$/.test(f.phone.trim()) || !/^\d{10,12}$/.test(digits))) e.phone = 'Enter a phone number with its STD code, e.g. 011 2345 6789';
  for (const d of WEEKDAYS) {
    const h = f.hours[d];
    if (h && h.open === h.close) e[`hours.${d}`] = 'Opens and closes at the same time';
  }
  return e;
}

function hoursSummary(h: WorkingHours | undefined): string {
  if (!h || Object.keys(h).length === 0) return 'Not set';
  const open = WEEKDAYS.filter((d) => h[d]);
  if (open.length === 0) return 'Closed every day';
  const first = h[open[0]]!;
  const same = open.every((d) => h[d]!.open === first.open && h[d]!.close === first.close);
  const days = open.length === 7 ? 'Daily' : open.map((d) => DAY_LABEL[d]).join(', ');
  return same ? `${days} ${first.open}–${first.close}${first.close < first.open ? ' (next day)' : ''}` : `${open.length} days, varying hours`;
}

export function BranchesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [stopping, setStopping] = useState<Branch | null>(null);
  const [tried, setTried] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);

  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list });
  const staff = useQuery({ queryKey: ['staff', 'managers'], queryFn: () => staffApi.list({ status: 'active', page: 1 }) });
  const staffName = (id: string | null) => (id ? staff.data?.items.find((x) => x.id === id)?.fullName ?? '—' : '—');

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name.trim(), code: form.code.trim().toUpperCase() || undefined, address: form.address.trim(), phone: form.phone.trim(), workingHours: form.hours, managerUserId: form.managerUserId || undefined };
      return editing === 'new' ? branchesApi.create(body).then(() => undefined) : branchesApi.update((editing as Branch).id, body).then(() => undefined);
    },
    onSuccess: () => { toast.success(editing === 'new' ? `${form.name.trim()} added` : 'Branch saved'); setEditing(null); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const toggle = useMutation({
    mutationFn: (b: Branch) => (b.status === 'active' ? branchesApi.deactivate(b.id) : branchesApi.activate(b.id)),
    onSuccess: (_r, b) => { toast.success(b.status === 'active' ? `${b.name} deactivated` : `${b.name} is active again`); setStopping(null); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const errors = formErrors(form);
  const server = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const err = (k: string) => (tried ? errors[k] : undefined) ?? server[k];
  const open = (b: Branch | 'new') => {
    setForm(b === 'new' ? EMPTY : { name: b.name, code: b.code ?? '', address: b.address ?? '', phone: b.phone ?? '', managerUserId: b.managerUserId ?? '', hours: Object.keys(b.workingHours ?? {}).length ? b.workingHours : DEFAULT_HOURS });
    setTried(false); save.reset(); setEditing(b);
  };
  const submit = () => { setTried(true); if (Object.keys(errors).length === 0) save.mutate(); };
  const setDay = (d: Weekday, v: { open: string; close: string } | null) => setForm((f) => ({ ...f, hours: { ...f.hours, [d]: v } }));

  const columns: Column<Branch>[] = [
    { key: 'name', header: 'Branch', look: 'strong', render: (b) => <div><span className="font-medium text-text">{b.name}</span>{b.code && <div className="font-mono text-xs text-text-muted">{b.code}</div>}</div> },
    { key: 'address', header: 'Address', look: 'muted', under: 'name', render: (b) => <span className="text-text-muted">{b.address || '—'}</span> },
    { key: 'phone', header: 'Phone', under: 'manager', render: (b) => b.phone || '—' },
    { key: 'hours', header: 'Hours', look: 'muted', optional: true, render: (b) => <span className="text-xs text-text-muted">{hoursSummary(b.workingHours)}</span> },
    { key: 'manager', header: 'Manager', look: 'strong', render: (b) => <span className="text-sm">{staffName(b.managerUserId)}</span> },
    { key: 'staff', header: 'Staff', look: 'count', render: (b) => b.staffCount },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status === 'active' ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', header: '', render: (b) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => open(b)}>Edit</Button>
          {b.status === 'active'
            ? <Button size="sm" variant="ghost" className="text-danger" leftIcon={<PauseCircle className="h-4 w-4" />} disabled={toggle.isPending} onClick={() => setStopping(b)}>Deactivate</Button>
            : <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={toggle.isPending && toggle.variables?.id === b.id} disabled={toggle.isPending} onClick={() => toggle.mutate(b)}>Activate</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Branches" subtitle="Your offices and counters — where staff sell tickets, and when each is open"
        action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => open('new')}>New branch</Button>} />

      {branches.isLoading ? <PageLoader /> : branches.isError ? <ErrorState error={branches.error} onRetry={branches.refetch} /> :
        (branches.data?.items.length ? <Table columns={columns} rows={branches.data.items} /> : <EmptyState title="No branches yet" description="Add a counter or office to track its staff and counter sales." icon={<Building2 className="h-10 w-10" />} />)}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a branch' : `Edit — ${(editing as Branch | null)?.name ?? ''}`} size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={save.isPending || (tried && Object.keys(errors).length > 0)} onClick={submit}>{editing === 'new' ? 'Add branch' : 'Save'}</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Branch name" placeholder="Delhi ISBT Counter" maxLength={160} value={form.name} error={err('name')} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Input label="Code (optional)" placeholder="DEL-ISBT" maxLength={12} value={form.code} error={err('code')} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" placeholder="011 2345 6789" value={form.phone} error={err('phone')} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <Input label="Address" maxLength={500} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Manager" value={form.managerUserId} onChange={(e) => setForm((f) => ({ ...f, managerUserId: e.target.value }))}
              options={[{ label: form.managerUserId ? 'Keep current' : 'No manager', value: form.managerUserId && !staff.data?.items.some((x) => x.id === form.managerUserId) ? form.managerUserId : '' }, ...(staff.data?.items ?? []).map((x) => ({ label: x.fullName, value: x.id }))]} />
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-text">Opening hours <span className="text-xs font-normal text-text-muted">— closing before opening means it stays open past midnight</span></div>
            <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              {WEEKDAYS.map((d) => {
                const h = form.hours[d];
                return (
                  <div key={d} className="grid grid-cols-[3rem_6rem_1fr_1fr] items-center gap-2 text-sm">
                    <span className="font-medium">{DAY_LABEL[d]}</span>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!h} onChange={(e) => setDay(d, e.target.checked ? { open: '06:00', close: '22:00' } : null)} /> Open</label>
                    {h ? (
                      <>
                        <Input aria-label={`${DAY_LABEL[d]} opens`} type="time" value={h.open} onChange={(e) => setDay(d, { ...h, open: e.target.value })} error={err(`hours.${d}`)} />
                        <Input aria-label={`${DAY_LABEL[d]} closes`} type="time" value={h.close} onChange={(e) => setDay(d, { ...h, close: e.target.value })} />
                      </>
                    ) : <span className="col-span-2 text-xs text-text-muted">Closed</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!stopping} onClose={() => setStopping(null)} title="Deactivate this branch?"
        footer={<><Button variant="ghost" onClick={() => setStopping(null)} disabled={toggle.isPending}>Keep it</Button><Button variant="danger" loading={toggle.isPending} onClick={() => stopping && toggle.mutate(stopping)}>Deactivate</Button></>}>
        <p className="text-sm text-text"><strong>{stopping?.name}</strong> is marked inactive and no longer counts towards your plan’s branch limit.{stopping?.staffCount ? ` Its ${stopping.staffCount} staff member${stopping.staffCount === 1 ? '' : 's'} stay assigned to it — move them to another branch if they still sell.` : ''} You can activate it again later.</p>
      </Modal>
    </>
  );
}
