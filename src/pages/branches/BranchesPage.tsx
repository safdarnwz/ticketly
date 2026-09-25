import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, PauseCircle, PlayCircle } from 'lucide-react';

import { Button, Badge, statusTone, Table, type Column, Modal, Input, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { branchesApi, type Branch } from '@/lib/api/branches';

export function BranchesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '' });

  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list });

  const create = useMutation({
    mutationFn: () => branchesApi.create(form),
    onSuccess: () => { toast.success('Branch created'); setAdding(false); setForm({ name: '', address: '', phone: '' }); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const update = useMutation({
    mutationFn: () => branchesApi.update(editing!.id, form),
    onSuccess: () => { toast.success('Branch updated'); setEditing(null); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => branchesApi.deactivate(id),
    onSuccess: () => { toast.success('Branch deactivated'); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const activate = useMutation({
    mutationFn: (id: string) => branchesApi.activate(id),
    onSuccess: () => { toast.success('Branch activated'); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const openEdit = (b: Branch) => { setEditing(b); setForm({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' }); };

  const columns: Column<Branch>[] = [
    { key: 'name', header: 'Branch', render: (b) => <button className="font-medium text-text underline decoration-dotted" onClick={() => openEdit(b)}>{b.name}</button> },
    { key: 'address', header: 'Address', render: (b) => <span className="text-text-muted">{b.address ?? '—'}</span> },
    { key: 'phone', header: 'Phone', render: (b) => b.phone ?? '—' },
    { key: 'staff', header: 'Staff', render: (b) => b.staffCount },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
    {
      key: 'actions', header: '', render: (b) => (
        <div className="flex justify-end gap-2">
          {b.status === 'active'
            ? <Button size="sm" variant="ghost" leftIcon={<PauseCircle className="h-4 w-4" />} loading={deactivate.isPending} onClick={() => deactivate.mutate(b.id)}>Deactivate</Button>
            : <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate(b.id)}>Activate</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Branches" subtitle="Physical offices/counters — track staff and counter sales per location"
        action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New branch</Button>} />

      {branches.isLoading ? <PageLoader /> : branches.isError ? <ErrorState error={branches.error} onRetry={branches.refetch} /> :
        (branches.data?.items.length ? <Table columns={columns} rows={branches.data.items} /> : <EmptyState title="No branches yet" icon={<Building2 className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a branch"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.name} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Branch name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Delhi ISBT Counter" />
          <Input label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit — ${editing?.name ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={update.isPending} disabled={!form.name} onClick={() => update.mutate()}>Save</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Branch name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
      </Modal>
    </>
  );
}
