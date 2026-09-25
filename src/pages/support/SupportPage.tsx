import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Plus, Search, Send, UserCheck, UserMinus } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { supportApi, type Ticket, type TicketQuery, type TicketStatus } from '@/lib/api/content';
import { useAuth } from '@/stores/auth';
import { cn, formatDateTime } from '@/lib/utils';

const VIEWS: { key: string; label: string; query: TicketQuery }[] = [
  { key: 'active', label: 'Active', query: { status: 'active' } },
  { key: 'mine', label: 'Mine', query: { status: 'active', assigned: 'me' } },
  { key: 'unassigned', label: 'Unassigned', query: { status: 'active', assigned: 'none' } },
  { key: 'resolved', label: 'Resolved', query: { status: 'resolved' } },
  { key: 'closed', label: 'Closed', query: { status: 'closed' } },
  { key: 'all', label: 'All', query: {} },
];
const STATUS: Record<TicketStatus, [string, 'info' | 'warning' | 'success' | 'neutral']> = {
  open: ['Needs reply', 'warning'],
  pending: ['Waiting on customer', 'info'],
  resolved: ['Resolved', 'success'],
  closed: ['Closed', 'neutral'],
};
const PRIORITY_TONE = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' } as const;
const CATEGORIES = [{ label: 'Booking', value: 'booking' }, { label: 'Refund', value: 'refund' }, { label: 'Payment', value: 'payment' }, { label: 'General', value: 'general' }];
const PRIORITIES = [{ label: 'Low', value: 'low' }, { label: 'Normal', value: 'normal' }, { label: 'High', value: 'high' }, { label: 'Urgent', value: 'urgent' }];

function age(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/**
 * The operator's support desk: tickets that need a reply first, most urgent
 * and oldest on top. Open one to read the thread, answer, take it, or move it
 * on. Staff can raise a ticket for a caller by PNR.
 */
export function SupportPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.key === params.get('view')) ?? VIEWS[0];
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('ticket'));
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['support', view.key, q.trim()],
    queryFn: () => supportApi.list({ ...view.query, q: q.trim() || undefined }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const rows = list.data?.tickets ?? [];

  const columns: Column<Ticket>[] = [
    {
      key: 'subject', header: 'Ticket', render: (t) => (
        <div>
          <div className="font-medium text-text">{t.subject}</div>
          <div className="text-xs capitalize text-text-muted">{t.category}{t.pnr ? <> · <span className="font-mono normal-case">{t.pnr}</span></> : ''}{t.customerName ? ` · ${t.customerName}` : ''}</div>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge> },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge> },
    { key: 'owner', header: 'Assigned', render: (t) => <span className={cn('text-sm', !t.assignedName && 'text-text-muted')}>{t.assignedName ?? 'Nobody'}</span> },
    { key: 'age', header: 'Waiting', render: (t) => <span className="text-xs text-text-muted" title={formatDateTime(t.createdAt)}>{t.status === 'open' || t.status === 'pending' ? age(t.lastMessageAt ?? t.createdAt) : '—'}{t.lastAuthor === 'customer' && t.status === 'open' ? ' · customer wrote last' : ''}</span> },
  ];

  return (
    <>
      <PageHeader title="Support" subtitle="Customer tickets — what needs a reply first, most urgent and oldest on top"
        action={<Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" />}>New ticket</Button>} />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex overflow-hidden rounded-md border border-border text-sm" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.key} role="tab" aria-selected={view.key === v.key} onClick={() => setParams(v.key === 'active' ? {} : { view: v.key }, { replace: true })}
                className={cn('px-3 py-2', view.key === v.key ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-surface-muted')}>{v.label}</button>
            ))}
          </div>
          <div className="w-72"><Input aria-label="Search tickets" placeholder="Subject words or PNR" leftIcon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </CardBody>
      </Card>

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? (
        <EmptyState title={view.key === 'active' ? 'No open tickets' : 'No tickets here'} description={q ? 'Nothing matches that search.' : 'Tickets from customers and ones you raise appear here.'} icon={<LifeBuoy className="h-10 w-10" />} />
      ) : <Table columns={columns} rows={rows} onRowClick={(t) => setOpenId(t.id)} />}

      {openId && <TicketModal id={openId} onClose={() => setOpenId(null)} />}
      {creating && <NewTicketModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}

function TicketModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useAuth((s) => s.user?.id);
  const [reply, setReply] = useState('');
  const t = useQuery({ queryKey: ['support-ticket', id], queryFn: () => supportApi.get(id) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['support-ticket', id] }); void qc.invalidateQueries({ queryKey: ['support'] }); };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed');

  const send = useMutation({ mutationFn: () => supportApi.reply(id, reply.trim()), onSuccess: (r) => { setReply(''); toast.success(r.status === 'pending' ? 'Sent — waiting on the customer' : 'Sent'); refresh(); }, onError: fail });
  const move = useMutation({ mutationFn: (s: TicketStatus) => supportApi.setStatus(id, s), onSuccess: (r) => { toast.success(`Ticket ${STATUS[r.status][0].toLowerCase()}`); refresh(); }, onError: fail });
  const update = useMutation({ mutationFn: (p: { priority?: string; assignedTo?: string | null }) => supportApi.update(id, p), onSuccess: () => { toast.success('Ticket updated'); refresh(); }, onError: fail });
  const busy = send.isPending || move.isPending || update.isPending;

  const ticket = t.data?.ticket;
  const closed = ticket?.status === 'closed';
  const tooLong = reply.trim().length > 4000;

  return (
    <Modal open onClose={onClose} size="lg" title={ticket?.subject ?? 'Ticket'}>
      {t.isLoading ? <PageLoader /> : t.isError ? <ErrorState error={t.error} onRetry={t.refetch} /> : ticket && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={STATUS[ticket.status][1]}>{STATUS[ticket.status][0]}</Badge>
            <span className="capitalize text-text-muted">{ticket.category}</span>
            {ticket.pnr && ticket.bookingId && <Link className="font-mono text-primary hover:underline" to={`/bookings/${ticket.pnr}`}>{ticket.pnr}</Link>}
            {ticket.customerName && <span className="text-text-muted">· {ticket.customerName}{ticket.customerPhone ? ` · ${ticket.customerPhone}` : ''}</span>}
            <span className="ml-auto text-xs text-text-muted">Opened {formatDateTime(ticket.createdAt)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Priority" value={ticket.priority} disabled={closed || busy} onChange={(e) => update.mutate({ priority: e.target.value })} options={PRIORITIES} />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text">Assigned to</span>
              <div className="flex items-center gap-2">
                <span className="text-sm">{ticket.assignedName ?? 'Nobody'}</span>
                {!closed && ticket.assignedTo !== me && <Button size="sm" variant="outline" leftIcon={<UserCheck className="h-4 w-4" />} disabled={busy} onClick={() => update.mutate({ assignedTo: me ?? null })}>Assign to me</Button>}
                {!closed && ticket.assignedTo && <Button size="sm" variant="ghost" leftIcon={<UserMinus className="h-4 w-4" />} disabled={busy} onClick={() => update.mutate({ assignedTo: null })}>Unassign</Button>}
              </div>
            </div>
          </div>

          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
            {t.data!.messages.map((m) => (
              <div key={m.id} className={cn('max-w-[85%] rounded-md p-2 text-sm', m.authorKind === 'agent' ? 'self-end bg-primary/10' : 'self-start bg-surface-muted')}>
                <div className="mb-0.5 text-xs text-text-muted">{m.authorKind === 'agent' ? (m.authorName ?? 'Staff') : (m.authorName ?? 'Customer')} · {formatDateTime(m.createdAt)}</div>
                <p className="whitespace-pre-line text-text">{m.body}</p>
              </div>
            ))}
          </div>

          {closed ? <p className="text-sm text-text-muted">This ticket is closed — the customer can open a new one.</p> : (
            <div className="flex flex-col gap-2">
              <textarea aria-label="Reply" className="min-h-24 rounded-md border border-border bg-surface p-2 text-sm" placeholder="Write a reply to the customer…" value={reply} onChange={(e) => setReply(e.target.value)} aria-invalid={tooLong} />
              {tooLong && <span className="text-xs text-danger" role="alert">At most 4000 characters</span>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  {ticket.status !== 'resolved' && <Button size="sm" variant="outline" disabled={busy} onClick={() => move.mutate('resolved')}>Mark resolved</Button>}
                  {ticket.status === 'resolved' && <Button size="sm" variant="outline" disabled={busy} onClick={() => move.mutate('open')}>Reopen</Button>}
                  <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => move.mutate('closed')}>Close</Button>
                </div>
                <Button leftIcon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!reply.trim() || tooLong || busy} onClick={() => send.mutate()}>Send reply</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState({ subject: '', body: '', category: 'booking', priority: 'normal', pnr: '' });
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (d.subject.trim().length < 3) errors.subject = 'At least 3 characters';
  if (d.body.trim().length < 5) errors.body = 'Describe the problem in a few words';
  const create = useMutation({
    mutationFn: () => supportApi.open({ subject: d.subject.trim(), body: d.body.trim(), category: d.category, priority: d.priority, pnr: d.pnr.trim() || undefined }),
    onSuccess: (r) => { toast.success('Ticket raised and assigned to you'); onCreated(r.ticketId); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create ticket'),
  });
  const server = create.error instanceof ApiError ? create.error : null;
  const err = (k: string) => (tried ? errors[k] : undefined) ?? server?.fieldErrors[k];
  return (
    <Modal open onClose={onClose} title="Raise a ticket for a caller" size="lg"
      footer={<><Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending || (tried && Object.keys(errors).length > 0)} onClick={() => { setTried(true); if (!Object.keys(errors).length) create.mutate(); }}>Raise ticket</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Input label="PNR (optional)" placeholder="e.g. TKT8X92QF" value={d.pnr} onChange={(e) => setD({ ...d, pnr: e.target.value.toUpperCase() })} error={server?.status === 404 ? 'No booking with this PNR' : undefined} />
          <Select label="Category" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} options={CATEGORIES} />
          <Select label="Priority" value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value })} options={PRIORITIES} />
        </div>
        <Input label="Subject" maxLength={160} value={d.subject} error={err('subject')} onChange={(e) => setD({ ...d, subject: e.target.value })} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-text">What the customer said</span>
          <textarea className="min-h-28 rounded-md border border-border bg-surface p-2" maxLength={4000} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} aria-invalid={!!err('body')} />
          {err('body') && <span className="text-xs text-danger" role="alert">{err('body')}</span>}
        </label>
        <p className="text-xs text-text-muted">With a PNR the ticket belongs to that booking’s customer, who sees it in their account.</p>
      </div>
    </Modal>
  );
}
