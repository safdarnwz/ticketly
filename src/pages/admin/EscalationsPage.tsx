import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, Send } from 'lucide-react';

import { Badge, Button, EmptyState, ErrorState, Modal, PageLoader, Table, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { escalationsApi, type Escalation, type EscalationStatus } from '@/lib/api/content';
import { cn, formatDateTime } from '@/lib/utils';

const VIEWS: { key: EscalationStatus | 'active'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'open', label: 'Waiting on us' },
  { key: 'answered', label: 'Answered' },
  { key: 'closed', label: 'Closed' },
];
const TONE: Record<EscalationStatus, ['warning' | 'info' | 'neutral', string]> = {
  open: ['warning', 'Waiting on us'],
  answered: ['info', 'Answered'],
  closed: ['neutral', 'Closed'],
};
const PRIORITY_TONE = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' } as const;

function age(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}

/** The platform's support desk: tickets operators could not solve and handed to us. */
export function EscalationsPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.key === params.get('view')) ?? VIEWS[0];
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['escalations', view.key], queryFn: () => escalationsApi.list(view.key), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const rows = list.data?.items ?? [];
  const columns: Column<Escalation>[] = [
    { key: 'op', header: 'Operator', render: (e) => <span className="font-medium text-text">{e.operatorName}</span> },
    { key: 'subject', header: 'Ticket', render: (e) => <div><div className="text-text">{e.subject}</div><div className="text-xs capitalize text-text-muted">{e.category}{e.pnr ? <> · <span className="font-mono normal-case">{e.pnr}</span></> : ''}{e.escalatedByName ? ` · by ${e.escalatedByName}` : ''}</div></div> },
    { key: 'priority', header: 'Priority', render: (e) => <Badge tone={PRIORITY_TONE[e.priority]}>{e.priority}</Badge> },
    { key: 'state', header: 'State', render: (e) => <Badge tone={TONE[e.escalationStatus][0]}>{TONE[e.escalationStatus][1]}</Badge> },
    { key: 'age', header: 'Escalated', render: (e) => <span className="text-xs text-text-muted" title={formatDateTime(e.escalatedAt)}>{age(e.escalatedAt)} ago{e.lastAuthor === 'escalation' && e.escalationStatus === 'open' ? ' · operator wrote last' : ''}</span> },
  ];
  return (
    <>
      <PageHeader title="Support escalations" subtitle="Problems operators could not solve themselves — waiting on us first, most urgent and oldest on top" />
      <div className="mb-4 flex overflow-hidden rounded-md border border-border text-sm" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={view.key === v.key} onClick={() => setParams(v.key === 'active' ? {} : { view: v.key }, { replace: true })}
            className={cn('px-3 py-2', view.key === v.key ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-surface-muted')}>{v.label}</button>
        ))}
      </div>
      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? (
        <EmptyState title={view.key === 'closed' ? 'Nothing closed yet' : 'No operator is waiting on us'} icon={<LifeBuoy className="h-10 w-10" />} />
      ) : <Table columns={columns} rows={rows} onRowClick={(e) => setOpenId(e.id)} />}
      {openId && <EscalationModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function EscalationModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const q = useQuery({ queryKey: ['escalation', id], queryFn: () => escalationsApi.get(id) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['escalation', id] }); void qc.invalidateQueries({ queryKey: ['escalations'] }); };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed');
  const send = useMutation({ mutationFn: () => escalationsApi.reply(id, reply.trim()), onSuccess: () => { setReply(''); toast.success('Sent — the operator sees it on the ticket'); refresh(); }, onError: fail });
  const close = useMutation({ mutationFn: () => escalationsApi.close(id), onSuccess: () => { toast.success('Escalation closed'); refresh(); }, onError: fail });
  const busy = send.isPending || close.isPending;
  const t = q.data?.ticket;
  const closed = t?.escalationStatus === 'closed';
  const tooLong = reply.trim().length > 4000;
  return (
    <Modal open onClose={onClose} size="lg" title={t ? `${t.operatorName} — ${t.subject}` : 'Escalation'}>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : t && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={TONE[t.escalationStatus][0]}>{TONE[t.escalationStatus][1]}</Badge>
            <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
            <span className="capitalize text-text-muted">{t.category}</span>
            {t.pnr && <span className="font-mono text-text-muted">{t.pnr}</span>}
            <span className="ml-auto text-xs text-text-muted">Escalated {formatDateTime(t.escalatedAt)}{t.escalatedByName ? ` by ${t.escalatedByName}` : ''}</span>
          </div>
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
            {q.data!.messages.map((m) => {
              const ours = m.authorKind === 'platform';
              const note = m.authorKind === 'escalation';
              return (
                <div key={m.id} className={cn('max-w-[85%] rounded-md p-2 text-sm', ours ? 'self-end border border-info/40 bg-info/10' : note ? 'self-start border border-warning/40 bg-warning/10' : 'self-start bg-surface-muted opacity-80')}>
                  <div className="mb-0.5 text-xs text-text-muted">
                    {ours ? `Ticketly support${m.authorName ? ` (${m.authorName})` : ''}` : note ? `${m.authorName ?? 'Operator staff'} → us` : m.authorKind === 'customer' ? 'Customer (to the operator)' : `${m.authorName ?? 'Operator staff'} (to the customer)`} · {formatDateTime(m.createdAt)}
                  </div>
                  <p className="whitespace-pre-line text-text">{m.body}</p>
                </div>
              );
            })}
          </div>
          {closed ? <p className="text-sm text-text-muted">Closed — if it comes back, the operator escalates it again.</p> : (
            <div className="flex flex-col gap-2">
              <textarea aria-label="Answer the operator" className="min-h-24 rounded-md border border-border bg-surface p-2 text-sm" placeholder="Answer the operator (the customer does not see this)…" value={reply} onChange={(e) => setReply(e.target.value)} aria-invalid={tooLong} />
              {tooLong && <span className="text-xs text-danger" role="alert">At most 4000 characters</span>}
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="ghost" disabled={busy} loading={close.isPending} onClick={() => { if (window.confirm('Close this escalation? The operator can escalate again.')) close.mutate(); }}>Close escalation</Button>
                <Button leftIcon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!reply.trim() || tooLong || busy} onClick={() => send.mutate()}>Send answer</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
