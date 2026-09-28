import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Ticket } from 'lucide-react';

import { Badge, EmptyState, ErrorState, Input, PageLoader, Table, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { agentPortalApi, type AgentBookingRow } from '@/lib/api/agentPortal';
import { addDaysIso, cn, formatDateTime, formatMoney, todayLocal } from '@/lib/utils';

const PERIODS = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'all', label: 'All', days: 0 },
] as const;

/** The agent's own sales: by period, findable by PNR or the passenger's mobile. */
export function AgentBookingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const period = PERIODS.find((p) => p.key === params.get('period')) ?? PERIODS[3];
  const [q, setQ] = useState('');
  const today = todayLocal();
  const range = period.days ? { from: addDaysIso(today, -(period.days - 1)), to: today } : undefined;
  const list = useQuery({ queryKey: ['agent-bookings', period.key], queryFn: () => agentPortalApi.bookings(range), placeholderData: keepPreviousData });
  const term = q.trim().toUpperCase();
  const digits = q.replace(/\D/g, '');
  const rows = (list.data?.items ?? []).filter((b) => !term || b.pnr.toUpperCase().includes(term) || (digits.length >= 4 && b.contactPhone.replace(/\D/g, '').includes(digits)));
  const sold = rows.filter((b) => b.status === 'confirmed' || b.status === 'completed');
  const cols: Column<AgentBookingRow>[] = [
    { key: 'pnr', header: 'PNR', render: (b) => <span className="font-mono font-medium text-text">{b.pnr}</span> },
    { key: 'trip', header: 'Journey', render: (b) => <div><div className="text-text">{b.routeName}</div><div className="text-xs text-text-muted">{formatDateTime(b.departsAt)}</div></div> },
    { key: 'pax', header: 'Seats', render: (b) => b.seatCount },
    { key: 'mobile', header: 'Passenger mobile', render: (b) => <a className="text-primary" href={`tel:${b.contactPhone}`} onClick={(e) => e.stopPropagation()}>{b.contactPhone}</a> },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'danger' : 'neutral'}>{b.status}</Badge> },
    { key: 'total', header: 'Fare', render: (b) => formatMoney(b.totalMinor, b.currency) },
    { key: 'comm', header: 'Your commission', render: (b) => <span className={cn(Number(b.commissionMinor) > 0 ? 'text-success' : 'text-text-muted')}>{formatMoney(Number(b.commissionMinor), b.currency)}</span> },
  ];
  return (
    <>
      <PageHeader title="My bookings" subtitle="Everything you sold — tap one to change or cancel it" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1 text-sm" role="tablist">
          {PERIODS.map((p) => (
            <button key={p.key} role="tab" aria-selected={period.key === p.key} onClick={() => setParams(p.key === 'all' ? {} : { period: p.key }, { replace: true })}
              className={cn('rounded-md border px-3 py-1.5', period.key === p.key ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text hover:bg-surface-muted')}>{p.label}</button>
          ))}
        </div>
        <div className="w-72"><Input aria-label="Find a booking" placeholder="PNR or passenger mobile" leftIcon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {!list.isLoading && !list.isError && rows.length > 0 && (
        <p className="mb-2 text-sm text-text-muted">{rows.length} booking{rows.length === 1 ? '' : 's'} · {formatMoney(sold.reduce((s, b) => s + b.totalMinor, 0))} sold · {formatMoney(rows.reduce((s, b) => s + Number(b.commissionMinor), 0))} commission</p>
      )}
      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? (
        <EmptyState title={q ? 'Nothing matches' : 'No bookings in this period'} description={q ? 'Check the PNR or the mobile number.' : undefined} icon={<Ticket className="h-10 w-10" />} />
      ) : <Table columns={cols} rows={rows} onRowClick={(b) => navigate(`/agent/bookings/${b.id}`)} />}
    </>
  );
}
