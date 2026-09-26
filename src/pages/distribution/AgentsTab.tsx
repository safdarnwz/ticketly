import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Search, Users } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, useToast, type Column } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { agentsApi, type Agent, type AgentLedgerEntry, type AgentStatus, type BillingMode, type Slab } from '@/lib/api/agents';
import { branchesApi } from '@/lib/api/branches';
import { AgentComplaints } from './AgentComplaints';
import { addDaysIso, cn, formatDateTime, formatMoney, idempotencyKey, todayLocal } from '@/lib/utils';

const STATUS_TONE: Record<AgentStatus, 'success' | 'warning' | 'danger' | 'neutral'> = { active: 'success', pending: 'warning', suspended: 'danger', rejected: 'neutral' };
const rupees = (v: string) => Math.round(Number(v) * 100);
const isAmount = (v: string, { allowZero = false, allowNegative = false } = {}) => {
  if (v.trim() === '' || !/^-?\d+(\.\d{1,2})?$/.test(v.trim())) return false;
  const n = Number(v);
  return (allowNegative || n >= 0) && (allowZero || n !== 0);
};
const fieldErrs = (e: unknown) => (e instanceof ApiError ? e.fieldErrors : {});

/** Travel agents who sell your seats: their terms, their money, and what they sold. */
export function AgentsTab() {
  const [status, setStatus] = useState<AgentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [slabs, setSlabs] = useState(false);
  const list = useQuery({
    queryKey: ['agents', status, search.trim()],
    queryFn: () => agentsApi.list({ status: status || undefined, search: search.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];

  const columns: Column<Agent>[] = [
    { key: 'name', header: 'Agent', render: (a) => <div><div className="font-medium text-text">{a.name}</div><div className="font-mono text-xs text-text-muted">{a.code}{a.city ? ` · ${a.city}` : ''}</div></div> },
    { key: 'terms', header: 'Terms', render: (a) => <span className="text-sm">{a.billingMode === 'prepaid' ? 'Prepaid' : `Credit ${formatMoney(a.creditLimitMinor)}`} · {a.commissionPct}%</span> },
    { key: 'balance', header: 'Balance', render: (a) => <div><span className={cn('text-sm', a.balanceMinor < 0 && 'text-danger')}>{formatMoney(a.balanceMinor)}</span>{a.lowBalance && <Badge tone="warning" className="ml-1">Low</Badge>}<div className="text-xs text-text-muted">Can spend {formatMoney(a.spendableMinor)}</div></div> },
    { key: 'sales', header: 'Sales', render: (a) => <span className="text-sm">{a.bookings ?? 0} · {formatMoney(a.salesMinor ?? 0)}</span> },
    { key: 'status', header: 'Status', render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> },
  ];

  return (
    <>
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Input aria-label="Search agents" placeholder="Name, code or phone" leftIcon={<Search className="h-4 w-4" />} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="w-40"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as AgentStatus | '')}
            options={[{ label: 'All', value: '' }, { label: 'Active', value: 'active' }, { label: 'Waiting approval', value: 'pending' }, { label: 'Suspended', value: 'suspended' }, { label: 'Rejected', value: 'rejected' }]} /></div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" leftIcon={<Percent className="h-4 w-4" />} onClick={() => setSlabs(true)}>Commission slabs</Button>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New agent</Button>
          </div>
        </CardBody>
      </Card>
      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? (
        <EmptyState title={search || status ? 'No agent matches' : 'No travel agents yet'} description="Agents get their own login, book your seats and earn commission." icon={<Users className="h-10 w-10" />} />
      ) : <Table columns={columns} rows={rows} onRowClick={(a) => setOpen(a.id)} />}

      {adding && <NewAgentModal onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); setOpen(id); }} />}
      {open && <AgentModal id={open} onClose={() => setOpen(null)} />}
      {slabs && <SlabsModal onClose={() => setSlabs(false)} />}
    </>
  );
}

function NewAgentModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('agent'));
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list });
  const [f, setF] = useState({ name: '', contactName: '', contactPhone: '', loginEmail: '', password: '', city: '', branchId: '', gstin: '', billingMode: 'prepaid' as BillingMode, commissionPct: '5', credit: '', lowAlert: '', terms: '7', activate: true });
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = 'At least 2 characters';
  if (!/^\+?\d{10,15}$/.test(f.contactPhone.replace(/\s/g, ''))) e.contactPhone = 'A 10-digit mobile';
  if (!/^\S+@\S+\.\S+$/.test(f.loginEmail.trim())) e.loginEmail = 'A valid email';
  if (f.password.length < 8) e.password = 'At least 8 characters';
  if (!(Number(f.commissionPct) >= 0 && Number(f.commissionPct) <= 50) || f.commissionPct === '') e.commissionPct = '0 to 50';
  if (f.billingMode === 'postpaid' && !isAmount(f.credit)) e.credit = 'A credit limit in ₹';
  if (f.lowAlert && !isAmount(f.lowAlert, { allowZero: true })) e.lowAlert = 'An amount in ₹';
  if (f.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.trim().toUpperCase())) e.gstin = 'Not a valid GSTIN';
  const create = useMutation({
    mutationFn: () => agentsApi.create({
      name: f.name.trim(), contactName: f.contactName.trim() || undefined, contactPhone: f.contactPhone.replace(/\s/g, ''), loginEmail: f.loginEmail.trim(), password: f.password,
      city: f.city.trim() || undefined, branchId: f.branchId || undefined, gstin: f.gstin.trim() || undefined,
      billingMode: f.billingMode, commissionPct: Number(f.commissionPct), creditLimitMinor: f.billingMode === 'postpaid' ? rupees(f.credit) : undefined,
      lowBalanceAlertMinor: f.lowAlert ? rupees(f.lowAlert) : undefined, paymentTermsDays: Number(f.terms) || 7, activate: f.activate,
    }, key),
    onSuccess: (r) => { toast.success(`Agent ${r.code} created — they can sign in now`); void qc.invalidateQueries({ queryKey: ['agents'] }); onDone(r.agentId); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });
  const s = fieldErrs(create.error);
  const err = (k: string, sk = k) => (tried ? e[k] : undefined) ?? s[sk];
  return (
    <Modal open onClose={onClose} size="lg" title="New travel agent"
      footer={<><Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending} onClick={() => { setTried(true); if (!Object.keys(e).length) create.mutate(); }}>Create agent</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Agency name" value={f.name} error={err('name')} onChange={(x) => set('name', x.target.value)} />
        <Input label="Contact person (optional)" value={f.contactName} onChange={(x) => set('contactName', x.target.value)} />
        <Input label="Mobile" value={f.contactPhone} error={err('contactPhone')} onChange={(x) => set('contactPhone', x.target.value)} />
        <Input label="City (optional)" value={f.city} onChange={(x) => set('city', x.target.value)} />
        <Input label="Sign-in email" value={f.loginEmail} error={err('loginEmail')} onChange={(x) => set('loginEmail', x.target.value)} />
        <Input label="Starting password" type="password" value={f.password} error={err('password')} hint="Share privately" onChange={(x) => set('password', x.target.value)} />
        <Select label="Billing" value={f.billingMode} onChange={(x) => set('billingMode', x.target.value)} options={[{ label: 'Prepaid — tops up a wallet', value: 'prepaid' }, { label: 'Postpaid — books on credit', value: 'postpaid' }]} />
        {f.billingMode === 'postpaid' ? <Input label="Credit limit (₹)" type="number" value={f.credit} error={err('credit', 'creditLimitMinor')} onChange={(x) => set('credit', x.target.value)} />
          : <Input label="Warn below balance (₹, optional)" type="number" value={f.lowAlert} error={err('lowAlert')} onChange={(x) => set('lowAlert', x.target.value)} />}
        <Input label="Commission %" type="number" value={f.commissionPct} error={err('commissionPct')} onChange={(x) => set('commissionPct', x.target.value)} />
        {f.billingMode === 'postpaid' && <Input label="Payment terms (days)" type="number" min={0} max={90} value={f.terms} onChange={(x) => set('terms', x.target.value)} />}
        <Select label="Branch (optional)" value={f.branchId} onChange={(x) => set('branchId', x.target.value)} options={[{ label: 'No branch', value: '' }, ...(branches.data?.items ?? []).filter((b) => b.status === 'active').map((b) => ({ label: b.name, value: b.id }))]} />
        <Input label="GSTIN (optional)" value={f.gstin} error={err('gstin')} onChange={(x) => set('gstin', x.target.value.toUpperCase())} />
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.activate} onChange={(x) => set('activate', x.target.checked)} /> Approve now (otherwise waits for approval)</label>
      </div>
    </Modal>
  );
}

function AgentModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const a = useQuery({ queryKey: ['agent', id], queryFn: () => agentsApi.get(id) });
  const [tab, setTab] = useState<'money' | 'terms' | 'statement' | 'complaints'>('money');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['agent', id] }); void qc.invalidateQueries({ queryKey: ['agents'] }); void qc.invalidateQueries({ queryKey: ['agent-ledger', id] }); };
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState<'suspended' | 'rejected' | null>(null);
  const status = useMutation({
    mutationFn: (to: 'active' | 'suspended' | 'rejected') => agentsApi.setStatus(id, to, to === 'active' ? undefined : reason.trim()),
    onSuccess: (_r, to) => { toast.success(to === 'active' ? 'Agent can book again' : to === 'suspended' ? 'Agent suspended — they cannot book' : 'Agent rejected'); setActing(null); setReason(''); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const d = a.data;
  return (
    <Modal open onClose={onClose} size="lg" title={d ? `${d.name} · ${d.code}` : 'Agent'}>
      {a.isLoading ? <PageLoader /> : a.isError ? <ErrorState error={a.error} onRetry={a.refetch} /> : d && (
        <div className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-4 gap-2 rounded-md bg-surface-muted p-3">
            <div><div className="text-xs text-text-muted">Balance</div><div className={cn('text-lg font-semibold', d.balanceMinor < 0 && 'text-danger')}>{formatMoney(d.balanceMinor)}</div></div>
            <div><div className="text-xs text-text-muted">Can spend</div><div className="text-lg font-semibold">{formatMoney(d.spendableMinor)}</div></div>
            <div><div className="text-xs text-text-muted">Terms</div><div className="font-semibold">{d.billingMode === 'prepaid' ? 'Prepaid' : `Credit ${formatMoney(d.creditLimitMinor)}`}</div></div>
            <div><div className="text-xs text-text-muted">Status</div><Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge></div>
          </div>
          {d.statusReason && d.status !== 'active' && <p className="text-text-muted">Reason: {d.statusReason}</p>}
          <div className="flex flex-wrap gap-2">
            {d.status !== 'active' && <Button size="sm" loading={status.isPending && status.variables === 'active'} disabled={status.isPending} onClick={() => status.mutate('active')}>{d.status === 'pending' ? 'Approve' : 'Re-activate'}</Button>}
            {d.status === 'active' && <Button size="sm" variant="outline" onClick={() => setActing('suspended')}>Suspend</Button>}
            {d.status === 'pending' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setActing('rejected')}>Reject</Button>}
          </div>
          {acting && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <Input label={acting === 'suspended' ? 'Why suspend?' : 'Why reject?'} value={reason} maxLength={500} error={reason.trim().length > 0 && reason.trim().length < 10 ? 'At least 10 characters' : undefined} onChange={(e) => setReason(e.target.value)} />
              <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setActing(null)}>Cancel</Button>
                <Button size="sm" variant="danger" loading={status.isPending} disabled={reason.trim().length < 10 || status.isPending} onClick={() => status.mutate(acting)}>{acting === 'suspended' ? 'Suspend' : 'Reject'}</Button></div>
            </div>
          )}
          <div className="flex gap-2 border-b border-border">
            {([['money', 'Money'], ['terms', 'Terms & commission'], ['statement', 'Statement'], ['complaints', 'Complaints']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn('border-b-2 px-3 py-1.5', tab === k ? 'border-primary text-text' : 'border-transparent text-text-muted')}>{l}</button>
            ))}
          </div>
          {tab === 'money' ? <MoneyTab agent={d} onDone={refresh} /> : tab === 'terms' ? <TermsTab agent={d} onDone={refresh} /> : tab === 'complaints' ? <AgentComplaints agentId={d.id} /> : <StatementTab id={d.id} />}
        </div>
      )}
    </Modal>
  );
}

const KIND_LABEL: Record<string, string> = { deposit: 'Top-up', payment_received: 'Payment received', booking: 'Booking', refund: 'Refund', commission: 'Commission', adjustment: 'Adjustment' };

function MoneyTab({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const toast = useToast();
  const [rKey, setRKey] = useState(() => idempotencyKey('receipt'));
  const [aKey, setAKey] = useState(() => idempotencyKey('adjust'));
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [adj, setAdj] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const ledger = useQuery({ queryKey: ['agent-ledger', agent.id], queryFn: () => agentsApi.ledger(agent.id) });
  const receipt = useMutation({
    mutationFn: () => agentsApi.receipt(agent.id, { amountMinor: rupees(amount), reference: ref.trim() }, rKey),
    onSuccess: (r) => { toast[r.applied ? 'success' : 'info'](r.applied ? `Recorded — balance ${formatMoney(r.balanceMinor)}` : 'That reference was already recorded — nothing changed'); setAmount(''); setRef(''); setRKey(idempotencyKey('receipt')); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const adjust = useMutation({
    mutationFn: () => agentsApi.adjust(agent.id, { amountMinor: rupees(adj), reason: adjReason.trim() }, aKey),
    onSuccess: (r) => { toast.success(`Adjusted — balance ${formatMoney(r.balanceMinor)}`); setAdj(''); setAdjReason(''); setAKey(idempotencyKey('adjust')); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const amountBad = amount !== '' && !isAmount(amount);
  const adjBad = adj !== '' && !isAmount(adj, { allowNegative: true });
  const cols: Column<AgentLedgerEntry>[] = [
    { key: 'when', header: 'When', render: (l) => <span className="text-xs text-text-muted">{formatDateTime(l.createdAt)}</span> },
    { key: 'what', header: 'What', render: (l) => <span>{KIND_LABEL[l.kind] ?? l.kind}{l.pnr ? <span className="font-mono text-xs text-text-muted"> · {l.pnr}</span> : ''}{l.note ? <span className="text-xs text-text-muted"> · {l.note}</span> : ''}</span> },
    { key: 'amt', header: 'Amount', render: (l) => <span className={l.amountMinor < 0 ? 'text-danger' : 'text-success'}>{formatMoney(l.amountMinor)}</span> },
    { key: 'bal', header: 'Balance', render: (l) => formatMoney(l.balanceAfterMinor) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3" disabled={receipt.isPending}>
          <legend className="px-1 font-semibold">{agent.billingMode === 'prepaid' ? 'Record a top-up' : 'Record a payment'}</legend>
          <Input label="Amount (₹)" type="number" value={amount} error={amountBad ? 'An amount above ₹0' : undefined} onChange={(e) => setAmount(e.target.value)} />
          <Input label="UTR / receipt no." value={ref} error={ref && ref.trim().length < 3 ? 'At least 3 characters' : undefined} hint="The same number twice is ignored" onChange={(e) => setRef(e.target.value)} />
          <Button size="sm" loading={receipt.isPending} disabled={!isAmount(amount) || ref.trim().length < 3} onClick={() => receipt.mutate()}>Record</Button>
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3" disabled={adjust.isPending}>
          <legend className="px-1 font-semibold">Correction</legend>
          <Input label="Amount (₹, minus to deduct)" type="number" value={adj} error={adjBad ? 'Not zero; up to 2 decimals' : undefined} onChange={(e) => setAdj(e.target.value)} />
          <Input label="Reason" value={adjReason} error={adjReason && adjReason.trim().length < 10 ? 'At least 10 characters' : undefined} onChange={(e) => setAdjReason(e.target.value)} />
          <Button size="sm" variant="outline" loading={adjust.isPending} disabled={!isAmount(adj, { allowNegative: true }) || adjReason.trim().length < 10} onClick={() => adjust.mutate()}>Apply correction</Button>
        </fieldset>
      </div>
      <div className="font-semibold">Ledger</div>
      {ledger.isLoading ? <PageLoader /> : ledger.isError ? <ErrorState error={ledger.error} onRetry={ledger.refetch} /> : (ledger.data?.items.length ?? 0) === 0 ? <p className="text-text-muted">No money movements yet.</p> : <Table columns={cols} rows={ledger.data!.items} />}
    </div>
  );
}

function TermsTab({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ billingMode: agent.billingMode, credit: String(agent.creditLimitMinor / 100), commissionPct: String(agent.commissionPct), terms: String(agent.paymentTermsDays), lowAlert: String(agent.lowBalanceAlertMinor / 100), contactPhone: agent.contactPhone });
  const e: Record<string, string> = {};
  if (f.billingMode === 'postpaid' && !isAmount(f.credit, { allowZero: true })) e.credit = 'An amount in ₹';
  if (!(Number(f.commissionPct) >= 0 && Number(f.commissionPct) <= 50) || f.commissionPct === '') e.commissionPct = '0 to 50';
  if (!(Number(f.terms) >= 0 && Number(f.terms) <= 90)) e.terms = '0 to 90 days';
  if (!/^\+?\d{10,15}$/.test(f.contactPhone.replace(/\s/g, ''))) e.contactPhone = 'A 10-digit mobile';
  const save = useMutation({
    mutationFn: () => agentsApi.update(agent.id, { billingMode: f.billingMode, creditLimitMinor: f.billingMode === 'postpaid' ? rupees(f.credit) : undefined, commissionPct: Number(f.commissionPct), paymentTermsDays: Number(f.terms), lowBalanceAlertMinor: rupees(f.lowAlert || '0'), contactPhone: f.contactPhone.replace(/\s/g, '') }),
    onSuccess: () => { toast.success('Terms saved'); onDone(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Billing" value={f.billingMode} onChange={(x) => setF({ ...f, billingMode: x.target.value as BillingMode })} options={[{ label: 'Prepaid', value: 'prepaid' }, { label: 'Postpaid (credit)', value: 'postpaid' }]} />
        {f.billingMode === 'postpaid' && <Input label="Credit limit (₹)" type="number" value={f.credit} error={e.credit} hint={agent.balanceMinor < 0 ? `They owe ${formatMoney(-agent.balanceMinor)} — the limit cannot go below that` : undefined} onChange={(x) => setF({ ...f, credit: x.target.value })} />}
        <Input label="Base commission %" type="number" value={f.commissionPct} error={e.commissionPct} onChange={(x) => setF({ ...f, commissionPct: x.target.value })} />
        <Input label="Payment terms (days)" type="number" value={f.terms} error={e.terms} onChange={(x) => setF({ ...f, terms: x.target.value })} />
        <Input label="Warn below balance (₹)" type="number" value={f.lowAlert} onChange={(x) => setF({ ...f, lowAlert: x.target.value })} />
        <Input label="Mobile" value={f.contactPhone} error={e.contactPhone} onChange={(x) => setF({ ...f, contactPhone: x.target.value })} />
      </div>
      <div className="flex justify-end"><Button loading={save.isPending} disabled={save.isPending || Object.keys(e).length > 0} onClick={() => save.mutate()}>Save terms</Button></div>
      <AgentSlabs id={agent.id} />
    </div>
  );
}

function AgentSlabs({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['agent-slabs', id], queryFn: () => agentsApi.slabs(id) });
  if (!q.data) return null;
  const { agentSlabs, operatorDefaultSlabs, currentRate } = q.data;
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1 font-semibold">Commission this month: {currentRate.pct}%</div>
      <p className="text-xs text-text-muted">Sold {formatMoney(currentRate.monthSalesMinor)} so far · {agentSlabs.length ? 'own slabs' : operatorDefaultSlabs.length ? 'your default slabs' : 'base commission'}</p>
      <SlabEditor initial={agentSlabs} save={(s) => agentsApi.setSlabs(id, s)} queryKey={['agent-slabs', id]} emptyNote="Empty = use your default slabs" />
    </div>
  );
}

function SlabsModal({ onClose }: { onClose: () => void }) {
  const q = useQuery({ queryKey: ['agent-default-slabs'], queryFn: agentsApi.defaultSlabs });
  return (
    <Modal open onClose={onClose} title="Default commission slabs">
      <p className="mb-2 text-sm text-text-muted">The more an agent sells in a month, the higher their commission. The first slab starts at ₹0 and a higher slab never pays less. An agent's own slabs replace these.</p>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : <SlabEditor initial={q.data!.operatorDefaultSlabs} save={agentsApi.setDefaultSlabs} queryKey={['agent-default-slabs']} emptyNote="Empty = every agent gets their base commission" />}
    </Modal>
  );
}

function SlabEditor({ initial, save, queryKey, emptyNote }: { initial: Slab[]; save: (s: Slab[]) => Promise<unknown>; queryKey: unknown[]; emptyNote: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rows, setRows] = useState(initial.map((s) => ({ from: String(s.minMonthlySalesMinor / 100), pct: String(s.commissionPct) })));
  let problem: string | undefined;
  rows.forEach((r, i) => {
    if (!isAmount(r.from, { allowZero: true }) || r.pct === '' || !(Number(r.pct) >= 0 && Number(r.pct) <= 50)) problem ??= `Row ${i + 1}: amount and 0–50%`;
    else if (i === 0 && Number(r.from) !== 0) problem ??= 'The first slab must start at ₹0';
    else if (i > 0 && Number(r.from) <= Number(rows[i - 1].from)) problem ??= `Row ${i + 1} must start above row ${i}`;
    else if (i > 0 && Number(r.pct) < Number(rows[i - 1].pct)) problem ??= `Row ${i + 1} cannot pay less than row ${i}`;
  });
  const m = useMutation({
    mutationFn: () => save(rows.map((r) => ({ minMonthlySalesMinor: rupees(r.from), commissionPct: Number(r.pct) }))),
    onSuccess: () => { toast.success('Slabs saved'); void qc.invalidateQueries({ queryKey }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      {rows.length === 0 && <p className="text-xs text-text-muted">{emptyNote}</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input label={i === 0 ? 'Monthly sales from (₹)' : undefined} aria-label={`Slab ${i + 1} from`} type="number" value={r.from} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
          <Input label={i === 0 ? 'Commission %' : undefined} aria-label={`Slab ${i + 1} percent`} type="number" value={r.pct} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
          <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      <div className="flex gap-2">
        {rows.length < 10 && <Button size="sm" variant="outline" onClick={() => setRows([...rows, { from: rows.length ? '' : '0', pct: '' }])}>Add slab</Button>}
        <Button size="sm" loading={m.isPending} disabled={!!problem || m.isPending} onClick={() => m.mutate()}>Save slabs</Button>
      </div>
    </div>
  );
}

function StatementTab({ id }: { id: string }) {
  const [range, setRange] = useState({ from: addDaysIso(todayLocal(), -29), to: todayLocal() });
  const valid = range.from && range.to && range.from <= range.to;
  const q = useQuery({ queryKey: ['agent-statement', id, range], queryFn: () => agentsApi.statement(id, range.from, range.to), enabled: !!valid, placeholderData: keepPreviousData });
  const s = q.data;
  const row = (label: string, v: number, strong = false) => <div className={cn('flex justify-between py-1', strong && 'border-t border-border font-semibold')}><span>{label}</span><span className={v < 0 ? 'text-danger' : ''}>{formatMoney(v)}</span></div>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Input label="From" type="date" value={range.from} max={range.to} error={valid ? undefined : "'From' is after 'To'"} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input label="To" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      {!valid ? null : q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : s && (
        <div className="max-w-md">
          {row('Opening balance', s.openingBalanceMinor)}
          {row(`Sales (${s.bookings} bookings)`, s.salesMinor)}
          {row('Refunds', s.refundsMinor)}
          {row('Commission earned', s.commissionMinor)}
          {row('Money received', s.receivedMinor)}
          {row('Corrections', s.adjustmentsMinor)}
          {row('Closing balance', s.closingBalanceMinor, true)}
          {s.amountDueMinor > 0 && <div className="mt-2 rounded-md bg-warning/10 p-2 font-semibold">Amount due: {formatMoney(s.amountDueMinor)}</div>}
        </div>
      )}
    </div>
  );
}
