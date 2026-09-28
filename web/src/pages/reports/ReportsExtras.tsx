import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, type Column, useToast } from '@/components/ui';
import { reportsApi, type ForecastRow, type PnlRow } from '@/lib/api/reports';
import { cn, dayDiff, downloadCsv, formatDateLabel, formatDateTime, formatMoney, minutesToHm } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const money = (m: number | null | undefined) => (m == null ? '—' : formatMoney(Number(m), 'INR'));
const PNL_MAX_DAYS = 92;

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <Card><CardBody>
      <div className="text-xs text-text-muted">{label}</div>
      <div className={cn('text-xl font-semibold', tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-text')}>{value}</div>
    </CardBody></Card>
  );
}

/** Profit & loss: sales less GST, commission and trip expenses — by route, bus or trip, worst first. */
export function PnlTab({ from, to }: { from: string; to: string }) {
  const [groupBy, setGroupBy] = useState<'route' | 'vehicle' | 'trip'>('route');
  const tooLong = dayDiff(`${from}T00:00:00Z`, `${to}T00:00:00Z`) + 1 > PNL_MAX_DAYS;
  const q = useQuery({ queryKey: ['report-pnl', from, to, groupBy], queryFn: () => reportsApi.pnl(from, to, groupBy), enabled: !tooLong, placeholderData: keepPreviousData });
  const items = q.data?.items ?? [];
  const total = items.reduce((s, r) => ({ sales: s.sales + Number(r.salesMinor), net: s.net + Number(r.netRevenueMinor), cost: s.cost + Number(r.expensesMinor), profit: s.profit + Number(r.profitMinor) }), { sales: 0, net: 0, cost: 0, profit: 0 });
  const columns: Column<PnlRow>[] = [
    { key: 'label', header: groupBy === 'route' ? 'Route' : groupBy === 'vehicle' ? 'Bus' : 'Trip', render: (r) => <span className="font-medium text-text">{r.label}</span> },
    { key: 'trips', header: 'Trips', look: 'count', render: (r) => r.trips },
    { key: 'occ', header: 'Occupancy', look: 'count', under: 'trips', render: (r) => `${r.occupancyPct}% · ${r.seatsSold}/${r.seatsTotal}` },
    { key: 'sales', header: 'Sales', look: 'figure', render: (r) => money(r.salesMinor) },
    { key: 'net', header: 'Net revenue', look: 'figure', render: (r) => <span title="After GST and agent commission">{money(r.netRevenueMinor)}</span> },
    { key: 'cost', header: 'Expenses', look: 'figure', under: 'sales', render: (r) => money(r.expensesMinor) },
    { key: 'profit', header: 'Profit', look: 'figure', render: (r) => <span className={Number(r.profitMinor) < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>{money(r.profitMinor)}</span> },
    { key: 'margin', header: 'Margin', look: 'count', under: 'profit', render: (r) => (r.marginPct == null ? '—' : `${r.marginPct}%`) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} options={[{ label: 'Route', value: 'route' }, { label: 'Bus', value: 'vehicle' }, { label: 'Trip', value: 'trip' }]} />
        <p className="text-xs text-text-muted">Expenses come from each trip's Expenses & P&L on the trip chart.</p>
      </div>
      {tooLong ? <EmptyState title={`Pick at most ${PNL_MAX_DAYS} days`} description="Profit & loss is worked out trip by trip, so the period is limited to a quarter." /> :
        q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Sales" value={money(total.sales)} />
              <Stat label="Net revenue" value={money(total.net)} />
              <Stat label="Expenses" value={money(total.cost)} />
              <Stat label="Profit" value={money(total.profit)} tone={total.profit < 0 ? 'danger' : 'success'} />
            </div>
            {items.length ? <Table columns={columns} rows={items} /> : <EmptyState title="No trips in this period" />}
          </>
        )}
    </div>
  );
}

/** On-time running, delays, bus use and crew attendance for the period. */
export function DispatchTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['report-dispatch', from, to], queryFn: () => reportsApi.dispatch(from, to), placeholderData: keepPreviousData });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { summary, delayed, buses, crew } = q.data;
  const idle = buses.filter((b) => b.trips === 0);
  /** One sheet (opens in Excel): the summary, then late departures, buses and crew. */
  const exportCsv = () => {
    const rows: unknown[][] = [
      [`Dispatch report ${from} to ${to}`], [],
      ['Trips run', 'Cancelled', 'On time %', 'Average late start (min)'],
      [summary.tripsRun, summary.tripsCancelled, summary.onTimePct ?? '', summary.avgDepartureDelayMin ?? ''], [],
      ['Late departures'], ['Route', 'Scheduled', 'Left at', 'Late by (min)'],
      ...delayed.map((d) => [d.routeName, formatDateTime(d.scheduled), formatDateTime(d.actual), d.delayMin]), [],
      ['Buses'], ['Bus', 'Trips', 'Scheduled hours'], ...buses.map((b) => [b.bus, b.trips, b.scheduledHours ?? 0]), [],
      ['Crew'], ['Name', 'Role', 'Duties', 'Late', 'Absent', 'Driving (min)'], ...crew.map((c) => [c.name, c.role, c.duties, c.late, c.absent, c.drivingMinutes]),
    ];
    downloadCsv(`dispatch-${from}-to-${to}.csv`, rows);
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end"><Button variant="outline" leftIcon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export to Excel (CSV)</Button></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Trips run" value={String(summary.tripsRun)} />
        <Stat label="Cancelled" value={String(summary.tripsCancelled)} tone={summary.tripsCancelled ? 'danger' : undefined} />
        <Stat label="On time (≤ 10 min)" value={summary.onTimePct == null ? '—' : `${summary.onTimePct}%`} tone={summary.onTimePct == null ? undefined : summary.onTimePct < 80 ? 'danger' : 'success'} />
        <Stat label="Average late start" value={summary.avgDepartureDelayMin == null ? '—' : `${summary.avgDepartureDelayMin} min`} />
      </div>
      {summary.tripsRun > 0 && summary.tripsWithActuals < summary.tripsRun && (
        <p className="text-xs text-text-muted">On-time is measured on the {summary.tripsWithActuals} of {summary.tripsRun} trips whose departure was recorded by the crew app.</p>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Late departures</h3>
        {delayed.length === 0 ? <EmptyState title="No trip left more than 10 minutes late" /> : (
          <Table rows={delayed} columns={[
            { key: 'route', header: 'Route', look: 'strong', render: (r) => <Link className="text-primary" to={`/trips/${r.tripId}`}>{r.routeName}</Link> },
            { key: 'sched', header: 'Scheduled', look: 'muted', render: (r) => formatDateTime(r.scheduled) },
            { key: 'actual', header: 'Left at', under: 'sched', render: (r) => formatDateTime(r.actual) },
            { key: 'late', header: 'Late by', render: (r) => <span className="text-danger">{minutesToHm(r.delayMin)}</span> },
          ]} />
        )}
      </section>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-text">Bus use {idle.length > 0 && <span className="font-normal text-warning">· {idle.length} idle</span>}</h3>
          {buses.length === 0 ? <EmptyState title="No buses" /> : <Table rows={buses} columns={[
            { key: 'bus', header: 'Bus', look: 'key', render: (r) => <span className={r.trips === 0 ? 'text-warning' : 'text-text'}>{r.bus}</span> },
            { key: 'trips', header: 'Trips', look: 'count', render: (r) => r.trips },
            { key: 'hours', header: 'Scheduled hours', look: 'count', render: (r) => r.scheduledHours ?? 0 },
          ]} />}
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold text-text">Crew</h3>
          {crew.length === 0 ? <EmptyState title="No crew" /> : <Table rows={crew} columns={[
            { key: 'name', header: 'Name', look: 'strong', render: (r) => <div>{r.name}<div className="text-xs text-text-muted">{r.role}</div></div> },
            { key: 'duties', header: 'Duties', look: 'count', render: (r) => r.duties },
            { key: 'late', header: 'Late', look: 'count', render: (r) => <span className={r.late ? 'text-warning' : ''}>{r.late}</span> },
            { key: 'absent', header: 'Absent', look: 'count', under: 'late', render: (r) => <span className={r.absent ? 'text-danger' : ''}>{r.absent}</span> },
            { key: 'drive', header: 'Driving', look: 'count', under: 'duties', render: (r) => minutesToHm(r.drivingMinutes) },
          ]} />}
        </section>
      </div>
    </div>
  );
}

const CONF_TONE = { high: 'success', medium: 'info', low: 'warning', none: 'neutral' } as const;

/** Where upcoming trips are heading, and the nearly empty ones worth cancelling or merging. */
export function ForecastTab() {
  const [days, setDays] = useState(7);
  const [maxPct, setMaxPct] = useState(30);
  const [deciding, setDeciding] = useState<{ row: ForecastRow; decision: 'accepted' | 'rejected' } | null>(null);
  const forecast = useQuery({ queryKey: ['report-forecast', days], queryFn: () => reportsApi.forecast(days) });
  const suggestDays = Math.min(days, 15);
  const weak = useQuery({ queryKey: ['report-weak', suggestDays, maxPct], queryFn: () => reportsApi.cancelSuggestions(suggestDays, maxPct) });
  const pct = (r: ForecastRow) => (r.forecastPct == null ? <span className="text-text-muted">not enough history</span> : <span className={r.forecastPct < maxPct ? 'text-danger' : 'text-text'}>{r.forecastPct}% ({r.forecastSeats} seats)</span>);
  const base: Column<ForecastRow>[] = [
    { key: 'trip', header: 'Trip', look: 'strong', render: (r) => <Link className="text-primary" to={`/trips/${r.tripId}`}>{r.routeName} · {formatDateLabel(r.journeyDate)}</Link> },
    { key: 'sold', header: 'Sold now', look: 'count', render: (r) => `${r.currentSold} / ${r.totalSeats}` },
    { key: 'fc', header: 'Expected at departure', look: 'count', under: 'sold', render: pct },
    { key: 'conf', header: 'Confidence', render: (r) => <Badge tone={CONF_TONE[r.confidence]}>{r.confidence}</Badge> },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Look ahead" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[3, 7, 14, 30].map((d) => ({ value: String(d), label: `${d} days` }))} />
        <Input label="Weak below (%)" type="number" min={1} max={100} value={maxPct} onChange={(e) => setMaxPct(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="w-28" />
        <p className="text-xs text-text-muted">Forecasts use how earlier trips of the same service filled up at the same days-to-go.</p>
      </div>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Likely to run nearly empty{days > 15 ? ' (next 15 days)' : ''}</h3>
        {weak.isLoading ? <PageLoader /> : weak.isError ? <ErrorState error={weak.error} onRetry={weak.refetch} /> : !weak.data?.items.length ? <EmptyState title="No weak trips" description="Trips you already decided on are not shown again." /> : (
          <Table rows={weak.data.items} columns={[...base, { key: 'act', header: '', render: (r) => (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => setDeciding({ row: r, decision: 'rejected' })}>Keep running</Button>
              <Button size="sm" variant="danger" onClick={() => setDeciding({ row: r, decision: 'accepted' })}>Plan to cancel</Button>
            </div>
          ) }]} />
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">All upcoming trips</h3>
        {forecast.isLoading ? <PageLoader /> : forecast.isError ? <ErrorState error={forecast.error} onRetry={forecast.refetch} /> : !forecast.data?.items.length ? <EmptyState title="No upcoming trips" /> : <Table rows={forecast.data.items} columns={base} />}
      </section>
      {deciding && <DecisionModal row={deciding.row} decision={deciding.decision} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecisionModal({ row, decision, onClose }: { row: ForecastRow; decision: 'accepted' | 'rejected'; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState(false);
  const error = reason.trim().length < 3 ? 'Give a reason (at least 3 characters)' : '';
  const save = useMutation({
    mutationFn: () => reportsApi.decideSuggestion(row.tripId, decision, reason.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-weak'] });
      if (decision === 'accepted') setDone(true);
      else { toast.success('Kept — it will not be suggested again'); onClose(); }
    },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  return (
    <Modal open onClose={onClose} title={decision === 'accepted' ? 'Plan to cancel this trip' : 'Keep this trip running'}
      footer={done ? <><Button variant="ghost" onClick={onClose}>Close</Button><Link to={`/trips/${row.tripId}`}><Button variant="danger">Open trip to cancel</Button></Link></>
        : <><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant={decision === 'accepted' ? 'danger' : 'primary'} loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!error) save.mutate(); }}>Save decision</Button></>}>
      {done ? (
        <p className="text-sm text-text">Decision saved. Cancelling is still a separate step on the trip itself, where passengers are refunded and told — open the trip to do it.</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-text-muted">{row.routeName} · {formatDateLabel(row.journeyDate)} — {row.currentSold} of {row.totalSeats} sold, expected {row.forecastPct ?? '?'}%.</p>
          <label className="flex flex-col gap-1"><span className="font-medium text-text">Reason</span>
            <textarea className="min-h-16 rounded-md border border-border bg-surface p-2" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={decision === 'accepted' ? 'e.g. Merge with the 22:00 bus' : 'e.g. Festival rush expected'} />
            {tried && error && <span role="alert" className="text-xs text-danger">{error}</span>}</label>
        </div>
      )}
    </Modal>
  );
}
