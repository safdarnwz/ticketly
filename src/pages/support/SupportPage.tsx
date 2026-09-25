import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, LifeBuoy } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Badge, statusTone, Input, Select, Table, type Column, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { supportApi, type Ticket } from '@/lib/api/content';
import { formatDateTime } from '@/lib/utils';

export function SupportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [draft, setDraft] = useState({ subject: '', body: '', category: 'general', priority: 'normal' });

  const list = useQuery({ queryKey: ['support', statusFilter], queryFn: () => supportApi.list(statusFilter || undefined) });

  const create = useMutation({
    mutationFn: () => supportApi.open(draft),
    onSuccess: () => {
      toast.success('Ticket created');
      setOpen(false);
      setDraft({ subject: '', body: '', category: 'general', priority: 'normal' });
      void qc.invalidateQueries({ queryKey: ['support'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create ticket'),
  });

  const columns: Column<Ticket>[] = [
    { key: 'subject', header: 'Subject', render: (t) => <span className="font-medium text-text">{t.subject}</span> },
    { key: 'category', header: 'Category', render: (t) => <span className="capitalize text-text-muted">{t.category}</span> },
    { key: 'priority', header: 'Priority', render: (t) => <Badge tone={t.priority === 'urgent' ? 'danger' : 'neutral'}>{t.priority}</Badge> },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
    { key: 'updated', header: 'Updated', render: (t) => <span className="text-text-muted">{t.updatedAt ? formatDateTime(t.updatedAt) : '—'}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Customer support tickets"
        action={<Button onClick={() => setOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>New ticket</Button>}
      />

      <div className="mb-4 max-w-xs">
        <Select
          label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          options={[{ label: 'All', value: '' }, { label: 'Open', value: 'open' }, { label: 'Pending', value: 'pending' }, { label: 'Resolved', value: 'resolved' }, { label: 'Closed', value: 'closed' }]}
        />
      </div>

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> :
        (list.data?.tickets?.length ? (
          <Table columns={columns} rows={list.data.tickets} />
        ) : <EmptyState title="No tickets" description="Open a ticket to get started." icon={<LifeBuoy className="h-10 w-10" />} />)}

      {open && (
        <Card className="mt-4">
          <CardHeader title="New support ticket" action={<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>} />
          <CardBody className="flex flex-col gap-4">
            <Input label="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                options={[{ label: 'General', value: 'general' }, { label: 'Booking', value: 'booking' }, { label: 'Payment', value: 'payment' }, { label: 'Refund', value: 'refund' }]} />
              <Select label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                options={[{ label: 'Low', value: 'low' }, { label: 'Normal', value: 'normal' }, { label: 'High', value: 'high' }, { label: 'Urgent', value: 'urgent' }]} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-text">Message</label>
              <textarea
                value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4}
                className="rounded-input border border-border bg-surface px-input-x py-2 text-sm text-text focus-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} loading={create.isPending}>Create</Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}
