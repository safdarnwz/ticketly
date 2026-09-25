import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Search as SearchIcon, Clock, Users, ArrowRight } from 'lucide-react';

import { Button, Card, CardBody, Input, Select, Badge, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { CityInput } from '@/components/customer/CityInput';
import { storefrontApi, type SearchInput } from '@/lib/api/storefront';
import type { SearchResult } from '@/lib/api/types';
import { formatMoney, formatTime, minutesToHm } from '@/lib/utils';

export function SearchPage() {
  const [form, setForm] = useState<SearchInput>({
    originCityId: '', destCityId: '', journeyDate: new Date().toISOString().slice(0, 10), sort: 'departure',
  });
  const [originLabel, setOriginLabel] = useState('');
  const [destLabel, setDestLabel] = useState('');
  const [priceMax, setPriceMax] = useState('');

  const search = useMutation({
    mutationFn: () =>
      storefrontApi.search({
        ...form,
        filter: priceMax ? { maxPriceMinor: Number(priceMax) * 100 } : undefined,
      }),
  });

  const set = (patch: Partial<SearchInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      <PageHeader title="Search & Book" subtitle="Find trips with live availability and fares" />

      <Card className="mb-6">
        <CardBody>
          <form
            onSubmit={(e) => { e.preventDefault(); search.mutate(); }}
            className="grid grid-cols-1 gap-4 md:grid-cols-5"
          >
            <CityInput label="Origin city" value={originLabel} onSelect={(c) => { set({ originCityId: c.id }); setOriginLabel(c.name); }} />
            <CityInput label="Destination city" value={destLabel} onSelect={(c) => { set({ destCityId: c.id }); setDestLabel(c.name); }} />
            <Input label="Date" type="date" value={form.journeyDate} onChange={(e) => set({ journeyDate: e.target.value })} required />
            <Select
              label="Sort by"
              value={form.sort}
              onChange={(e) => set({ sort: e.target.value as SearchInput['sort'] })}
              options={[
                { label: 'Departure', value: 'departure' },
                { label: 'Price', value: 'price' },
                { label: 'Duration', value: 'duration' },
                { label: 'Rating', value: 'rating' },
              ]}
            />
            <div className="flex items-end">
              <Button type="submit" fullWidth loading={search.isPending} disabled={!form.originCityId || !form.destCityId} leftIcon={<SearchIcon className="h-4 w-4" />}>
                Search
              </Button>
            </div>
          </form>
          <div className="mt-4 max-w-xs">
            <Input label="Max price (₹, optional)" type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="e.g. 1500" />
          </div>
        </CardBody>
      </Card>

      {search.isPending && (
        <div className="flex justify-center py-10"><Spinner className="h-8 w-8" /></div>
      )}
      {search.isError && <ErrorState error={search.error} onRetry={() => search.mutate()} />}
      {search.isSuccess && (
        search.data.results.length === 0 ? (
          <EmptyState title="No trips found" description="Try a different date or city pair." />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-text-muted">{search.data.count} trip(s) found</div>
            {search.data.results.map((r) => <TripCard key={r.tripId} trip={r} />)}
          </div>
        )
      )}
    </>
  );
}

function TripCard({ trip }: { trip: SearchResult }) {
  const navigate = useNavigate();
  return (
    <Card className="transition hover:shadow-md">
      <CardBody className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex flex-1 items-center gap-6">
          <div className="text-center">
            <div className="text-lg font-semibold text-text">{formatTime(trip.departsAt)}</div>
            <div className="text-xs text-text-muted">Depart</div>
          </div>
          <div className="flex flex-col items-center text-text-muted">
            <span className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" />{minutesToHm(trip.durationMin)}</span>
            <ArrowRight className="h-4 w-4" />
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-text">{formatTime(trip.arrivesAt)}</div>
            <div className="text-xs text-text-muted">Arrive</div>
          </div>
          <div className="ml-4 flex items-center gap-2">
            <Badge tone={trip.availableSeats > 5 ? 'success' : 'warning'}>
              <Users className="h-3 w-3" /> {trip.availableSeats} seats
            </Badge>
            {trip.operatorRating ? <Badge tone="info">★ {trip.operatorRating.toFixed(1)}</Badge> : null}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-text-muted">from</div>
            <div className="text-xl font-semibold text-text">{formatMoney(trip.fromPriceMinor, trip.currency)}</div>
          </div>
          <Button onClick={() => navigate('/staff-trip', { state: { trip } })}>Select seats</Button>
        </div>
      </CardBody>
    </Card>
  );
}
