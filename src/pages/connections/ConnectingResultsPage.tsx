import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock } from 'lucide-react';

import { Button, Card, CardBody, Badge, PageLoader, ErrorState, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { connectionsApi, type ConnectingOption } from '@/lib/api/connections';
import { flowApi } from '@/lib/api/booking-flow';
import { formatMoney } from '@/lib/utils';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function fmtLayover(minutes: number) {
  const h = Math.floor(minutes / 60); const m = minutes % 60;
  return `${h}h ${m > 0 ? `${m}m ` : ''}layover`;
}

export function ConnectingResultsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fromSlug = params.get('from') ?? '';
  const toSlug = params.get('to') ?? '';
  const date = params.get('date') ?? '';

  // Same reasoning as ResultsPage: the URL carries readable city slugs,
  // never a raw UUID — resolve them to the real cities before searching.
  const originLookup = useQuery({ queryKey: ['city-slug', fromSlug], queryFn: () => flowApi.cityBySlug(fromSlug), enabled: Boolean(fromSlug) });
  const destLookup = useQuery({ queryKey: ['city-slug', toSlug], queryFn: () => flowApi.cityBySlug(toSlug), enabled: Boolean(toSlug) });
  const originCityId = originLookup.data?.id;
  const destCityId = destLookup.data?.id;
  const slugsPending = originLookup.isLoading || destLookup.isLoading;
  const slugsFailed = originLookup.isError || destLookup.isError;

  const search = useQuery({
    queryKey: ['connecting-results', originCityId, destCityId, date],
    queryFn: () => connectionsApi.search(originCityId!, destCityId!, date),
    enabled: Boolean(originCityId && destCityId && date),
  });

  const selectOption = (opt: ConnectingOption) => {
    navigate('/connecting/checkout', { state: { option: opt } });
  };

  if (slugsPending) return <div className="mx-auto max-w-3xl px-4 py-6"><PageLoader /></div>;
  if (slugsFailed) return <div className="mx-auto max-w-3xl px-4 py-6"><EmptyState title="City not found" description="This search link looks invalid — try searching again." /></div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader title="Connecting Buses" subtitle="No direct bus found — here are journeys with one change, 2-24 hours apart" />
      {search.isLoading ? <PageLoader /> : search.isError ? <ErrorState error={search.error} onRetry={search.refetch} /> : (
        search.data && search.data.options.length > 0 ? (
          <div className="flex flex-col gap-4">
            {search.data.options.map((opt, idx) => {
              const totalMinor = opt.leg1.baseFareMinor + opt.leg2.baseFareMinor;
              return (
                <Card key={idx} className="hover:border-primary/40">
                  <CardBody className="flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <Badge tone="neutral">Via {opt.connectionCityName}</Badge>
                      <span className="flex items-center gap-1 text-xs text-text-muted"><Clock className="h-3.5 w-3.5" /> {fmtLayover(opt.layoverMinutes)}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[opt.leg1, opt.leg2].map((leg, legIdx) => (
                        <div key={legIdx} className="rounded-lg border border-border p-3">
                          <div className="text-xs font-medium text-text-muted">{leg.operatorName}</div>
                          <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-text">
                            <span>{fmtTime(leg.departsAt)}</span><ArrowRight className="h-3.5 w-3.5 text-text-muted" /><span>{fmtTime(leg.arrivesAt)}</span>
                          </div>
                          <div className="mt-1 text-xs text-text-muted">{leg.fromStopName} → {leg.toStopName}</div>
                          <div className="mt-2 flex items-center justify-between text-xs">
                            <span className="text-text-muted">{leg.availableSeats} seats left</span>
                            <span className="font-medium text-text">{formatMoney(leg.baseFareMinor, 'INR')}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between border-t border-border pt-3">
                      <span className="text-sm text-text-muted">Total (both legs)</span>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-semibold text-text">{formatMoney(totalMinor, 'INR')}</span>
                        <Button onClick={() => selectOption(opt)}>Select seats</Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        ) : <EmptyState title="No connecting journeys found" description="Try a different date — layovers must be between 2 and 24 hours." />
      )}
    </div>
  );
}
