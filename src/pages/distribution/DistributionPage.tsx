import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Webhook as WebhookIcon, Trash2, Copy, Radio } from 'lucide-react';

import { Button, Card, CardBody, Badge, statusTone, Table, type Column, Modal, Input, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { distributionApi, type Webhook, type WebhookDelivery } from '@/lib/api/distribution';

export function DistributionPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [viewingDeliveries, setViewingDeliveries] = useState<Webhook | null>(null);
  const [justCreated, setJustCreated] = useState<{ id: string; secret: string } | null>(null);
  const [form, setForm] = useState({ name: '', url: '' });

  const catalogue = useQuery({ queryKey: ['webhook-catalogue'], queryFn: distributionApi.catalogue });
  const webhooks = useQuery({ queryKey: ['webhooks'], queryFn: distributionApi.list });
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', viewingDeliveries?.id],
    queryFn: () => distributionApi.deliveries(viewingDeliveries!.id),
    enabled: !!viewingDeliveries,
  });

  const register = useMutation({
    mutationFn: () => distributionApi.register(form),
    onSuccess: (res) => { setJustCreated(res); setAdding(false); setForm({ name: '', url: '' }); void qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not register webhook'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => distributionApi.revoke(id),
    onSuccess: () => { toast.success('Webhook revoked'); void qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const columns: Column<Webhook>[] = [
    { key: 'name', header: 'Name', render: (w) => <span className="font-medium text-text">{w.name}</span> },
    { key: 'url', header: 'URL', render: (w) => <span className="font-mono text-xs text-text-muted">{w.url}</span> },
    { key: 'events', header: 'Events', render: (w) => w.eventTypes.length ? `${w.eventTypes.length} selected` : 'All events' },
    { key: 'status', header: 'Status', render: (w) => <Badge tone={w.isActive ? 'success' : 'neutral'}>{w.isActive ? 'Active' : 'Revoked'}</Badge> },
    {
      key: 'actions', header: '', render: (w) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<Radio className="h-4 w-4" />} onClick={() => setViewingDeliveries(w)}>Deliveries</Button>
          {w.isActive && <Button size="sm" variant="outline" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => revoke.mutate(w.id)}>Revoke</Button>}
        </div>
      ),
    },
  ];

  const deliveryColumns: Column<WebhookDelivery>[] = [
    { key: 'when', header: 'When', render: (d) => new Date(d.createdAt).toLocaleString() },
    { key: 'event', header: 'Event', render: (d) => <Badge>{d.eventType}</Badge> },
    { key: 'status', header: 'Status', render: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge> },
    { key: 'attempts', header: 'Attempts', render: (d) => d.attempts },
    { key: 'error', header: 'Last error', render: (d) => <span className="text-xs text-danger">{d.lastError ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Distribution" subtitle="Push real-time updates to OTA/GDS partners integrated via your API key — no polling needed"
        action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New webhook</Button>} />

      {webhooks.isLoading ? <PageLoader /> : webhooks.isError ? <ErrorState error={webhooks.error} onRetry={webhooks.refetch} /> :
        (webhooks.data?.items.length ? <Table columns={columns} rows={webhooks.data.items} /> : <EmptyState title="No partner webhooks yet" description="Register one so a partner (redBus, Paytm, etc.) gets pushed updates instead of polling." icon={<WebhookIcon className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Register a partner webhook"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={register.isPending} disabled={!form.name || !form.url} onClick={() => register.mutate()}>Register</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Name" placeholder="redBus production" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="URL" placeholder="https://partner.example.com/webhooks/ticketly" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          <p className="text-xs text-text-muted">Subscribes to every event by default: {catalogue.data?.events.join(', ')}</p>
        </div>
      </Modal>

      <Modal open={!!justCreated} onClose={() => setJustCreated(null)} title="Webhook registered">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Save this signing secret now — it is shown only once.</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted p-3">
            <code className="flex-1 truncate text-xs">{justCreated?.secret}</code>
            <Button size="sm" variant="outline" leftIcon={<Copy className="h-4 w-4" />}
              onClick={() => { void navigator.clipboard.writeText(justCreated!.secret); toast.success('Copied'); }}>Copy</Button>
          </div>
          <p className="text-xs text-text-muted">Verify deliveries with header <code>X-Ticketly-Signature: sha256=&lt;hex&gt;</code>, where hex = HMAC-SHA256(this secret, the raw JSON body).</p>
        </div>
      </Modal>

      <Modal open={!!viewingDeliveries} onClose={() => setViewingDeliveries(null)} title={`Deliveries — ${viewingDeliveries?.name ?? ''}`} size="lg">
        {deliveries.isLoading ? <PageLoader /> : deliveries.isError ? <ErrorState error={deliveries.error} onRetry={deliveries.refetch} /> :
          (deliveries.data?.items.length ? <Table columns={deliveryColumns} rows={deliveries.data.items} /> : <EmptyState title="No deliveries yet" icon={<Radio className="h-10 w-10" />} />)}
      </Modal>
    </>
  );
}
