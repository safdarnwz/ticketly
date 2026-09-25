import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Calendar, Pause, Play, X } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Badge, statusTone, Input, Modal, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { promotionsApi, type RoutePromotion } from '@/lib/api/promotions';
import { masterDataApi } from '@/lib/api/masterData';
import { addDaysIso, formatDateLabel, formatMoney, idempotencyKey, localDateOf, todayLocal } from '@/lib/utils';

const STATUS_LABEL: Record<RoutePromotion['status'], string> = {
  pending_payment: 'Pending',
  active: 'Active',
  paused: 'Paused',
  expired: 'Ended',
  cancelled: 'Cancelled',
};

const dateOf = (iso: string) => formatDateLabel(localDateOf(iso), { day: '2-digit', month: 'short', year: 'numeric' });
/** A promotion runs to the end of its last day; `endsAt` is the midnight after it. */
const lastDayOf = (iso: string) => dateOf(new Date(Date.parse(iso) - 1).toISOString());

/**
 * Operator self-service: pick your own published routes and dates, see the
 * exact price (the server's quote — the same computation the purchase charges),
 * and it rides your next settlement. The super admin only sets the rate card.
 */
export function PromotionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayLocal();
  const routes = useQuery({ queryKey: ['routes', 'published'], queryFn: () => masterDataApi.listRoutes('published') });
  const promotions = useQuery({ queryKey: ['my-promotions'], queryFn: () => promotionsApi.list() });

  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDaysIso(today, 6));
  const [autoRenew, setAutoRenew] = useState(false);
  const [cancelling, setCancelling] = useState<RoutePromotion | null>(null);

  const dateError = !startDate || !endDate ? 'Pick both dates' : startDate < today ? 'Start today or later' : endDate < startDate ? 'The end is before the start' : undefined;
  const quote = useQuery({
    queryKey: ['promotion-quote', routeIds.length, startDate, endDate],
    queryFn: () => promotionsApi.quote(routeIds.length, startDate, endDate),
    enabled: routeIds.length > 0 && !dateError,
    placeholderData: keepPreviousData,
  });
  // One key per distinct purchase: a retry of the same one replays, a changed form is a new purchase.
  const purchaseKey = useMemo(() => idempotencyKey('promo'), [routeIds, startDate, endDate, autoRenew]); // eslint-disable-line react-hooks/exhaustive-deps

  const purchase = useMutation({
    mutationFn: () => promotionsApi.purchase({ routeIds, startDate, endDate, autoRenew }, purchaseKey),
    onSuccess: (r) => {
      toast.success(`Promoted — ${formatMoney(r.totalMinor, r.currency)} for ${r.days} day${r.days === 1 ? '' : 's'}, added to your next settlement`);
      setRouteIds([]);
      void qc.invalidateQueries({ queryKey: ['my-promotions'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Purchase failed'),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => promotionsApi.cancel(id),
    onSuccess: (r) => {
      toast.success(r.adjustedMinor > 0 ? `Cancelled — ${formatMoney(r.adjustedMinor, 'INR')} for unused days comes off your settlement` : 'Cancelled');
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: ['my-promotions'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const pause = useMutation({
    mutationFn: (id: string) => promotionsApi.pause(id),
    onSuccess: () => { toast.success('Paused — hidden from search until you resume; no days are lost'); void qc.invalidateQueries({ queryKey: ['my-promotions'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const resume = useMutation({
    mutationFn: (id: string) => promotionsApi.resume(id),
    onSuccess: () => { toast.success('Resumed — the end date moves out by the time it was paused'); void qc.invalidateQueries({ queryKey: ['my-promotions'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const busy = pause.isPending || resume.isPending || cancel.isPending;

  const toggleRoute = (id: string) => setRouteIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  const q = quote.data;
  const canBuy = routeIds.length > 0 && !dateError && !!q && !quote.isFetching && !purchase.isPending;

  return (
    <>
      <PageHeader title="Route Promotions" subtitle='Pay to show a route at the top of search results (the "Prio" badge) — pick your own dates, priced for exactly those days' />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Promote a route" />
          <CardBody className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-sm font-medium text-text">Routes {routeIds.length > 1 && <span className="text-xs text-text-muted">(multi-route rate applies)</span>}</div>
              {routes.isLoading ? <PageLoader /> : routes.isError ? <ErrorState error={routes.error} onRetry={routes.refetch} /> : routes.data?.items.length ? (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                  {routes.data.items.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={routeIds.includes(r.id)} onChange={() => toggleRoute(r.id)} disabled={purchase.isPending} />
                      {r.name} <span className="text-xs text-text-muted">({r.code})</span>
                    </label>
                  ))}
                </div>
              ) : <p className="rounded-md border border-border p-3 text-sm text-text-muted">No published routes yet — publish a route in Routes & Stops before promoting it.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="First day" type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} error={startDate && startDate < today ? 'Start today or later' : undefined} />
              <Input label="Last day" type="date" min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} error={startDate && endDate && endDate < startDate ? 'The end is before the start' : undefined} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> Renew automatically when it ends</label>
            {routeIds.length > 0 && !dateError && (
              <div className="rounded-md bg-surface-muted p-3 text-sm" aria-live="polite">
                {quote.isError ? <p className="text-danger">{quote.error instanceof Error ? quote.error.message : 'Could not price this'}</p> : q ? (
                  <>
                    <div className="flex items-center gap-1.5 text-text-muted"><Calendar className="h-4 w-4" /> {q.days} day{q.days === 1 ? '' : 's'} × {routeIds.length} route{routeIds.length === 1 ? '' : 's'}
                      <span className="text-xs">({[q.breakdown.months && `${q.breakdown.months} month`, q.breakdown.weeks && `${q.breakdown.weeks} week`, q.breakdown.days && `${q.breakdown.days} day`].filter(Boolean).join(' + ')} rate{routeIds.length > 1 ? ', each route' : ''})</span>
                    </div>
                    <div className="mt-1 text-lg font-semibold text-text">{formatMoney(q.totalMinor, q.currency)}</div>
                    <div className="text-xs text-text-muted">Deducted from your next settlement — nothing to pay now.</div>
                  </>
                ) : <PageLoader />}
              </div>
            )}
            <Button onClick={() => purchase.mutate()} loading={purchase.isPending} disabled={!canBuy} leftIcon={<TrendingUp className="h-4 w-4" />}>
              {routeIds.length === 0 ? 'Pick a route to promote' : q && !dateError ? `Promote for ${formatMoney(q.totalMinor, q.currency)}` : 'Promote'}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your promotions" />
          <CardBody>
            {promotions.isLoading ? <PageLoader /> : promotions.isError ? <ErrorState error={promotions.error} onRetry={promotions.refetch} /> :
              (promotions.data?.promotions.length ? (
                <div className="flex flex-col gap-2">
                  {promotions.data.promotions.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-text">{p.routeName ?? 'Route'}</div>
                        <div className="text-xs text-text-muted">{dateOf(p.startsAt)} – {lastDayOf(p.endsAt)} · {formatMoney(p.priceMinor, p.currency)}{p.autoRenew ? ' · renews' : ''}{p.status === 'paused' && p.pausedAt ? ` · paused since ${dateOf(p.pausedAt)}` : ''}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={statusTone(p.status === 'paused' ? 'held' : p.status)}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
                        {p.status === 'active' && (
                          <Button size="sm" variant="ghost" onClick={() => pause.mutate(p.id)} loading={pause.isPending && pause.variables === p.id} disabled={busy} leftIcon={<Pause className="h-3.5 w-3.5" />}>Pause</Button>
                        )}
                        {p.status === 'paused' && (
                          <Button size="sm" variant="outline" onClick={() => resume.mutate(p.id)} loading={resume.isPending && resume.variables === p.id} disabled={busy} leftIcon={<Play className="h-3.5 w-3.5" />}>Resume</Button>
                        )}
                        {(p.status === 'active' || p.status === 'paused' || p.status === 'pending_payment') && (
                          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setCancelling(p)} disabled={busy} leftIcon={<X className="h-3.5 w-3.5" />}>Cancel</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No promotions yet" description="Promote a route to show it at the top of search results." />)}
          </CardBody>
        </Card>
      </div>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title="Cancel this promotion?"
        footer={<><Button variant="ghost" onClick={() => setCancelling(null)} disabled={cancel.isPending}>Keep it</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancelling && cancel.mutate(cancelling.id)}>Cancel promotion</Button></>}>
        <div className="flex flex-col gap-2 text-sm text-text">
          <p><strong>{cancelling?.routeName}</strong>, {cancelling && dateOf(cancelling.startsAt)} – {cancelling && lastDayOf(cancelling.endsAt)}.</p>
          <p className="text-text-muted">It stops showing straight away. Today is charged in full; every full day after today comes off your settlement. This cannot be undone.</p>
        </div>
      </Modal>
    </>
  );
}
