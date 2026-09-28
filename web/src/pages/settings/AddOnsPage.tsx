import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, useToast, type Column } from '@/components/ui';
import { addOnsApi, type AddOn } from '@/lib/api/waitlistRules';
import { formatMoney } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const KINDS = [
  { value: 'luggage', label: 'Extra luggage' },
  { value: 'meal', label: 'Meal' },
  { value: 'insurance', label: 'Travel insurance' },
  { value: 'priority', label: 'Priority boarding' },
  { value: 'other', label: 'Other' },
];

/** What passengers can add at checkout (#253 extra bags per piece, meals, insurance…), stopped without losing past sales. */
export function AddOnsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['add-ons'], queryFn: addOnsApi.list });
  const [editing, setEditing] = useState<AddOn | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (a: AddOn) => addOnsApi.save({ code: a.code, name: a.name, kind: a.kind, priceMinor: a.priceMinor, perPassenger: a.perPassenger, active: !a.active }),
    onSuccess: (_, a) => { toast.success(a.active ? `${a.name} is no longer offered` : `${a.name} is on sale again`); void qc.invalidateQueries({ queryKey: ['add-ons'] }); },
    onError: (x) => toast.error(errText(x, 'Could not change it')),
  });
  const cols: Column<AddOn>[] = [
    { key: 'n', header: 'Add-on', look: 'strong', render: (a) => <span><b>{a.name}</b> <span className="font-mono text-xs text-text-muted">{a.code}</span></span> },
    { key: 'k', header: 'Kind', under: 'n', render: (a) => KINDS.find((k) => k.value === a.kind)?.label ?? a.kind },
    { key: 'p', header: 'Price', look: 'figure', render: (a) => `${formatMoney(a.priceMinor)} ${a.perPassenger ? 'per passenger' : 'per piece'}` },
    { key: 's', header: 'Status', render: (a) => <Badge tone={a.active ? 'success' : 'neutral'}>{a.active ? 'on sale' : 'stopped'}</Badge> },
    { key: 'x', header: '', render: (a) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
        <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === a.id} disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>{a.active ? 'Stop' : 'Resume'}</Button>
      </div>
    ) },
  ];
  return (
    <Card>
      <CardHeader title="Add-ons" subtitle="Offered at checkout; GST is added on top" action={<Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New add-on</Button>} />
      <CardBody className="p-0">
        {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data!.items.length === 0 ? (
          <EmptyState title="No add-ons yet" description="Sell extra bags, meals or insurance at checkout." action={<Button onClick={() => setEditing('new')}>New add-on</Button>} />
        ) : <Table columns={cols} rows={q.data!.items} />}
      </CardBody>
      {editing && <AddOnModal a={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function AddOnModal({ a, onClose }: { a: AddOn | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ code: a?.code ?? '', name: a?.name ?? '', kind: a?.kind ?? 'luggage', price: a ? String(a.priceMinor / 100) : '', perPassenger: a?.perPassenger ?? false });
  const [tried, setTried] = useState(false);
  const price = Number(f.price);
  const e = {
    code: !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(f.code.trim().toLowerCase()) ? 'Letters, digits, - and _ (e.g. extra-bag)' : undefined,
    name: f.name.trim().length < 2 ? 'Name it' : undefined,
    price: f.price.trim() === '' || !(price >= 0 && price <= 10000) ? '₹0 to ₹10,000' : undefined,
  };
  const save = useMutation({
    mutationFn: () => addOnsApi.save({ code: f.code.trim().toLowerCase(), name: f.name.trim(), kind: f.kind as AddOn['kind'], priceMinor: Math.round(price * 100), perPassenger: f.perPassenger, active: a?.active ?? true }),
    onSuccess: () => { toast.success(a ? 'Add-on saved' : 'Add-on on sale'); void qc.invalidateQueries({ queryKey: ['add-ons'] }); onClose(); },
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  return (
    <Modal open onClose={onClose} title={a ? `Edit ${a.name}` : 'New add-on'}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!Object.values(e).some(Boolean)) save.mutate(); }}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Input label="Code" value={f.code} disabled={!!a} error={tried ? e.code : undefined} hint={a ? 'Fixed once created' : undefined} onChange={(x) => setF({ ...f, code: x.target.value })} />
        <Select label="Kind" value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value as AddOn['kind'] })} options={KINDS} />
        <div className="col-span-2"><Input label="Name passengers see" value={f.name} error={tried ? e.name : undefined} onChange={(x) => setF({ ...f, name: x.target.value })} placeholder="Extra bag (up to 15 kg)" /></div>
        <Input label="Price (₹, before GST)" type="number" value={f.price} error={tried ? e.price : undefined} onChange={(x) => setF({ ...f, price: x.target.value })} />
        <label className="mt-7 flex items-center gap-2"><input type="checkbox" checked={f.perPassenger} onChange={(x) => setF({ ...f, perPassenger: x.target.checked })} /> Per passenger (else per piece)</label>
      </div>
    </Modal>
  );
}
