import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Network, Plus, Trash2, Webhook } from 'lucide-react';

import { Badge, Button, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, statusTone, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi, type Partner, type PartnerDetail } from '@/lib/api/platformAdmin';
import { formatDateTime, formatMoney, idempotencyKey } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const rupeesToMinor = (v: string) => Math.round(Number(v) * 100);

/**
 * OTAs and B2B partners that sell every operator's buses through the GDS API
 * (#37–#41, #119): onboarding, commercial terms, prepaid top-ups, API keys and
 * the partner's webhook. Each operator still decides whether to sell to them.
 */
export function PartnersPage() {
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Partner | null>(null);
  const q = useQuery({ queryKey: ['gds-partners', status], queryFn: () => platformAdminApi.partners(status || undefined) });
  const columns: Column<Partner>[] = [
    { key: 'n', header: 'Partner', look: 'strong', render: (r) => <span><b>{r.name}</b> <span className="font-mono text-xs text-text-muted">{r.code}</span></span> },
    { key: 'k', header: 'Type', under: 'n', render: (r) => (r.kind === 'ota' ? 'OTA' : 'Agent network') },
    { key: 's', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'b', header: 'Billing', under: 's', render: (r) => `${r.billingMode}${r.billingMode === 'postpaid' ? ` · limit ${formatMoney(r.creditLimitMinor)}` : ''}` },
    { key: 'bal', header: 'Balance', look: 'figure', render: (r) => formatMoney(r.balanceMinor) },
    { key: 'c', header: 'Commission', under: 'bal', render: (r) => `${r.defaultCommissionPct}%` },
    { key: 'a', header: '', render: (r) => <Button size="sm" variant="outline" onClick={() => setOpen(r)}>Manage</Button> },
  ];
  return (
    <>
      <PageHeader title="OTA partners" subtitle="redBus, AbhiBus, MakeMyTrip, Goibibo, ixigo and other partners on the GDS API"
        action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add partner</Button>} />
      <div className="mb-4 w-56"><Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'suspended', label: 'Suspended' }]} /></div>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data!.items.length === 0 ? (
        <EmptyState title="No partners" description="Add an OTA to let it sell operators' buses." icon={<Network className="h-10 w-10" />} action={<Button onClick={() => setAdding(true)}>Add partner</Button>} />
      ) : <Table columns={columns} rows={q.data!.items} />}
      {adding && <AddPartnerModal onClose={() => setAdding(false)} />}
      {open && <PartnerModal id={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </>
  );
}

function AddPartnerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key] = useState(() => idempotencyKey('partner'));
  const [f, setF] = useState({ code: '', name: '', kind: 'ota', billingMode: 'prepaid', credit: '0', pct: '8', email: '', phone: '' });
  const [tried, setTried] = useState(false);
  const e = {
    code: !/^[a-z0-9][a-z0-9-]{1,30}$/.test(f.code.trim().toLowerCase()) ? 'Lower-case letters, digits and -, e.g. redbus' : undefined,
    name: f.name.trim().length < 2 ? 'Name it' : undefined,
    credit: !(Number(f.credit) >= 0) ? '₹0 or more' : undefined,
    pct: !(Number(f.pct) >= 0 && Number(f.pct) <= 30) ? '0 to 30%' : undefined,
    email: f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim()) ? 'Check the email' : undefined,
    phone: f.phone.trim() && f.phone.replace(/\D/g, '').length < 10 ? '10-digit mobile' : undefined,
  };
  const save = useMutation({
    mutationFn: () => platformAdminApi.createPartner({
      code: f.code.trim().toLowerCase(), name: f.name.trim(), kind: f.kind, billingMode: f.billingMode,
      creditLimitMinor: rupeesToMinor(f.credit), defaultCommissionPct: Number(f.pct),
      contactEmail: f.email.trim() || undefined, contactPhone: f.phone.trim() || undefined,
    }, key),
    onSuccess: () => { toast.success(`${f.name.trim()} added — activate it and issue an API key`); void qc.invalidateQueries({ queryKey: ['gds-partners'] }); onClose(); },
    onError: (x) => toast.error(errText(x, 'Could not add the partner')),
  });
  const err = (k: keyof typeof e) => (tried ? e[k] : undefined);
  return (
    <Modal open onClose={onClose} title="Add a partner"
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!Object.values(e).some(Boolean)) save.mutate(); }}>Add</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Input label="Code" value={f.code} error={err('code')} onChange={(x) => setF({ ...f, code: x.target.value })} placeholder="redbus" />
        <Input label="Name" value={f.name} error={err('name')} onChange={(x) => setF({ ...f, name: x.target.value })} placeholder="redBus" />
        <Select label="Type" value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })} options={[{ value: 'ota', label: 'OTA' }, { value: 'agent', label: 'Agent network' }]} />
        <Select label="Billing" value={f.billingMode} onChange={(x) => setF({ ...f, billingMode: x.target.value })} options={[{ value: 'prepaid', label: 'Prepaid (tops up first)' }, { value: 'postpaid', label: 'Postpaid (credit limit)' }]} />
        {f.billingMode === 'postpaid' && <Input label="Credit limit (₹)" type="number" value={f.credit} error={err('credit')} onChange={(x) => setF({ ...f, credit: x.target.value })} />}
        <Input label="Commission (%)" type="number" value={f.pct} error={err('pct')} onChange={(x) => setF({ ...f, pct: x.target.value })} />
        <Input label="Contact email (optional)" value={f.email} error={err('email')} onChange={(x) => setF({ ...f, email: x.target.value })} />
        <Input label="Contact mobile (optional)" value={f.phone} error={err('phone')} onChange={(x) => setF({ ...f, phone: x.target.value })} />
      </div>
    </Modal>
  );
}

function PartnerModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['gds-partner', id], queryFn: () => platformAdminApi.partner(id) });
  return (
    <Modal open onClose={onClose} size="lg" title={name} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="flex flex-col gap-5 text-sm">
          <StatusSection p={q.data!} />
          <TermsSection p={q.data!} />
          {q.data!.billingMode === 'prepaid' && <TopUpSection p={q.data!} />}
          <KeysSection p={q.data!} />
          <WebhookSection id={id} />
        </div>
      )}
    </Modal>
  );
}

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['gds-partner', id] }); void qc.invalidateQueries({ queryKey: ['gds-partners'] }); };
}

function StatusSection({ p }: { p: PartnerDetail }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [reason, setReason] = useState('');
  const set = useMutation({
    mutationFn: (s: 'active' | 'suspended') => platformAdminApi.setPartnerStatus(p.id, s, reason.trim() || undefined),
    onSuccess: (_, s) => { toast.success(s === 'active' ? `${p.name} can sell now` : `${p.name} suspended — its keys stop working`); setReason(''); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not change the status')),
  });
  const next = p.status === 'active' ? 'suspended' : 'active';
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">Status <Badge tone={statusTone(p.status)}>{p.status}</Badge></h3>
      {p.statusReason && <p className="text-text-muted">{p.statusReason}</p>}
      <div className="flex items-start gap-2">
        <div className="flex-1"><Input aria-label="Reason" placeholder={next === 'suspended' ? 'Why (the partner is told)' : 'Note (optional)'} value={reason} maxLength={300} onChange={(x) => setReason(x.target.value)} /></div>
        <Button variant={next === 'suspended' ? 'danger' : 'primary'} loading={set.isPending} disabled={set.isPending || (next === 'suspended' && reason.trim().length < 3)} onClick={() => set.mutate(next)}>{next === 'suspended' ? 'Suspend' : 'Activate'}</Button>
      </div>
    </section>
  );
}

function TermsSection({ p }: { p: PartnerDetail }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [f, setF] = useState({ billingMode: p.billingMode, credit: String(p.creditLimitMinor / 100), pct: String(p.defaultCommissionPct) });
  const e = { credit: !(Number(f.credit) >= 0) ? '₹0 or more' : undefined, pct: !(Number(f.pct) >= 0 && Number(f.pct) <= 30) ? '0 to 30%' : undefined };
  const save = useMutation({
    mutationFn: () => platformAdminApi.setPartnerTerms(p.id, { billingMode: f.billingMode, creditLimitMinor: rupeesToMinor(f.credit), defaultCommissionPct: Number(f.pct) }),
    onSuccess: () => { toast.success('Terms saved'); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not save the terms')),
  });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">Terms <span className="font-normal text-text-muted">· can spend {formatMoney(p.spendableMinor)}</span></h3>
      <div className="grid grid-cols-3 items-start gap-2">
        <Select label="Billing" value={f.billingMode} onChange={(x) => setF({ ...f, billingMode: x.target.value as PartnerDetail['billingMode'] })} options={[{ value: 'prepaid', label: 'Prepaid' }, { value: 'postpaid', label: 'Postpaid' }]} />
        <Input label="Credit limit (₹)" type="number" value={f.credit} error={e.credit} disabled={f.billingMode === 'prepaid'} onChange={(x) => setF({ ...f, credit: x.target.value })} />
        <Input label="Commission (%)" type="number" value={f.pct} error={e.pct} onChange={(x) => setF({ ...f, pct: x.target.value })} />
      </div>
      <Button className="self-start" size="sm" loading={save.isPending} disabled={save.isPending || !!e.credit || !!e.pct} onClick={() => save.mutate()}>Save terms</Button>
    </section>
  );
}

function TopUpSection({ p }: { p: PartnerDetail }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [key, setKey] = useState(() => idempotencyKey('receipt'));
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const bad = !(Number(amount) > 0) || ref.trim().length < 3;
  const save = useMutation({
    mutationFn: () => platformAdminApi.partnerReceipt(p.id, { amountMinor: rupeesToMinor(amount), reference: ref.trim() }, key),
    onSuccess: (r) => { toast.success(r.applied ? `${formatMoney(rupeesToMinor(amount))} added to ${p.name}'s balance` : 'That reference was already recorded — nothing added'); setAmount(''); setRef(''); setKey(idempotencyKey('receipt')); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not record the payment')),
  });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">Money received <span className="font-normal text-text-muted">· balance {formatMoney(p.balanceMinor)}</span></h3>
      <div className="grid grid-cols-[1fr_1.4fr_auto] items-start gap-2">
        <Input aria-label="Amount (₹)" type="number" placeholder="Amount ₹" value={amount} onChange={(x) => setAmount(x.target.value)} />
        <Input aria-label="Bank reference" placeholder="UTR / bank reference" value={ref} maxLength={60} onChange={(x) => setRef(x.target.value)} />
        <Button size="sm" loading={save.isPending} disabled={save.isPending || bad} onClick={() => save.mutate()}>Record</Button>
      </div>
      {p.ledger.length > 0 && (
        <ul className="max-h-28 overflow-y-auto text-xs text-text-muted">
          {p.ledger.slice(0, 10).map((l) => <li key={l.id}>{formatDateTime(l.createdAt)} · {l.kind} · {formatMoney(l.amountMinor)} · bal {formatMoney(l.balanceAfterMinor)}{l.reference ? ` · ${l.reference}` : ''}</li>)}
        </ul>
      )}
    </section>
  );
}

function KeysSection({ p }: { p: PartnerDetail }) {
  const toast = useToast();
  const refresh = useRefresh(p.id);
  const [f, setF] = useState({ label: '', sandbox: false, ips: '', days: '' });
  const [shown, setShown] = useState<string | null>(null);
  const ips = f.ips.split(/[\s,]+/).filter(Boolean);
  const e = {
    label: f.label.trim().length < 2 ? 'Name the key' : undefined,
    ips: ips.some((x) => !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(x)) ? 'IPv4 addresses or ranges' : undefined,
    days: f.days.trim() && !(Number.isInteger(Number(f.days)) && Number(f.days) >= 1 && Number(f.days) <= 730) ? '1 to 730 days' : undefined,
  };
  const issue = useMutation({
    mutationFn: () => platformAdminApi.issuePartnerKey(p.id, { label: f.label.trim(), sandbox: f.sandbox, ipAllowlist: ips, expiresInDays: f.days.trim() ? Number(f.days) : undefined }),
    onSuccess: (r) => { setShown(r.key); setF({ label: '', sandbox: false, ips: '', days: '' }); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not issue the key')),
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => platformAdminApi.revokePartnerKey(p.id, keyId),
    onSuccess: () => { toast.success('Key revoked — it stops working now'); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not revoke')),
  });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-semibold text-text"><KeyRound className="h-4 w-4" /> API keys</h3>
      {shown && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-success/40 bg-success/10 p-2">
          <code className="break-all text-xs">{shown}</code>
          <Button size="sm" variant="outline" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => { void navigator.clipboard.writeText(shown); toast.success('Copied — it is not shown again'); }}>Copy</Button>
        </div>
      )}
      {p.keys.length === 0 ? <p className="text-text-muted">No keys yet.</p> : (
        <ul className="flex flex-col gap-1">
          {p.keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2">
              <span><b>{k.label}</b> <span className="font-mono text-xs">{k.prefix}…</span> {k.sandbox && <Badge tone="info">sandbox</Badge>} {k.revokedAt ? <Badge tone="neutral">revoked</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge tone="warning">expired</Badge> : null}
                <span className="block text-xs text-text-muted">{k.lastUsedAt ? `last used ${formatDateTime(k.lastUsedAt)}` : 'never used'}{k.ipAllowlist.length ? ` · only ${k.ipAllowlist.join(', ')}` : ''}</span></span>
              {!k.revokedAt && <Button size="sm" variant="ghost" aria-label={`Revoke ${k.label}`} loading={revoke.isPending && revoke.variables === k.id} disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke “${k.label}”? Calls with it fail from now.`)) revoke.mutate(k.id); }}><Trash2 className="h-4 w-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 items-start gap-2 border-t border-border pt-2">
        <Input label="New key name" value={f.label} error={f.label ? e.label : undefined} onChange={(x) => setF({ ...f, label: x.target.value })} placeholder="Production" />
        <Input label="Expires in days (optional)" type="number" value={f.days} error={e.days} onChange={(x) => setF({ ...f, days: x.target.value })} />
        <Input label="Only from these IPs (optional)" value={f.ips} error={e.ips} onChange={(x) => setF({ ...f, ips: x.target.value })} placeholder="203.0.113.5, 198.51.100.0/24" />
        <label className="mt-7 flex items-center gap-2"><input type="checkbox" checked={f.sandbox} onChange={(x) => setF({ ...f, sandbox: x.target.checked })} /> Sandbox key (no real bookings)</label>
      </div>
      <Button className="self-start" size="sm" loading={issue.isPending} disabled={issue.isPending || !!e.label || !!e.ips || !!e.days} onClick={() => issue.mutate()}>Issue key</Button>
    </section>
  );
}

function WebhookSection({ id }: { id: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['gds-partner-webhook', id], queryFn: () => platformAdminApi.partnerWebhook(id) });
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gds-partner-webhook', id] });
  const save = useMutation({
    mutationFn: () => platformAdminApi.setPartnerWebhook(id, { url: url.trim(), eventTypes: [] }),
    onSuccess: (r) => { setSecret(r.secret); setUrl(''); toast.success('Webhook saved — every event is sent to it'); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not save the webhook')),
  });
  const test = useMutation({
    mutationFn: () => platformAdminApi.testPartnerWebhook(id),
    onSuccess: (r) => { if (r.ok) toast.success(`Delivered (HTTP ${r.responseStatus}, ${r.latencyMs} ms)`); else toast.error(`Not delivered: ${r.error ?? `HTTP ${r.responseStatus}`}`); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not send the test')),
  });
  const remove = useMutation({
    mutationFn: () => platformAdminApi.removePartnerWebhook(id),
    onSuccess: () => { toast.success('Webhook removed'); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not remove it')),
  });
  const ep = q.data?.endpoint;
  const urlErr = url && !/^https:\/\//.test(url.trim()) ? 'Must start with https://' : undefined;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-semibold text-text"><Webhook className="h-4 w-4" /> Webhook</h3>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : ep ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <code className="break-all text-xs">{ep.url}</code>
          <span className="flex gap-1">
            <Button size="sm" variant="outline" loading={test.isPending} disabled={test.isPending} onClick={() => test.mutate()}>Send test</Button>
            <Button size="sm" variant="ghost" loading={remove.isPending} disabled={remove.isPending} onClick={() => { if (window.confirm('Stop sending events to this URL?')) remove.mutate(); }}>Remove</Button>
          </span>
        </div>
      ) : <p className="text-text-muted">No webhook — the partner polls instead.</p>}
      {secret && <p role="alert" className="rounded-md bg-success/10 p-2 text-xs">Signing secret (shown once): <code className="break-all">{secret}</code></p>}
      <div className="flex items-start gap-2">
        <div className="flex-1"><Input aria-label="Webhook URL" placeholder="https://partner.example.com/ticketly/events" value={url} error={urlErr} onChange={(x) => setUrl(x.target.value)} /></div>
        <Button size="sm" loading={save.isPending} disabled={save.isPending || !url.trim() || !!urlErr} onClick={() => save.mutate()}>{ep ? 'Replace' : 'Save'}</Button>
      </div>
      {(q.data?.deliveries.length ?? 0) > 0 && (
        <ul className="max-h-24 overflow-y-auto text-xs text-text-muted">
          {q.data!.deliveries.slice(0, 8).map((d) => <li key={d.id}>{formatDateTime(d.createdAt)} · {d.eventType} · {d.status}{d.responseStatus ? ` (${d.responseStatus})` : ''}</li>)}
        </ul>
      )}
    </section>
  );
}
