import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Calendar, X, Pause, Play } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Badge, statusTone, Input, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { promotionsApi } from '@/lib/api/promotions';
import { masterDataApi } from '@/lib/api/masterData';
import { formatMoney, formatDateTime } from '@/lib/utils';

/**
 * Entirely operator self-service: pick which of YOUR OWN routes to
 * promote, pick your own start/end dates from a calendar, see the exact
 * price before confirming, and it's charged via your own settlement — no
 * super-admin approval or involvement in any single purchase. Super-admin
 * only sets the underlying rate card (Analytics & Billing -> Settings).
 */
export function PromotionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });
  const promotions = useQuery({ queryKey: ['my-promotions'], queryFn: () => promotionsApi.list() });

  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [autoRenew, setAutoRenew] = useState(false);

  const rates = useQuery({ queryKey: ['promotion-rates-view'], queryFn: promotionsApi.ratesView });

  // Client-side preview only — the SERVER independently recomputes and is
  // the actual source of truth for what gets charged; this is purely so
  // the operator sees a number before confirming, never trusted for billing.
  const previewDays = startDate && endDate && endDate >= startDate
    ? Math.round((new Date(endDate + 'T00:00:00Z').getTime() - new Date(startDate + 'T00:00:00Z').getTime()) / 86_400_000) + 1
    : 0;
  const isMulti = selectedRouteIds.length > 1;
  const dailyRate = rates.data?.rates.find((r) => r.billingCycle === 'daily' && r.isMultiRoute === isMulti);
  const weeklyRate = rates.data?.rates.find((r) => r.billingCycle === 'weekly' && r.isMultiRoute === isMulti);
  const monthlyRate = rates.data?.rates.find((r) => r.billingCycle === 'monthly' && r.isMultiRoute === isMulti);
  const previewTotal = (() => {
    if (!previewDays || !dailyRate || !weeklyRate || !monthlyRate || selectedRouteIds.length === 0) return null;
    let remaining = previewDays;
    const months = Math.floor(remaining / 30); remaining -= months * 30;
    const weeks = Math.floor(remaining / 7); remaining -= weeks * 7;
    const perRoute = months * monthlyRate.priceMinor + weeks * weeklyRate.priceMinor + remaining * dailyRate.priceMinor;
    return perRoute * selectedRouteIds.length;
  })();

  const purchase = useMutation({
    mutationFn: () => promotionsApi.purchase({ routeIds: selectedRouteIds, startDate, endDate, autoRenew }),
    onSuccess: (r) => {
      toast.success(`Promotion active — ${formatMoney(r.totalMinor, r.currency)} for ${r.days} day(s), added to your next settlement`);
      setSelectedRouteIds([]); setStartDate(''); setEndDate('');
      void qc.invalidateQueries({ queryKey: ['my-promotions'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Purchase failed'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => promotionsApi.cancel(id),
    onSuccess: (r) => {
      toast.success(r.adjustedMinor > 0 ? `Cancelled — today charged in full, ${formatMoney(r.adjustedMinor, 'INR')} for unused days taken off your settlement` : 'Cancelled');
      void qc.invalidateQueries({ queryKey: ['my-promotions'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const pause = useMutation({
    mutationFn: (id: string) => promotionsApi.pause(id),
    onSuccess: () => { toast.success('Paused — not shown in search until resumed, no days lost'); void qc.invalidateQueries({ queryKey: ['my-promotions'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const resume = useMutation({
    mutationFn: (id: string) => promotionsApi.resume(id),
    onSuccess: () => { toast.success('Resumed — end date extended by however long it was paused'); void qc.invalidateQueries({ queryKey: ['my-promotions'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const toggleRoute = (id: string) => setSelectedRouteIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Route Promotions" subtitle='Pay to bubble a route to the top of search results (the "Prio" badge) — pick your own dates, priced exactly for the days you choose' />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Promote a route" />
          <CardBody className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-sm font-medium text-text">Routes {selectedRouteIds.length > 1 && <span className="text-xs text-text-muted">(multi-route rate applies)</span>}</div>
              {routes.isLoading ? <PageLoader /> : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                  {(routes.data?.items ?? []).map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selectedRouteIds.includes(r.id)} onChange={() => toggleRoute(r.id)} />
                      {r.name} <span className="text-xs text-text-muted">({r.code})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date" type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <Input label="End date" type="date" min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> Auto-renew when this ends</label>
            {previewDays > 0 && (
              <div className="rounded-md bg-surface-muted p-3 text-sm">
                <div className="flex items-center gap-1.5 text-text-muted"><Calendar className="h-4 w-4" /> {previewDays} day(s) selected</div>
                {previewTotal !== null ? (
                  <div className="mt-1 text-lg font-semibold text-text">{formatMoney(previewTotal, dailyRate?.currency ?? 'INR')}</div>
                ) : <div className="mt-1 text-xs text-warning">Select at least one route to see pricing</div>}
              </div>
            )}
            <Button onClick={() => purchase.mutate()} loading={purchase.isPending}
              disabled={selectedRouteIds.length === 0 || !startDate || !endDate || endDate < startDate}
              leftIcon={<TrendingUp className="h-4 w-4" />}>
              Promote for {previewTotal !== null ? formatMoney(previewTotal, dailyRate?.currency ?? 'INR') : '…'}
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
                    <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                      <div>
                        <div className="font-medium text-text">{formatDateTime(p.startsAt)} → {formatDateTime(p.endsAt)}</div>
                        <div className="text-xs text-text-muted">{formatMoney(p.priceMinor, p.currency)}{p.autoRenew ? ' · auto-renews' : ''}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                        {p.status === 'active' && (
                          <Button size="sm" variant="ghost" onClick={() => pause.mutate(p.id)} loading={pause.isPending} title="Pause — opt out temporarily, no days lost"><Pause className="h-3.5 w-3.5" /></Button>
                        )}
                        {p.status === 'paused' && (
                          <Button size="sm" variant="outline" onClick={() => resume.mutate(p.id)} loading={resume.isPending} title="Resume — opt back in">
                            <Play className="h-3.5 w-3.5" /> Resume
                          </Button>
                        )}
                        {(p.status === 'active' || p.status === 'paused' || p.status === 'pending_payment') && (
                          <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.id)} loading={cancel.isPending} title="Cancel — today is charged in full, only full days after today are taken off your settlement"><X className="h-3.5 w-3.5" /></Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="No promotions yet" description="Promote a route above to get it bubbled to the top of search results." />)}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
