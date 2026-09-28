import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, CircleDot, IndianRupee, Mail, MailWarning, RefreshCw, Search, Timer, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Select, Skeleton, Table, statusTone, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { monitoringApi, type FeedStatus, type MonitoredBooking, type OperatorActivity } from '@/lib/api/monitoring';
import { tenantsApi } from '@/lib/api/tenants';
import { APP_TIMEZONE, addDaysIso, cn, dayDiff, formatMoney, todayLocal } from '@/lib/utils';

const MAX_DAYS = 92;
const REFRESH_MS = 15_000;

const STATUS_TABS: { value: FeedStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Paying now' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
  { value: 'completed', label: 'Travelled' },
];
const CHANNELS = [
  { value: '', label: 'All channels' },
  { value: 'direct_web', label: 'Website' },
  { value: 'direct_app', label: 'Mobile app' },
  { value: 'ota', label: 'OTA partner' },
  { value: 'backoffice', label: 'Operator counter' },
];
const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

const dt = (iso: string, withDate = true) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: APP_TIMEZONE,
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

function ago(iso: string | null, now: number): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function useNow(ms = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Stat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardBody className="flex items-start gap-3">
        <div className={cn('rounded-lg bg-surface-muted p-2 text-text-muted', tone)}>{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-text-muted">{label}</div>
          <div className="truncate text-xl font-semibold text-text">{value}</div>
          {hint && <div className="text-xs text-text-muted">{hint}</div>}
        </div>
      </CardBody>
    </Card>
  );
}

function EmailBadge({ label, status }: { label: string; status?: string }) {
  if (!status) return <span className="text-xs text-text-muted" title={`${label}: not sent`}>{label} —</span>;
  const ok = status === 'sent';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', ok ? 'text-success' : status === 'failed' ? 'text-danger' : 'text-warning')} title={`${label}: ${status}`}>
      {ok ? <Mail className="h-3.5 w-3.5" /> : <MailWarning className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

/**
 * Platform view of what every operator is selling: customers paying right now,
 * bookings confirmed and cancelled, gross sold — and, per booking, whether the
 * e-ticket and GST invoice emails went out. Refreshes itself. Contacts arrive
 * masked from the server.
 */
export function LiveBookingsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const from = params.get('from') ?? today;
  const to = params.get('to') ?? today;
  const tenantId = params.get('operator') ?? '';
  const status = (params.get('status') as FeedStatus | null) ?? 'all';
  const channel = params.get('channel') ?? '';
  const pnr = params.get('pnr') ?? '';
  const [pnrDraft, setPnrDraft] = useState(pnr);
  const [pnrError, setPnrError] = useState('');
  const [live, setLive] = useState(true);
  const now = useNow();

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const rangeError =
    from > to ? "'From' must be on or before 'To'" : dayDiff(from, to) + 1 > MAX_DAYS ? `Choose at most ${MAX_DAYS} days` : '';

  const operators = useQuery({ queryKey: ['admin-tenants'], queryFn: tenantsApi.list, staleTime: 60_000 });
  const activity = useQuery({
    queryKey: ['monitoring-activity', from, to],
    queryFn: () => monitoringApi.activity({ from, to }),
    enabled: !rangeError,
    refetchInterval: live ? REFRESH_MS : false,
    placeholderData: keepPreviousData,
  });
  const filters = { from, to, tenantId: tenantId || undefined, status, channel: channel || undefined, pnr: pnr || undefined };
  const feed = useInfiniteQuery({
    queryKey: ['monitoring-feed', filters],
    queryFn: ({ pageParam }) => monitoringApi.feed(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !rangeError,
    placeholderData: keepPreviousData,
  });
  // Auto-refresh only the first page: older pages don't change under you while you read them.
  const pages = feed.data?.pages.length ?? 0;
  const refetchFeed = feed.refetch;
  useEffect(() => {
    if (!live || rangeError || pages > 1) return;
    const t = setInterval(() => void refetchFeed(), REFRESH_MS);
    return () => clearInterval(t);
  }, [live, rangeError, pages, refetchFeed]);

  const rows = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);

  const submitPnr = (e: FormEvent) => {
    e.preventDefault();
    const v = pnrDraft.trim().toUpperCase();
    if (v && !/^[A-Z0-9]{4,12}$/.test(v)) {
      setPnrError('A PNR is 4–12 letters and digits');
      return;
    }
    setPnrError('');
    set({ pnr: v || undefined });
  };

  const opColumns: Column<OperatorActivity>[] = [
    {
      key: 'op', header: 'Operator', render: (o) => (
        <div>
          <div className="font-medium text-text">{o.operatorName}</div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">{o.operatorSlug}{o.operatorStatus !== 'active' && <Badge tone={statusTone(o.operatorStatus)}>{o.operatorStatus}</Badge>}</div>
        </div>
      ),
    },
    {
      key: 'live', header: 'Paying now', render: (o) => o.holdsLive ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-warning"><CircleDot className="h-3.5 w-3.5 animate-pulse" />{o.holdsLive} · {o.seatsOnHold} seats</span>
      ) : <span className="text-text-muted">—</span>,
    },
    { key: 'confirmed', header: 'Confirmed', render: (o) => `${o.confirmed} · ${o.seatsSold} seats`, className: 'whitespace-nowrap' },
    { key: 'gross', header: 'Gross', render: (o) => formatMoney(o.grossMinor), className: 'whitespace-nowrap text-right' },
    { key: 'cancelled', header: 'Cancelled', render: (o) => o.cancelled || '—' },
    { key: 'last', header: 'Last booking', render: (o) => <span className="text-text-muted">{ago(o.lastBookingAt, now)}</span> },
  ];

  const feedColumns: Column<MonitoredBooking>[] = [
    { key: 'at', header: 'Booked', render: (b) => <span className="whitespace-nowrap text-text-muted">{dt(b.createdAt)}</span> },
    { key: 'pnr', header: 'PNR', render: (b) => <span className="font-mono font-semibold">{b.pnr}</span> },
    { key: 'op', header: 'Operator', render: (b) => <button type="button" className="text-left text-primary hover:underline" onClick={() => set({ operator: b.tenantId })}>{b.operatorName}</button> },
    {
      key: 'journey', header: 'Journey', render: (b) => (
        <div className="min-w-40">
          <div>{b.from ?? '—'} → {b.to ?? '—'}</div>
          <div className="text-xs text-text-muted">Departs {dt(b.departsAt)}</div>
        </div>
      ),
    },
    { key: 'seats', header: 'Seats', render: (b) => b.seatCount, className: 'text-center' },
    { key: 'amount', header: 'Amount', render: (b) => <span className="whitespace-nowrap">{formatMoney(b.liveHold || b.status === 'expired' ? b.totalMinor : b.paidMinor, b.currency)}</span>, className: 'text-right' },
    { key: 'channel', header: 'Channel', render: (b) => <span className="whitespace-nowrap text-text-muted">{CHANNEL_LABEL[b.channel] ?? b.channel}{b.soldBy ? ` · ${b.soldBy === 'gds' ? 'GDS' : 'Agent'}` : ''}</span> },
    {
      key: 'status', header: 'Status', render: (b) => b.liveHold ? (
        <span className="inline-flex flex-col">
          <Badge tone="warning">Paying now</Badge>
          {b.holdExpiresAt && <span className="mt-0.5 text-xs text-text-muted">hold ends {Math.max(0, Math.ceil((new Date(b.holdExpiresAt).getTime() - now) / 60000))} min</span>}
        </span>
      ) : <Badge tone={statusTone(b.status)}>{b.status === 'completed' ? 'travelled' : b.status}</Badge>,
    },
    {
      key: 'emails', header: 'Emails', render: (b) => ['confirmed', 'completed', 'cancelled'].includes(b.status) ? (
        <div className="flex flex-col gap-0.5">
          <EmailBadge label="Ticket" status={b.emails.eticket} />
          <EmailBadge label="Invoice" status={b.emails.invoice} />
        </div>
      ) : <span className="text-text-muted">—</span>,
    },
    { key: 'contact', header: 'Contact', render: (b) => <span className="whitespace-nowrap font-mono text-xs text-text-muted">{b.contactPhone ?? '—'}{b.contactEmail ? <><br />{b.contactEmail}</> : null}</span> },
  ];

  const t = activity.data?.totals;
  const operatorOptions = [{ value: '', label: 'All operators' }, ...(operators.data?.items ?? []).map((o) => ({ value: o.id, label: o.displayName }))];
  const operatorName = operators.data?.items.find((o) => o.id === tenantId)?.displayName;

  return (
    <div>
      <PageHeader
        title="Live bookings"
        subtitle="What every operator is selling — customers paying right now, confirmed and cancelled bookings, and whether each ticket and invoice email went out."
        action={
          <Button variant={live ? 'primary' : 'outline'} size="sm" leftIcon={<RefreshCw className={cn('h-4 w-4', live && (feed.isFetching || activity.isFetching) && 'animate-spin')} />} onClick={() => setLive((v) => !v)} aria-pressed={live}>
            {live ? 'Live — updates every 15 s' : 'Paused'}
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="w-40"><Input label="From" type="date" value={from} max={today} onChange={(e) => set({ from: e.target.value || undefined })} error={rangeError && from > to ? rangeError : undefined} /></div>
          <div className="w-40"><Input label="To" type="date" value={to} max={today} onChange={(e) => set({ to: e.target.value || undefined })} error={rangeError && !(from > to) ? rangeError : undefined} /></div>
          <Button variant="outline" onClick={() => set({ from: undefined, to: undefined })} disabled={from === today && to === today}>Today</Button>
          <Button variant="outline" onClick={() => set({ from: addDaysIso(today, -6), to: today })}>Last 7 days</Button>
        </CardBody>
      </Card>

      {rangeError ? null : activity.isError ? (
        <ErrorState error={activity.error} onRetry={activity.refetch} />
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {!t ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20" />) : (
            <>
              <Stat icon={<Timer className="h-5 w-5" />} tone="text-warning" label="Paying now" value={`${t.holdsLive}`} hint={`${t.seatsOnHold} seats · ${formatMoney(t.holdValueMinor)}`} />
              <Stat icon={<CheckCircle2 className="h-5 w-5" />} tone="text-success" label="Confirmed" value={`${t.confirmed}`} hint={`${t.seatsSold} seats`} />
              <Stat icon={<IndianRupee className="h-5 w-5" />} label="Gross sold" value={formatMoney(t.grossMinor)} />
              <Stat icon={<XCircle className="h-5 w-5" />} tone="text-danger" label="Cancelled" value={`${t.cancelled}`} />
              <Stat icon={<Activity className="h-5 w-5" />} label="Operators selling" value={`${t.operatorsActive}`} hint={`of ${operators.data?.items.length ?? '…'}`} />
            </>
          )}
        </div>
      )}

      {!rangeError && (
        <Card className="mb-6">
          <CardHeader title="By operator" subtitle={from === to ? `On ${from}` : `${from} to ${to}`} />
          <CardBody>
            {activity.isLoading ? <Skeleton className="h-32" /> : (
              <Table
                columns={opColumns}
                rows={activity.data?.operators ?? []}
                onRowClick={(o) => set({ operator: o.tenantId })}
                empty="No operator has sold or held a seat in this period."
              />
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={operatorName ? `Bookings — ${operatorName}` : 'Bookings'} subtitle="Newest first" />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {STATUS_TABS.map((s) => (
              <button
                key={s.value}
                type="button"
                role="tab"
                aria-selected={status === s.value}
                onClick={() => set({ status: s.value === 'all' ? undefined : s.value })}
                className={cn('rounded-full border px-3 py-1 text-sm transition', status === s.value ? 'border-primary bg-primary text-primary-fg' : 'border-border text-text-muted hover:bg-surface-muted')}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Select label="Operator" options={operatorOptions} value={tenantId} onChange={(e) => set({ operator: e.target.value || undefined })} disabled={operators.isLoading} />
            <Select label="Channel" options={CHANNELS} value={channel} onChange={(e) => set({ channel: e.target.value || undefined })} />
            <form onSubmit={submitPnr} className="flex items-end gap-2 md:col-span-2">
              <div className="flex-1"><Input label="PNR" value={pnrDraft} onChange={(e) => { setPnrDraft(e.target.value); setPnrError(''); }} placeholder="e.g. P8SJAR" error={pnrError} leftIcon={<Search className="h-4 w-4" />} maxLength={12} /></div>
              <Button type="submit" variant="outline">Find</Button>
              {(pnr || tenantId || channel || status !== 'all') && (
                <Button type="button" variant="ghost" onClick={() => { setPnrDraft(''); set({ pnr: undefined, operator: undefined, channel: undefined, status: undefined }); }}>Clear</Button>
              )}
            </form>
          </div>

          {rangeError ? (
            <EmptyState title="Fix the dates" description={rangeError} />
          ) : feed.isLoading ? (
            <Skeleton className="h-64" />
          ) : feed.isError ? (
            <ErrorState error={feed.error} onRetry={feed.refetch} />
          ) : (
            <>
              <Table columns={feedColumns} rows={rows} empty={pnr ? `No booking with PNR ${pnr} in this period.` : 'No bookings match these filters.'} />
              {feed.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => void feed.fetchNextPage()} loading={feed.isFetchingNextPage} disabled={feed.isFetchingNextPage}>Load more</Button>
                </div>
              )}
              {pages > 1 && live && <p className="text-center text-xs text-text-muted">Showing older pages — auto-refresh is paused until you change a filter.</p>}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

