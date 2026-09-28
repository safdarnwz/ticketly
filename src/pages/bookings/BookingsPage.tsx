import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download, Search, X } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Select, Skeleton, Table, statusTone, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { bookingsApi, type StaffBookingFilters, type StaffBookingRow, type StaffBookingStatus } from '@/lib/api/bookings';
import { classifyQuery } from '@/lib/booking-query';
import { agentsApi } from '@/lib/api/agents';
import { branchesApi } from '@/lib/api/branches';
import { addDaysIso, cn, dayDiff, formatMoney, formatTime, todayLocal } from '@/lib/utils';

const MAX_DAYS = 92;
const STATUS_TABS: { value: '' | StaffBookingStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'live', label: 'Paying now' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'completed', label: 'Travelled' },
];
const CHANNELS = [
  { value: '', label: 'All channels' },
  { value: 'direct_web', label: 'Website' },
  { value: 'direct_app', label: 'Mobile app' },
  { value: 'ota', label: 'OTA partner' },
  { value: 'backoffice', label: 'Counter' },
  { value: 'phone', label: 'Phone booking' },
  { value: 'agent', label: 'Travel agent' },
];
const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

const dt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

function toCsv(rows: StaffBookingRow[]): string {
  const head = ['PNR', 'Booked at', 'Status', 'Passenger', 'Seats', 'Journey date', 'Departs', 'From', 'To', 'Channel', 'Mobile', 'Email', 'Amount'];
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    // Guard against spreadsheet formula injection from customer-typed fields.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = rows.map((b) => [
    b.pnr, dt(b.createdAt), b.liveHold ? 'paying now' : b.status, b.leadPassenger, b.seats.join(' '), b.journeyDate,
    formatTime(b.departsAt), b.fromName, b.toName, CHANNEL_LABEL[b.channel] ?? b.channel, b.contactPhone, b.contactEmail,
    ((b.liveHold || b.status === 'expired' ? b.totalMinor : b.paidMinor) / 100).toFixed(2),
  ].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}

/**
 * Every booking of this operator: today's by default, any period (booked or
 * travelling on), by status and channel, or found by PNR / mobile / ticket
 * number across all dates. Filters live in the URL so a view can be shared.
 */
export function BookingsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const q = params.get('q') ?? '';
  const from = params.get('from') ?? today;
  const to = params.get('to') ?? today;
  const basis = (params.get('basis') as 'booked' | 'journey' | null) ?? 'booked';
  const status = (params.get('status') ?? '') as '' | StaffBookingStatus;
  const channel = params.get('channel') ?? '';
  const tripId = params.get('tripId') ?? '';
  const tripLabel = params.get('route') ?? '';
  const agentId = params.get('agent') ?? '';
  const noShow = params.get('noShow') === '1';
  const branchId = params.get('branch') ?? '';
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchesApi.list, staleTime: 60_000 });
  const agents = useQuery({ queryKey: ['agents', 'all'], queryFn: () => agentsApi.list(), enabled: channel === 'agent' || !!agentId, staleTime: 60_000 });
  const [draft, setDraft] = useState(q);
  const [draftError, setDraftError] = useState('');

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  const found = classifyQuery(q);
  const byId = found && 'kind' in found ? found : null;
  const rangeError = byId ? '' : from > to ? "'From' must be on or before 'To'" : dayDiff(from, to) + 1 > MAX_DAYS ? `Choose at most ${MAX_DAYS} days` : '';

  const filters: StaffBookingFilters = byId
    ? { [byId.kind]: byId.value, status: status || undefined }
    : { from, to, dateBasis: basis, status: status || undefined, channel: channel || undefined, tripId: tripId || undefined, agentId: agentId || undefined, noShow: noShow || undefined, branchId: branchId || undefined };

  const list = useInfiniteQuery({
    queryKey: ['staff-bookings', filters],
    queryFn: ({ pageParam }) => bookingsApi.list(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !rangeError,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const totals = useMemo(() => rows.reduce(
    (a, b) => (['confirmed', 'completed'].includes(b.status) ? { n: a.n + 1, seats: a.seats + b.seatCount, amount: a.amount + b.paidMinor } : a),
    { n: 0, seats: 0, amount: 0 },
  ), [rows]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = classifyQuery(draft);
    if (c && 'error' in c) { setDraftError(c.error); return; }
    setDraftError('');
    set({ q: draft.trim() || undefined });
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookings-${byId ? byId.value : `${from}_${to}`}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const columns: Column<StaffBookingRow>[] = [
    {
      key: 'pnr', header: 'PNR', look: 'key', render: (b) => (
        <div>
          <div className="whitespace-nowrap font-mono">{b.pnr}</div>
          <div className="text-xs font-normal text-text-muted">Seat {b.seats.join(', ') || '—'}</div>
        </div>
      ),
    },
    {
      key: 'pax', header: 'Passenger', render: (b) => (
        <div className="min-w-0">
          <div className="font-medium">{b.leadPassenger ?? '—'}{b.seatCount > 1 && <span className="font-normal text-text-muted"> +{b.seatCount - 1}</span>}</div>
          {b.contactPhone && <a className="block whitespace-nowrap text-xs text-primary hover:underline" href={`tel:${b.contactPhone}`} onClick={(e) => e.stopPropagation()}>{b.contactPhone}</a>}
          {b.contactEmail && <div className="text-xs text-text-muted [overflow-wrap:anywhere]">{b.contactEmail}</div>}
        </div>
      ),
    },
    {
      key: 'journey', header: 'Journey', render: (b) => (
        <div className="min-w-0">
          <div>{b.fromName ?? '—'} → {b.toName ?? '—'}</div>
          <div className="text-xs text-text-muted">{b.journeyDate} · {formatTime(b.departsAt)}</div>
        </div>
      ),
    },
    {
      key: 'channel', header: 'Channel', under: 'status', render: (b) => (
        <div>
          <div className="whitespace-nowrap">{CHANNEL_LABEL[b.channel] ?? b.channel}{b.agentName ? <span className="text-text-muted"> · {b.agentName}</span> : null}</div>
          <div className="whitespace-nowrap text-xs text-text-muted">{dt(b.createdAt)}</div>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', look: 'figure', render: (b) => formatMoney(b.liveHold || b.status === 'expired' ? b.totalMinor : b.paidMinor), className: 'text-right whitespace-nowrap' },
    { key: 'status', header: 'Status', render: (b) => <div className="flex flex-col items-start gap-1"><Badge tone={b.liveHold ? 'warning' : statusTone(b.status)}>{b.liveHold ? 'paying now' : b.status === 'completed' ? 'travelled' : b.status}</Badge>{b.noShowSeats?.length ? <Badge tone="danger">no-show: {b.noShowSeats.join(', ')}</Badge> : null}</div> },
  ];

  const anyFilter = q || status || channel || tripId || agentId || noShow || branchId || basis !== 'booked' || from !== today || to !== today;

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="Every booking — find by PNR, mobile or ticket number, or list a period"
        action={<Button variant="outline" leftIcon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>}
      />

      <Card className="mb-4">
        <CardBody className="flex flex-col gap-4">
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Find a booking" placeholder="PNR, 10-digit mobile or ticket number" value={draft} onChange={(e) => { setDraft(e.target.value); setDraftError(''); }} error={draftError} leftIcon={<Search className="h-4 w-4" />} maxLength={20} />
            </div>
            <Button type="submit">Find</Button>
          </form>

          {byId ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              Showing bookings for {byId.kind === 'mobile' ? 'mobile' : byId.kind === 'ticket' ? 'ticket' : 'PNR'} <b className="text-text">{byId.value}</b> on any date.
              <button type="button" className="text-primary hover:underline" onClick={() => { setDraft(''); set({ q: undefined }); }}>Back to the list</button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-3">
              <Select label="Date is" value={basis} onChange={(e) => set({ basis: e.target.value === 'booked' ? undefined : e.target.value })} options={[{ value: 'booked', label: 'Booked on' }, { value: 'journey', label: 'Travelling on' }]} />
              <Input label="From" type="date" value={from} onChange={(e) => set({ from: e.target.value || undefined })} error={rangeError && from > to ? rangeError : undefined} />
              <Input label="To" type="date" value={to} onChange={(e) => set({ to: e.target.value || undefined })} error={rangeError && !(from > to) ? rangeError : undefined} />
              <Select label="Channel" value={channel} onChange={(e) => set({ channel: e.target.value || undefined, agent: e.target.value === 'agent' ? agentId || undefined : undefined })} options={CHANNELS} />
              {(branches.data?.items.length ?? 0) > 0 && (
                <Select label="Branch" value={branchId} onChange={(e) => set({ branch: e.target.value || undefined })}
                  options={[{ value: '', label: 'All branches' }, ...(branches.data?.items ?? []).map((b) => ({ value: b.id, label: `${b.name}${b.code ? ` (${b.code})` : ''}` }))]} />
              )}
              {channel === 'agent' && (
                <Select label="Agent" value={agentId} onChange={(e) => set({ agent: e.target.value || undefined })}
                  options={[{ value: '', label: agents.isLoading ? 'Loading…' : 'All agents' }, ...(agents.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.name}${a.status !== 'active' ? ` (${a.status})` : ''}` }))]} />
              )}
              <div className="col-span-full flex flex-wrap items-end gap-2">
                <Button variant="outline" onClick={() => set({ from: undefined, to: undefined })} disabled={from === today && to === today}>Today</Button>
                <Button variant="outline" onClick={() => set({ from: addDaysIso(today, -6), to: today })}>7 days</Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Status">
            {STATUS_TABS.map((s) => (
              <button key={s.value || 'all'} type="button" role="tab" aria-selected={status === s.value} onClick={() => set({ status: s.value || undefined })}
                className={cn('rounded-full border px-3 py-1 text-sm transition', status === s.value ? 'border-primary bg-primary text-primary-fg' : 'border-border text-text-muted hover:bg-surface-muted')}>
                {s.label}
              </button>
            ))}
            <button type="button" role="switch" aria-checked={noShow} onClick={() => set({ noShow: noShow ? undefined : '1' })}
              className={cn('ml-1 rounded-full border px-3 py-1 text-sm transition', noShow ? 'border-danger bg-danger/10 text-danger' : 'border-border text-text-muted hover:bg-surface-muted')}>No-shows only</button>
            {tripId && !byId && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1 text-sm">
                Bus: {tripLabel || 'selected trip'}
                <button type="button" aria-label="Remove bus filter" onClick={() => set({ tripId: undefined, route: undefined })}><X className="h-3.5 w-3.5" /></button>
              </span>
            )}
            {anyFilter && (
              <button type="button" className="ml-auto text-sm text-primary hover:underline" onClick={() => { setDraft(''); setParams(new URLSearchParams(), { replace: true }); }}>Reset filters</button>
            )}
          </div>
        </CardBody>
      </Card>

      {rangeError ? (
        <EmptyState title="Fix the dates" description={rangeError} />
      ) : list.isLoading ? (
        <Skeleton className="h-72" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : (
        <>
          <div className="mb-2 text-sm text-text-muted">
            {rows.length}{list.hasNextPage ? '+' : ''} booking{rows.length === 1 ? '' : 's'} · {totals.n} paid · {totals.seats} seats · {formatMoney(totals.amount)}
          </div>
          <Table
            columns={columns}
            rows={rows}
            onRowClick={(b) => navigate(`/bookings/${b.pnr}`)}
            empty={byId ? `No booking found for ${byId.value}.` : 'No bookings match these filters.'}
          />
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} disabled={list.isFetchingNextPage}>Load more</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
