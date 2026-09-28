import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Search, ShieldCheck, Users } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Table, statusTone, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { crmApi, type Customer, type CustomerBooking, type CustomerFilter } from '@/lib/api/crm';
import { cn, formatDateLabel, formatDateTime, formatMoney } from '@/lib/utils';

const FILTERS: { key: CustomerFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'frequent', label: 'Frequent (5+ trips)' },
  { key: 'blocked', label: 'Blocked' },
];
const dateOf = (d: string | null) => (d ? formatDateLabel(d, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * Everyone who booked with this operator — signed-in accounts and guests by
 * mobile. Open one for their trips; block someone from booking with you
 * (their existing bookings stay as they are).
 */
export function CustomersPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = q.trim();

  const list = useQuery({
    queryKey: ['customers', query, filter, page],
    queryFn: () => crmApi.list({ q: query || undefined, filter, page }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];

  const columns: Column<Customer>[] = [
    {
      key: 'name', header: 'Customer', render: (c) => (
        <div>
          <div className="flex items-center gap-2 font-medium text-text">{c.name ?? 'Unnamed'}{c.frequent && <Badge tone="success">Frequent</Badge>}{c.blocked && <Badge tone="danger">Blocked</Badge>}</div>
          <div className="text-xs text-text-muted">{c.customerId ? 'Account' : 'Guest'}{c.email ? ` · ${c.email}` : ''}</div>
        </div>
      ),
    },
    { key: 'phone', header: 'Mobile', render: (c) => <span className="font-mono text-sm">{c.phone ?? '—'}</span> },
    { key: 'trips', header: 'Trips', render: (c) => <span>{c.trips}{c.cancelled ? <span className="text-xs text-text-muted"> · {c.cancelled} cancelled</span> : ''}</span> },
    { key: 'spent', header: 'Spent', render: (c) => formatMoney(c.spentMinor, 'INR') },
    { key: 'last', header: 'Last journey', render: (c) => <span className="text-sm text-text-muted">{dateOf(c.lastJourneyDate)}</span> },
  ];

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who booked with you — accounts and guests, their trips and spend" />
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-1 text-sm" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }}
                className={cn('rounded-md border px-3 py-1.5', filter === f.key ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text hover:bg-surface-muted')}>{f.label}</button>
            ))}
          </div>
          <div className="w-80"><Input aria-label="Search customers" placeholder="Name, mobile, email or PNR" leftIcon={<Search className="h-4 w-4" />} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        </CardBody>
      </Card>

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : rows.length === 0 ? (
        <EmptyState title={query ? 'No customer matches' : filter === 'blocked' ? 'Nobody is blocked' : 'No customers yet'} description={query ? 'Try part of the name, 4+ digits of the mobile, the exact email or a PNR.' : 'Customers appear once they book with you.'} icon={<Users className="h-10 w-10" />} />
      ) : (
        <>
          <Table columns={columns} rows={rows} onRowClick={(c) => setOpen(c.key)} />
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1 || list.isFetching} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-text-muted">Page {page}</span>
            <Button variant="outline" size="sm" disabled={!list.data?.hasMore || list.isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </>
      )}

      {open && <CustomerModal customerKey={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function CustomerModal({ customerKey, onClose }: { customerKey: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const c = useQuery({ queryKey: ['customer', customerKey], queryFn: () => crmApi.profile(customerKey) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['customer', customerKey] }); void qc.invalidateQueries({ queryKey: ['customers'] }); };
  const reasonError = reason.trim().length < 5 ? 'Say why, in a few words' : undefined;
  const block = useMutation({
    mutationFn: () => crmApi.block(customerKey, reason.trim()),
    onSuccess: () => { toast.success('Blocked — they cannot book with you any more'); setBlocking(false); setReason(''); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const unblock = useMutation({
    mutationFn: () => crmApi.unblock(customerKey),
    onSuccess: () => { toast.success('Unblocked — they can book again'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const history: Column<CustomerBooking>[] = [
    { key: 'pnr', header: 'PNR', render: (b) => <Link to={`/bookings/${b.pnr}`} className="font-mono text-primary hover:underline">{b.pnr}</Link> },
    { key: 'journey', header: 'Journey', render: (b) => <div className="text-sm"><div>{b.routeName ?? '—'}</div><div className="text-xs text-text-muted">{dateOf(b.journeyDate)} · {b.seatCount} seat{b.seatCount === 1 ? '' : 's'}</div></div> },
    { key: 'amount', header: 'Amount', render: (b) => formatMoney(b.totalMinor, 'INR') },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
    { key: 'booked', header: 'Booked', render: (b) => <span className="text-xs text-text-muted">{formatDateTime(b.createdAt)}</span> },
  ];
  const d = c.data;

  return (
    <Modal open onClose={onClose} size="lg" title={d?.name ?? 'Customer'}>
      {c.isLoading ? <PageLoader /> : c.isError ? <ErrorState error={c.error} onRetry={c.refetch} /> : d && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span className="font-mono text-text">{d.phone ?? '—'}</span>{d.email && <span>· {d.email}</span>}
            <span>· {d.customerId ? 'Account' : 'Guest (by mobile)'}</span>
            {d.frequent && <Badge tone="success">Frequent</Badge>}
            <span className="ml-auto">Customer since {dateOf(d.firstBookedAt.slice(0, 10))}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 rounded-md bg-surface-muted p-3 text-sm">
            <div><div className="text-xs text-text-muted">Trips</div><div className="text-lg font-semibold">{d.trips}</div></div>
            <div><div className="text-xs text-text-muted">Cancelled</div><div className="text-lg font-semibold">{d.cancelled}</div></div>
            <div><div className="text-xs text-text-muted">Spent</div><div className="text-lg font-semibold">{formatMoney(d.spentMinor, 'INR')}</div></div>
            <div><div className="text-xs text-text-muted">Last journey</div><div className="text-lg font-semibold">{dateOf(d.lastJourneyDate)}</div></div>
          </div>

          {d.block ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
              <div>
                <div className="font-semibold text-danger">Blocked from booking with you</div>
                <div className="text-text">{d.block.reason}</div>
                <div className="text-xs text-text-muted">{formatDateTime(d.block.blockedAt)}{d.block.blockedByName ? ` · by ${d.block.blockedByName}` : ''}</div>
              </div>
              <Button size="sm" variant="outline" leftIcon={<ShieldCheck className="h-4 w-4" />} loading={unblock.isPending} onClick={() => unblock.mutate()}>Unblock</Button>
            </div>
          ) : blocking ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <Input label="Why block them?" placeholder="e.g. abused the driver on 12 Sept" maxLength={500} value={reason} error={tried ? reasonError : undefined} onChange={(e) => setReason(e.target.value)} />
              <p className="text-xs text-text-muted">They cannot book with you any more — signed in or with this mobile. Bookings they already have stay as they are. Other operators are not affected.</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setBlocking(false); setTried(false); }}>Cancel</Button>
                <Button variant="danger" size="sm" loading={block.isPending} disabled={block.isPending || (tried && !!reasonError)} onClick={() => { setTried(true); if (!reasonError) block.mutate(); }}>Block</Button>
              </div>
            </div>
          ) : (
            <div><Button size="sm" variant="ghost" className="text-danger" leftIcon={<Ban className="h-4 w-4" />} onClick={() => setBlocking(true)}>Block from booking</Button></div>
          )}

          <div>
            <div className="mb-2 text-sm font-semibold text-text">Bookings ({d.bookings})</div>
            <Table columns={history} rows={d.history} />
          </div>
        </div>
      )}
    </Modal>
  );
}
