import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Webhook as WebhookIcon, Trash2, Copy, Radio, Send } from 'lucide-react';

import { Button, Badge, statusTone, Table, type Column, Modal, Input, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { distributionApi, type Webhook, type WebhookDelivery } from '@/lib/api/distribution';
import { formatDateTime } from '@/lib/utils';

/** Mirrors the API's check so the message shows next to the field before sending. */
function urlProblem(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return 'Enter the URL your partner gave you';
  let url: URL;
  try { url = new URL(value); } catch { return 'Enter a full URL, like https://partner.example.com/hooks'; }
  if (url.protocol !== 'https:') return 'Webhook URLs must use https';
  const host = url.hostname;
  if (!host.includes('.') || /(^|\.)(localhost|local|internal)$/i.test(host) || /^(127|10|192\.168|169\.254)\./.test(host)) return 'Use a public host name, reachable from the internet';
  return undefined;
}

export function WebhooksTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [tried, setTried] = useState(false);
  const [viewingDeliveries, setViewingDeliveries] = useState<Webhook | null>(null);
  const [revoking, setRevoking] = useState<Webhook | null>(null);
  const [justCreated, setJustCreated] = useState<{ id: string; secret: string } | null>(null);
  const [form, setForm] = useState({ name: '', url: '', events: [] as string[] });

  const catalogue = useQuery({ queryKey: ['webhook-catalogue'], queryFn: distributionApi.catalogue });
  const webhooks = useQuery({ queryKey: ['webhooks'], queryFn: distributionApi.list });
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', viewingDeliveries?.id],
    queryFn: () => distributionApi.deliveries(viewingDeliveries!.id),
    enabled: !!viewingDeliveries,
  });

  const register = useMutation({
    mutationFn: () => distributionApi.register({ name: form.name.trim(), url: form.url.trim(), eventTypes: form.events }),
    onSuccess: (res) => { setJustCreated(res); setAdding(false); void qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not register webhook'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => distributionApi.revoke(id),
    onSuccess: () => { toast.success('Webhook revoked — nothing more is sent to it'); setRevoking(null); void qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const test = useMutation({
    mutationFn: (id: string) => distributionApi.test(id),
    onSuccess: (r) => (r.ok
      ? toast.success(`Test delivered — HTTP ${r.responseStatus} in ${r.latencyMs} ms`)
      : toast.error(`Test not delivered — ${r.error ?? 'no answer'}`)),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const errors = {
    name: form.name.trim().length < 2 ? 'At least 2 characters' : undefined,
    url: urlProblem(form.url),
  };
  const server = register.error instanceof ApiError ? register.error.fieldErrors : {};
  const invalid = !!(errors.name || errors.url);
  const open = () => { setForm({ name: '', url: '', events: [] }); setTried(false); register.reset(); setAdding(true); };
  const submit = () => { setTried(true); if (!invalid) register.mutate(); };
  const toggleEvent = (e: string) => setForm((f) => ({ ...f, events: f.events.includes(e) ? f.events.filter((x) => x !== e) : [...f.events, e] }));

  const columns: Column<Webhook>[] = [
    { key: 'name', header: 'Name', look: 'strong', render: (w) => <span className="font-medium text-text">{w.name}</span> },
    { key: 'url', header: 'URL', look: 'muted', under: 'name', render: (w) => <span className="break-all font-mono text-xs text-text-muted">{w.url}</span> },
    { key: 'events', header: 'Events', render: (w) => w.eventTypes.length ? <span title={w.eventTypes.join(', ')}>{w.eventTypes.length} selected</span> : 'All events' },
    { key: 'since', header: 'Added', look: 'muted', under: 'status', render: (w) => <span className="text-xs text-text-muted">{formatDateTime(w.createdAt)}</span> },
    { key: 'status', header: 'Status', render: (w) => <Badge tone={w.isActive ? 'success' : 'neutral'}>{w.isActive ? 'Active' : 'Revoked'}</Badge> },
    {
      key: 'actions', header: '', render: (w) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<Send className="h-4 w-4" />} loading={test.isPending && test.variables === w.id} disabled={test.isPending} onClick={() => test.mutate(w.id)}>Send test</Button>
          <Button size="sm" variant="ghost" leftIcon={<Radio className="h-4 w-4" />} onClick={() => setViewingDeliveries(w)}>Deliveries</Button>
          {w.isActive && <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setRevoking(w)}>Revoke</Button>}
        </div>
      ),
    },
  ];

  const deliveryColumns: Column<WebhookDelivery>[] = [
    { key: 'when', header: 'When', look: 'muted', under: 'event', render: (d) => formatDateTime(d.createdAt) },
    { key: 'event', header: 'Event', look: 'strong', render: (d) => <Badge>{d.eventType}</Badge> },
    { key: 'status', header: 'Status', render: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge> },
    { key: 'attempts', header: 'Attempts', look: 'count', under: 'status', render: (d) => d.attempts },
    { key: 'code', header: 'Answer', under: 'status', render: (d) => d.responseStatus ?? '—' },
    { key: 'error', header: 'Last error', look: 'note', render: (d) => <span className="text-xs text-danger">{d.lastError ?? '—'}</span> },
  ];

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-text-muted">Push real-time updates to your partners (OTAs, your ERP) — signed, retried, no polling needed.</p>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={open}>New webhook</Button>
      </div>

      {webhooks.isLoading ? <PageLoader /> : webhooks.isError ? <ErrorState error={webhooks.error} onRetry={webhooks.refetch} /> :
        (webhooks.data?.items.length ? <Table columns={columns} rows={webhooks.data.items} /> : <EmptyState title="No partner webhooks yet" description="Register one so a partner (redBus, Paytm, your ERP) is told about bookings as they happen." icon={<WebhookIcon className="h-10 w-10" />} />)}
      {catalogue.data && <p className="mt-3 text-xs text-text-muted">{catalogue.data.retries}</p>}

      <Modal open={adding} onClose={() => setAdding(false)} title="Register a partner webhook" size="lg"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)} disabled={register.isPending}>Cancel</Button><Button loading={register.isPending} disabled={register.isPending || (tried && invalid)} onClick={submit}>Register</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Name" placeholder="redBus production" maxLength={80} value={form.name} error={(tried ? errors.name : undefined) ?? server.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="URL" placeholder="https://partner.example.com/webhooks/ticketly" maxLength={500} value={form.url} error={(tried ? errors.url : undefined) ?? server.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          <div>
            <div className="mb-1.5 text-sm font-medium text-text">Events <span className="text-xs font-normal text-text-muted">— none ticked means every event</span></div>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-2">
              {(catalogue.data?.events ?? []).map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.events.includes(e)} onChange={() => toggleEvent(e)} /> <span className="font-mono text-xs">{e}</span></label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!justCreated} onClose={() => setJustCreated(null)} title="Webhook registered">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Save this signing secret now — it is shown only once.</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted p-3">
            <code className="flex-1 truncate text-xs">{justCreated?.secret}</code>
            <Button size="sm" variant="outline" leftIcon={<Copy className="h-4 w-4" />}
              onClick={() => { void navigator.clipboard?.writeText(justCreated!.secret).then(() => toast.success('Copied'), () => toast.error('Copy failed — select and copy it by hand')); }}>Copy</Button>
          </div>
          <p className="text-xs text-text-muted">{catalogue.data?.signature}</p>
          <div className="flex justify-end"><Button size="sm" variant="outline" leftIcon={<Send className="h-4 w-4" />} loading={test.isPending} onClick={() => justCreated && test.mutate(justCreated.id)}>Send a test event</Button></div>
        </div>
      </Modal>

      <Modal open={!!revoking} onClose={() => setRevoking(null)} title="Revoke this webhook?"
        footer={<><Button variant="ghost" onClick={() => setRevoking(null)} disabled={revoke.isPending}>Keep it</Button><Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>Revoke</Button></>}>
        <p className="text-sm text-text"><strong>{revoking?.name}</strong> stops receiving events straight away. Registering the URL again gives it a new secret.</p>
      </Modal>

      <Modal open={!!viewingDeliveries} onClose={() => setViewingDeliveries(null)} title={`Deliveries — ${viewingDeliveries?.name ?? ''}`} size="lg">
        {deliveries.isLoading ? <PageLoader /> : deliveries.isError ? <ErrorState error={deliveries.error} onRetry={deliveries.refetch} /> :
          (deliveries.data?.items.length ? <Table columns={deliveryColumns} rows={deliveries.data.items} /> : <EmptyState title="No deliveries yet" description="Events are sent here as bookings happen. Use Send test to check the endpoint now." icon={<Radio className="h-10 w-10" />} />)}
      </Modal>
    </>
  );
}
