import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Megaphone, Trash2 } from 'lucide-react';
import { formatDateTime, fromAppDateTimeInput } from '@/lib/utils';

import { Button, Card, CardBody, Badge, Modal, Input, Select, PageLoader, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { announcementsApi, type Announcement } from '@/lib/api/announcements';

const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;

export function AnnouncementsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', severity: 'info' as const, audience: 'operators' as const, endsAt: '' });

  const list = useQuery({ queryKey: ['announcements'], queryFn: announcementsApi.listAll });

  const create = useMutation({
    mutationFn: () => announcementsApi.create({ ...form, endsAt: form.endsAt ? new Date(fromAppDateTimeInput(form.endsAt)).toISOString() : undefined }),
    onSuccess: () => { toast.success('Announcement published'); setAdding(false); setForm({ title: '', body: '', severity: 'info', audience: 'operators', endsAt: '' }); void qc.invalidateQueries({ queryKey: ['announcements'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => announcementsApi.remove(id),
    onSuccess: () => { toast.success('Removed'); void qc.invalidateQueries({ queryKey: ['announcements'] }); },
  });

  const now = new Date();
  const isActive = (a: Announcement) => new Date(a.startsAt) <= now && (!a.endsAt || new Date(a.endsAt) >= now);

  return (
    <>
      <PageHeader title="Announcements" subtitle="Platform-wide broadcast banners — shown to operators and/or customers"
        action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New announcement</Button>} />

      {list.isLoading ? <PageLoader /> : list.data?.items.length ? (
        <div className="flex flex-col gap-3">
          {list.data.items.map((a) => (
            <Card key={a.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                    <Badge>{a.audience}</Badge>
                    {isActive(a) ? <Badge tone="success">Live now</Badge> : <Badge tone="neutral">Not active</Badge>}
                  </div>
                  <div className="mt-1 font-medium text-text">{a.title}</div>
                  <div className="text-sm text-text-muted">{a.body}</div>
                  <div className="mt-1 text-xs text-text-muted">From {formatDateTime(a.startsAt)}{a.endsAt ? ` to ${formatDateTime(a.endsAt)}` : ' — no end date'}</div>
                </div>
                <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => remove.mutate(a.id)}>Remove</Button>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : <EmptyState title="No announcements yet" icon={<Megaphone className="h-10 w-10" />} />}

      <Modal open={adding} onClose={() => setAdding(false)} title="New announcement"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.title || !form.body} onClick={() => create.mutate()}>Publish</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Scheduled maintenance tonight" />
          <Input label="Body" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Booking will be briefly unavailable between 2-3 AM IST." />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Severity" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as never }))}
              options={[{ label: 'Info', value: 'info' }, { label: 'Warning', value: 'warning' }, { label: 'Critical', value: 'critical' }]} />
            <Select label="Audience" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as never }))}
              options={[{ label: 'Operators', value: 'operators' }, { label: 'Customers', value: 'customers' }, { label: 'Everyone', value: 'all' }]} />
          </div>
          <Input label="Ends at (optional)" type="datetime-local" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
        </div>
      </Modal>
    </>
  );
}
