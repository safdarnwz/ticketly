import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareWarning } from 'lucide-react';

import { Badge, Button, EmptyState, ErrorState, Input, PageLoader, Select, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { agentsApi, type AgentComplaint, type ComplaintCategory } from '@/lib/api/agents';
import { formatDateTime, idempotencyKey } from '@/lib/utils';

const CATEGORY: Record<ComplaintCategory, string> = {
  overcharging: 'Overcharging a passenger',
  wrong_booking: 'Wrong booking',
  misbehaviour: 'Misbehaviour',
  fraud: 'Suspected fraud',
  other: 'Other',
};
const STATUS: Record<AgentComplaint['status'], ['warning' | 'danger' | 'neutral', string]> = {
  open: ['warning', 'Open'],
  upheld: ['danger', 'Upheld'],
  dismissed: ['neutral', 'Dismissed'],
};

/** Formal complaints against one agent: raise one (optionally about a booking they sold), then uphold or dismiss it. */
export function AgentComplaints({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['agent-complaints', agentId], queryFn: () => agentsApi.complaints(agentId) });
  const [raising, setRaising] = useState(false);
  const [f, setF] = useState({ category: 'overcharging' as ComplaintCategory, description: '', pnr: '' });
  const [key, setKey] = useState(() => idempotencyKey('complaint'));
  const [tried, setTried] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['agent-complaints', agentId] });
  const errors: Record<string, string> = {};
  if (f.description.trim().length < 10) errors.description = 'Say what happened (at least 10 characters)';
  if (f.pnr && f.pnr.trim().length < 4) errors.pnr = 'At least 4 characters';
  const raise = useMutation({
    mutationFn: () => agentsApi.raiseComplaint(agentId, { category: f.category, description: f.description.trim(), pnr: f.pnr.trim() || undefined }, key),
    onSuccess: () => { toast.success('Complaint recorded'); setRaising(false); setTried(false); setF({ category: 'overcharging', description: '', pnr: '' }); setKey(idempotencyKey('complaint')); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not record it'),
  });
  const server = raise.error instanceof ApiError ? raise.error : null;
  const pnrError = (tried ? errors.pnr : undefined) ?? (server?.status === 404 ? 'No booking with this PNR' : server?.status === 422 ? server.message : undefined);
  const items = q.data?.items ?? [];
  const open = items.filter((c) => c.status === 'open').length;
  const upheld = items.filter((c) => c.status === 'upheld').length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-muted">{items.length ? `${items.length} on record · ${open} open · ${upheld} upheld` : 'A record of formal complaints — repeat problems show here when deciding on suspension.'}</span>
        {!raising && <Button size="sm" variant="outline" leftIcon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => setRaising(true)}>Raise a complaint</Button>}
      </div>
      {raising && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <Select label="What kind" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ComplaintCategory })} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
            <Input label="PNR (optional)" placeholder="A booking this agent sold" value={f.pnr} maxLength={20} onChange={(e) => { setF({ ...f, pnr: e.target.value.toUpperCase() }); raise.reset(); }} error={pnrError} />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-text">What happened</span>
            <textarea className="min-h-20 rounded-md border border-border bg-surface p-2" maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-invalid={tried && !!errors.description} />
            {tried && errors.description && <span className="text-xs text-danger" role="alert">{errors.description}</span>}
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={raise.isPending} onClick={() => { setRaising(false); setTried(false); raise.reset(); }}>Cancel</Button>
            <Button size="sm" loading={raise.isPending} disabled={raise.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) raise.mutate(); }}>Record complaint</Button>
          </div>
        </div>
      )}
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? <EmptyState title="No complaints against this agent" /> : (
        <ul className="flex flex-col gap-2">{items.map((c) => <ComplaintRow key={c.id} agentId={agentId} c={c} onDone={refresh} />)}</ul>
      )}
    </div>
  );
}

function ComplaintRow({ agentId, c, onDone }: { agentId: string; c: AgentComplaint; onDone: () => void }) {
  const toast = useToast();
  const [deciding, setDeciding] = useState(false);
  const [resolution, setResolution] = useState('');
  const decide = useMutation({
    mutationFn: (outcome: 'upheld' | 'dismissed') => agentsApi.decideComplaint(agentId, c.id, outcome, resolution.trim(), idempotencyKey('decide')),
    onSuccess: (_r, outcome) => { toast.success(outcome === 'upheld' ? 'Complaint upheld' : 'Complaint dismissed'); setDeciding(false); onDone(); },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Could not save'); onDone(); },
  });
  const short = resolution.trim().length < 5;
  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>
        <span className="font-medium text-text">{CATEGORY[c.category]}</span>
        {c.pnr && <Link className="font-mono text-primary hover:underline" to={`/bookings/${c.pnr}`}>{c.pnr}</Link>}
        <span className="ml-auto text-xs text-text-muted">{formatDateTime(c.createdAt)}{c.raisedByName ? ` · ${c.raisedByName}` : ''}</span>
      </div>
      <p className="mt-1 whitespace-pre-line text-text">{c.description}</p>
      {c.status !== 'open' && c.resolution && <p className="mt-1 text-text-muted">Decision: {c.resolution}{c.resolvedByName ? ` — ${c.resolvedByName}` : ''}{c.resolvedAt ? `, ${formatDateTime(c.resolvedAt)}` : ''}</p>}
      {c.status === 'open' && (deciding ? (
        <div className="mt-2 flex flex-col gap-2">
          <Input label="What was decided" value={resolution} maxLength={2000} onChange={(e) => setResolution(e.target.value)} error={resolution && short ? 'Say what was decided' : undefined} placeholder="e.g. Warned in writing; fare difference refunded" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => setDeciding(false)}>Cancel</Button>
            <Button size="sm" variant="outline" loading={decide.isPending && decide.variables === 'dismissed'} disabled={short || decide.isPending} onClick={() => decide.mutate('dismissed')}>Dismiss</Button>
            <Button size="sm" variant="danger" loading={decide.isPending && decide.variables === 'upheld'} disabled={short || decide.isPending} onClick={() => decide.mutate('upheld')}>Uphold</Button>
          </div>
        </div>
      ) : <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={() => setDeciding(true)}>Decide…</Button></div>)}
    </li>
  );
}
