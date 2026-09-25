import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Users, ArrowRight, Star } from 'lucide-react';

import { Button, Card, CardBody, Badge, PageLoader, ErrorState, EmptyState } from '@/components/ui';
import { storefrontApi } from '@/lib/api/storefront';
import { flowApi } from '@/lib/api/booking-flow';
import type { SearchResult } from '@/lib/api/types';
import { useBooking } from '@/stores/booking';
import { formatMoney, formatTime, minutesToHm, slugifyCityName } from '@/lib/utils';

export function ResultsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const b = useBooking();
  const journeyDate = params.get('date') ?? b.journeyDate;
  const fromSlug = params.get('from');
  const toSlug = params.get('to');

  // The URL carries readable city SLUGS (e.g. "new-delhi"), never a raw
  // city UUID — these two resolve slug -> the real city before the actual
  // trip search can run. When there's no slug in the URL at all (someone
  // navigated here via in-app state rather than a shared/typed URL), the
  // already-real id already sitting in the booking store is used directly
  // — nothing to resolve.
  const originLookup = useQuery({
    queryKey: ['city-slug', fromSlug], queryFn: () => flowApi.cityBySlug(fromSlug!), enabled: Boolean(fromSlug),
  });
  const destLookup = useQuery({
    queryKey: ['city-slug', toSlug], queryFn: () => flowApi.cityBySlug(toSlug!), enabled: Boolean(toSlug),
  });
  const originCityId = fromSlug ? originLookup.data?.id : b.originCityId;
  const destCityId = toSlug ? destLookup.data?.id : b.destCityId;
  const originLabel = fromSlug ? (originLookup.data?.name ?? '') : b.originLabel;
  const destLabel = toSlug ? (destLookup.data?.name ?? '') : b.destLabel;
  const slugsPending = Boolean((fromSlug && originLookup.isLoading) || (toSlug && destLookup.isLoading));
  const slugsFailed = (fromSlug && originLookup.isError) || (toSlug && destLookup.isError);

  const search = useQuery({
    queryKey: ['results', originCityId, destCityId, journeyDate],
    queryFn: () => storefrontApi.search({ originCityId: originCityId!, destCityId: destCityId!, journeyDate }),
    enabled: Boolean(originCityId && destCityId && journeyDate),
  });

  const select = (trip: SearchResult) => {
    b.setSearch({ originCityId: originCityId ?? '', destCityId: destCityId ?? '', journeyDate, originLabel, destLabel });
    navigate('/trip', { state: { trip } });
  };

  if (slugsPending) return <div className="mx-auto max-w-5xl px-4 py-8"><PageLoader /></div>;
  if (slugsFailed) return <div className="mx-auto max-w-5xl px-4 py-8"><EmptyState title="City not found" description="This search link looks invalid — try searching again." /></div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <div className="text-sm text-text-muted">{originLabel || 'Origin'} → {destLabel || 'Destination'} · {journeyDate}</div>
        <h1 className="text-2xl font-semibold text-text">Available buses</h1>
      </div>

      {search.isLoading ? <PageLoader /> : search.isError ? <ErrorState error={search.error} onRetry={search.refetch} /> :
        (search.data && search.data.results.length > 0 ? (
          <div className="flex flex-col gap-3">
            {search.data.results.map((t) => (
              <Card key={t.tripId} className="transition hover:shadow-md">
                <CardBody className="flex flex-col gap-2">
                  <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
                    <div className="flex flex-1 items-center gap-6">
                      <div className="text-center"><div className="text-lg font-semibold text-text">{formatTime(t.departsAt)}</div><div className="text-xs text-text-muted">Depart</div></div>
                      <div className="flex flex-col items-center text-text-muted">
                        <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />{minutesToHm(t.durationMin)}</span>
                        <ArrowRight className="h-4 w-4" />
                      </div>
                      <div className="text-center"><div className="text-lg font-semibold text-text">{formatTime(t.arrivesAt)}</div><div className="text-xs text-text-muted">Arrive</div></div>
                      <div className="ml-2 flex items-center gap-2">
                        <Badge tone={t.availableSeats > 5 ? 'success' : 'warning'}><Users className="h-3 w-3" /> {t.availableSeats}</Badge>
                        {t.operatorRating ? <Badge tone="info"><Star className="h-3 w-3" /> {t.operatorRating.toFixed(1)}</Badge> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right"><div className="text-xs text-text-muted">from</div><div className="text-xl font-semibold text-text">{formatMoney(t.fromPriceMinor, t.currency)}</div></div>
                      <Button onClick={() => select(t)}>Select seats</Button>
                    </div>
                  </div>
                  {t.amenities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-1">
                      {t.amenities.map((a) => (
                        <span key={a.id} className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-muted" title={a.name}>
                          {a.icon && <span>{a.icon}</span>}{a.name}
                        </span>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <EmptyState title="No direct buses found" description="Try another date or city pair." />
            <Button variant="outline" onClick={() => navigate(`/connecting/results?from=${slugifyCityName(originLabel)}&to=${slugifyCityName(destLabel)}&date=${journeyDate}`)}>
              Check connecting buses via another city
            </Button>
          </div>
        ))}
    </div>
  );
}
