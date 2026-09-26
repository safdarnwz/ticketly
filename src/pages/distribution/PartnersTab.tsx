import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Handshake, KeyRound, Plus, Trash2 } from 'lucide-react';

import { Badge, Button, EmptyState, ErrorState, Input, Modal, PageLoader, Table, useToast, type Column } from '@/components/ui';
import { apiKeysApi, partnersApi, type ApiKey, type OtaPartner } from '@/lib/api/distribution';
import { staffApi } from '@/lib/api/staff';
import { cn, formatDateTime, fromAppDateTimeInput } from '@/lib/utils';

/** OTAs on the platform: switch selling through each on or off and set the commission you give it. */
export function PartnersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ota-partners'], queryFn: partnersApi.list });
  const [editing, setEditing] = useState<OtaPartner | null>(null);
  const [pct, setPct] = useState('');
  const save = useMutation({
    mutationFn: (v: { p: OtaPartner; status: 'active' | 'paused'; pct: number }) => partnersApi.setAgreement(v.p.partnerId, v.status, v.pct),
    onSuccess: (_r, v) => { toast.success(v.status === 'active' ? `Selling through ${v.p.name}` : `Paused on ${v.p.name}`); setEditing(null); void qc.invalidateQueries({ queryKey: ['ota-partners'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const pctBad = pct === '' || !(Number(pct) >= 0 && Number(pct) <= 30);
  const cols: Column<OtaPartner>[] = [
    { key: 'name', header: 'Partner', render: (p) => <div><div className="font-medium">{p.name}</div><div className="text-xs text-text-muted">{p.kind} · {p.code}</div></div> },
    { key: 'pct', header: 'Commission you give', render: (p) => p.commissionPct != null ? `${Number(p.commissionPct)}%` : <span className="text-text-muted">default {Number(p.defaultCommissionPct)}%</span> },
    { key: 'status', header: 'Selling', render: (p) => <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? 'On' : p.status === 'paused' ? 'Paused' : 'Not started'}</Badge> },
    { key: 'act', header: '', render: (p) => (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => { setEditing(p); setPct(String(Number(p.commissionPct ?? p.defaultCommissionPct))); }}>{p.status === 'active' ? 'Change' : 'Start selling'}</Button>
        {p.status === 'active' && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ p, status: 'paused', pct: Number(p.commissionPct ?? 0) })}>Pause</Button>}
      </div>) },
  ];
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <>
      {(q.data?.items.length ?? 0) === 0 ? <EmptyState title="No OTA partners on Ticketly yet" description="When the platform connects an OTA (redBus, Paytm…), it shows here and you choose whether to sell through it." icon={<Handshake className="h-10 w-10" />} />
        : <Table columns={cols} rows={q.data!.items} />}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`Sell through ${editing.name}`}
          footer={<><Button variant="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={pctBad || save.isPending} onClick={() => save.mutate({ p: editing, status: 'active', pct: Number(pct) })}>Save</Button></>}>
          <Input label="Commission you give them (%)" type="number" min={0} max={30} value={pct} error={pctBad ? '0 to 30' : undefined} onChange={(e) => setPct(e.target.value)} />
          <p className="mt-2 text-xs text-text-muted">You can stop selling on a single trip from the trip's chart (sales channels).</p>
        </Modal>
      )}
    </>
  );
}

/** Keys for your own systems or partners (X-Api-Key). A key can do only what you choose — never more than you can. */
export function ApiKeysTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: apiKeysApi.list });
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ apiKey: string; name: string } | null>(null);
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => apiKeysApi.revoke(k.id),
    onSuccess: () => { toast.success('Key revoked — it stops working within a minute'); void qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const cols: Column<ApiKey>[] = [
    { key: 'name', header: 'Name', render: (k) => <div><div className="font-medium">{k.name}</div><div className="font-mono text-xs text-text-muted">gds_{k.prefix}_…</div></div> },
    { key: 'scopes', header: 'Can', render: (k) => <div className="flex flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</div> },
    { key: 'ips', header: 'From', render: (k) => <span className="text-xs">{k.ipAllowlist.length ? k.ipAllowlist.join(', ') : 'Any IP'}</span> },
    { key: 'exp', header: 'Expires', render: (k) => <span className="text-xs text-text-muted">{k.expiresAt ? formatDateTime(k.expiresAt) : 'Never'}</span> },
    { key: 'act', header: '', render: (k) => <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} disabled={revoke.isPending} onClick={() => { if (window.confirm(`Revoke "${k.name}"? Anything using it stops working.`)) revoke.mutate(k); }}>Revoke</Button> },
  ];
  return (
    <>
      <div className="mb-3 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New API key</Button></div>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (q.data?.items.length ?? 0) === 0
        ? <EmptyState title="No API keys" description="Create one for your ERP or a partner that needs to call Ticketly directly." icon={<KeyRound className="h-10 w-10" />} />
        : <Table columns={cols} rows={q.data!.items} />}
      {adding && <NewKeyModal onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setShown(r); void qc.invalidateQueries({ queryKey: ['api-keys'] }); }} />}
      {shown && (
        <Modal open onClose={() => setShown(null)} title={`Key "${shown.name}" created`} footer={<Button onClick={() => setShown(null)}>I have stored it</Button>}>
          <p className="mb-2 text-sm text-warning">Copy it now — it is never shown again.</p>
          <div className="flex items-center gap-2 rounded-md bg-surface-muted p-2"><code className="break-all text-xs">{shown.apiKey}</code>
            <Button size="sm" variant="ghost" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void navigator.clipboard?.writeText(shown.apiKey).then(() => toast.success('Copied'))}>Copy</Button></div>
        </Modal>
      )}
    </>
  );
}

function NewKeyModal({ onClose, onDone }: { onClose: () => void; onDone: (r: { apiKey: string; name: string }) => void }) {
  const toast = useToast();
  const cat = useQuery({ queryKey: ['permission-catalogue'], queryFn: staffApi.permissionCatalogue });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [ips, setIps] = useState('');
  const [expires, setExpires] = useState('');
  const [tried, setTried] = useState(false);
  const ipList = ips.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const e: Record<string, string> = {};
  if (name.trim().length < 2) e.name = 'At least 2 characters';
  if (scopes.size === 0) e.scopes = 'Pick what the key may do';
  if (ipList.some((ip) => !/^[\d.:a-fA-F]+(\/\d{1,3})?$/.test(ip))) e.ips = 'IP addresses or ranges like 203.0.113.0/24';
  if (expires && fromAppDateTimeInput(expires) <= Date.now()) e.expires = 'Pick a future date';
  const create = useMutation({
    mutationFn: () => apiKeysApi.create({ name: name.trim(), scopes: [...scopes], ipAllowlist: ipList.length ? ipList : undefined, expiresAt: expires ? new Date(fromAppDateTimeInput(expires)).toISOString() : undefined }),
    onSuccess: (r) => onDone({ apiKey: r.apiKey, name: name.trim() }),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });
  return (
    <Modal open onClose={onClose} size="lg" title="New API key"
      footer={<><Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending} onClick={() => { setTried(true); if (!Object.keys(e).length) create.mutate(); }}>Create key</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <Input label="Name" placeholder="e.g. Accounts ERP" value={name} error={tried ? e.name : undefined} onChange={(x) => setName(x.target.value)} />
        <div>
          <div className="mb-1 font-medium">What it may do {tried && e.scopes && <span role="alert" className="text-xs text-danger">— {e.scopes}</span>}</div>
          <div className="grid max-h-64 grid-cols-2 gap-x-4 overflow-y-auto rounded-md border border-border p-2">
            {(cat.data?.groups ?? []).flatMap((g) => g.items).map((i) => (
              <label key={i.code} className={cn('flex items-center gap-2 py-0.5', !i.grantable && 'opacity-50')} title={i.grantable ? i.code : 'You do not hold this yourself'}>
                <input type="checkbox" disabled={!i.grantable} checked={scopes.has(i.code)} onChange={() => { const n = new Set(scopes); if (n.has(i.code)) n.delete(i.code); else n.add(i.code); setScopes(n); }} />{i.label}
              </label>
            ))}
          </div>
        </div>
        <Input label="Only from these IPs (optional)" placeholder="203.0.113.10, 198.51.100.0/24" value={ips} error={tried ? e.ips : undefined} onChange={(x) => setIps(x.target.value)} />
        <Input label="Expires (optional)" type="datetime-local" value={expires} error={tried ? e.expires : undefined} onChange={(x) => setExpires(x.target.value)} />
      </div>
    </Modal>
  );
}
