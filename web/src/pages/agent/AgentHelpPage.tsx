import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LifeBuoy, Phone, Scale, Send } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, PageLoader, Select, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { agentPortalApi } from '@/lib/api/agentPortal';
import { supportApi, type TicketStatus } from '@/lib/api/content';
import { cn, formatDateTime } from '@/lib/utils';

const KINDS = [
  { value: 'technical', label: 'Technical problem (portal / booking)', subject: 'Technical problem' },
  { value: 'booking', label: 'Complaint about the bus or service', subject: 'Complaint' },
  { value: 'general', label: 'Feedback from a passenger', subject: 'Passenger feedback' },
  { value: 'payment', label: 'Money / commission question', subject: 'Account question' },
];
const STATUS: Record<TicketStatus, ['warning' | 'info' | 'success' | 'neutral', string]> = {
  open: ['warning', 'With the operator'], pending: ['info', 'Waiting on you'], resolved: ['success', 'Resolved'], closed: ['neutral', 'Closed'],
};

/** Operator contacts, terms, password, and the agent's own support requests. */
export function AgentHelpPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ['agent-me'], queryFn: agentPortalApi.me });
  const tickets = useQuery({ queryKey: ['agent-tickets'], queryFn: () => supportApi.list({}) });
  const [f, setF] = useState({ category: 'technical', subject: '', body: '', pnr: '' });
  const [tried, setTried] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const errors: Record<string, string> = {};
  if (f.subject.trim().length < 3) errors.subject = 'At least 3 characters';
  if (f.body.trim().length < 5) errors.body = 'Describe it in a few words';
  const raise = useMutation({
    mutationFn: () => supportApi.open({ subject: f.subject.trim(), body: f.body.trim(), category: f.category, pnr: f.pnr.trim().toUpperCase() || undefined }),
    onSuccess: () => { toast.success('Sent to the operator — replies appear below'); setF({ category: 'technical', subject: '', body: '', pnr: '' }); setTried(false); void qc.invalidateQueries({ queryKey: ['agent-tickets'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not send'),
  });
  const op = me.data?.operator;
  return (
    <>
      <PageHeader title="Help & support" subtitle="Reach your operator, raise a request, and your account settings" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Your operator" />
          <CardBody className="flex flex-col gap-2 text-sm">
            {me.isLoading ? <PageLoader /> : me.isError ? <ErrorState error={me.error} onRetry={me.refetch} /> : (
              <>
                <div className="font-medium text-text">{op?.name}</div>
                {op?.phone ? <a className="flex items-center gap-1 text-primary" href={`tel:${op.phone}`}><Phone className="h-4 w-4" /> {op.phone}</a> : <span className="text-text-muted">No phone on file</span>}
                {op?.email && <a className="text-primary" href={`mailto:${op.email}`}>{op.email}</a>}
              </>
            )}
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-1 flex items-center gap-1 font-medium text-text"><Scale className="h-4 w-4" /> Terms</div>
              <ul className="flex flex-col gap-1">
                <li><Link className="text-primary hover:underline" to="/legal/terms">Terms of service</Link></li>
                <li><Link className="text-primary hover:underline" to="/legal/refund-policy">Cancellation & refund policy</Link></li>
                <li><Link className="text-primary hover:underline" to="/legal/privacy">Privacy policy</Link></li>
              </ul>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <Link className="flex items-center gap-1 text-primary hover:underline" to="/me"><KeyRound className="h-4 w-4" /> Change my password</Link>
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Raise a request" subtitle="A technical problem, a complaint about a bus, or feedback from a passenger" />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="What is it about" value={f.category} onChange={(e) => { const k = KINDS.find((x) => x.value === e.target.value)!; setF((x) => ({ ...x, category: k.value, subject: x.subject || k.subject })); }} options={KINDS} />
              <Input label="PNR (optional)" value={f.pnr} maxLength={20} onChange={(e) => setF({ ...f, pnr: e.target.value.toUpperCase() })} error={raise.error && (raise.error as { status?: number }).status === 404 ? 'None of your bookings has this PNR' : undefined} />
            </div>
            <Input label="Subject" value={f.subject} maxLength={160} onChange={(e) => setF({ ...f, subject: e.target.value })} error={tried ? errors.subject : undefined} />
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Details</span>
              <textarea className="min-h-24 rounded-md border border-border bg-surface p-2" maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-invalid={tried && !!errors.body} />
              {tried && errors.body && <span className="text-xs text-danger" role="alert">{errors.body}</span>}
            </label>
            <div className="flex justify-end"><Button leftIcon={<Send className="h-4 w-4" />} loading={raise.isPending} disabled={raise.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) raise.mutate(); }}>Send</Button></div>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="My requests" />
        <CardBody>
          {tickets.isLoading ? <PageLoader /> : tickets.isError ? <ErrorState error={tickets.error} onRetry={tickets.refetch} /> : !tickets.data?.tickets.length ? <EmptyState title="No requests yet" icon={<LifeBuoy className="h-10 w-10" />} /> : (
            <ul className="divide-y divide-border text-sm">
              {tickets.data.tickets.map((t) => (
                <li key={t.id}><button type="button" onClick={() => setOpenId(t.id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-surface-muted">
                  <span><span className="text-text">{t.subject}</span> <span className="text-xs capitalize text-text-muted">· {t.category}{t.pnr ? ` · ${t.pnr}` : ''} · {formatDateTime(t.createdAt)}</span></span>
                  <Badge tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Badge>
                </button></li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {openId && <TicketThread id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function TicketThread({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const t = useQuery({ queryKey: ['support-ticket', id], queryFn: () => supportApi.get(id) });
  const send = useMutation({
    mutationFn: () => supportApi.reply(id, reply.trim()),
    onSuccess: () => { setReply(''); void qc.invalidateQueries({ queryKey: ['support-ticket', id] }); void qc.invalidateQueries({ queryKey: ['agent-tickets'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const closed = t.data?.ticket.status === 'closed';
  return (
    <Modal open onClose={onClose} size="lg" title={t.data?.ticket.subject ?? 'Request'}>
      {t.isLoading ? <PageLoader /> : t.isError ? <ErrorState error={t.error} onRetry={t.refetch} /> : (
        <div className="flex flex-col gap-3">
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
            {t.data!.messages.map((m) => (
              <div key={m.id} className={cn('max-w-[85%] rounded-md p-2 text-sm', m.authorKind === 'customer' ? 'self-end bg-primary/10' : 'self-start bg-surface-muted')}>
                <div className="mb-0.5 text-xs text-text-muted">{m.authorKind === 'customer' ? 'You' : (m.authorName ?? 'Operator')} · {formatDateTime(m.createdAt)}</div>
                <p className="whitespace-pre-line text-text">{m.body}</p>
              </div>
            ))}
          </div>
          {closed ? <p className="text-sm text-text-muted">This request is closed — raise a new one if you need more help.</p> : (
            <div className="flex gap-2">
              <textarea aria-label="Reply" className="min-h-16 flex-1 rounded-md border border-border bg-surface p-2 text-sm" maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
              <Button loading={send.isPending} disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>Send</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
