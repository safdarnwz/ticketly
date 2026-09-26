import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Phone, Search, Ticket, Wallet } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, PageLoader } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { agentPortalApi } from '@/lib/api/agentPortal';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const STATUS_TONE = { active: 'success', pending: 'warning', suspended: 'danger', rejected: 'neutral' } as const;

/** The agent's home: what they can spend, a warning before it runs out, and today's sales. */
export function AgentHomePage() {
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['agent-me'], queryFn: agentPortalApi.me, refetchInterval: 60_000 });
  const recent = useQuery({ queryKey: ['agent-bookings', 'recent'], queryFn: () => agentPortalApi.bookings() });
  if (me.isLoading) return <PageLoader />;
  if (me.isError) return <ErrorState error={me.error} onRetry={me.refetch} />;
  const a = me.data!;
  const canSell = a.status === 'active';
  const rows = (recent.data?.items ?? []).slice(0, 6);
  return (
    <>
      <PageHeader title={a.name} subtitle={`Agent ${a.code} · ${a.billingMode === 'prepaid' ? 'Prepaid account' : `Credit account (${formatMoney(a.creditLimitMinor)} limit)`}`}
        action={<Button leftIcon={<Search className="h-4 w-4" />} disabled={!canSell} onClick={() => navigate('/search')}>Book seats</Button>} />

      {!canSell && (
        <div role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-text">
          Your account is <b>{a.status}</b>{a.statusReason ? ` — ${a.statusReason}` : ''}. You cannot book until {a.operator?.name ?? 'the operator'} re-activates it.
        </div>
      )}
      {a.lowBalance && canSell && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
          <span>Low balance — only <b>{formatMoney(a.spendableMinor)}</b> left to sell with. Top up with {a.operator?.name ?? 'the operator'}{a.operator?.phone ? ` (${a.operator.phone})` : ''} so your next booking does not fail.</span>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardBody><div className="flex items-center gap-2 text-xs text-text-muted"><Wallet className="h-4 w-4" /> Balance</div><div className={cn('text-2xl font-semibold', a.balanceMinor < 0 ? 'text-danger' : 'text-text')}>{formatMoney(a.balanceMinor)}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">You can sell up to</div><div className="text-2xl font-semibold text-text">{formatMoney(a.spendableMinor)}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Commission now</div><div className="text-2xl font-semibold text-text">{a.currentCommission.pct}%</div><div className="text-xs text-text-muted">{a.currentCommission.source !== 'flat' ? `slab · ${formatMoney(a.currentCommission.monthSalesMinor)} sold this month` : 'on the net fare'}</div></CardBody></Card>
        <Card><CardBody><div className="text-xs text-text-muted">Account</div><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge></CardBody></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Latest bookings" action={<Link className="text-sm text-primary hover:underline" to="/agent/bookings">All bookings</Link>} />
          <CardBody>
            {recent.isLoading ? <PageLoader /> : recent.isError ? <ErrorState error={recent.error} onRetry={recent.refetch} /> : rows.length === 0 ? (
              <EmptyState title="No bookings yet" description="Search a route and sell your first seat." icon={<Ticket className="h-10 w-10" />} />
            ) : (
              <ul className="divide-y divide-border text-sm">
                {rows.map((b) => (
                  <li key={b.id}><Link to={`/agent/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                    <span><span className="font-mono font-medium text-text">{b.pnr}</span> · {b.routeName} · {formatDateTime(b.departsAt)}</span>
                    <span className="flex items-center gap-2"><Badge tone={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'danger' : 'neutral'}>{b.status}</Badge>{formatMoney(b.totalMinor)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your operator" />
          <CardBody className="flex flex-col gap-1 text-sm">
            <div className="font-medium text-text">{a.operator?.name ?? '—'}</div>
            {a.operator?.phone && <a className="flex items-center gap-1 text-primary" href={`tel:${a.operator.phone}`}><Phone className="h-3.5 w-3.5" /> {a.operator.phone}</a>}
            {a.operator?.email && <a className="text-primary" href={`mailto:${a.operator.email}`}>{a.operator.email}</a>}
            <Link className="mt-2 text-primary hover:underline" to="/agent/help">Help, support & terms</Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
