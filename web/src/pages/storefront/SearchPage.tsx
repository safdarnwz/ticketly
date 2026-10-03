import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';

import { Button, Card, CardBody, Input, Select, EmptyState, ErrorState, Spinner, usePaged } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { CityInput } from '@/components/customer/CityInput';
import { TripResultCard } from '@/components/customer/TripResultCard';
import { storefrontApi, type SearchInput } from '@/lib/api/storefront';
import type { SearchResult } from '@/lib/api/types';
import { WaitlistModal } from '@/components/booking/WaitlistModal';
import { todayLocal } from '@/lib/utils';

export function SearchPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<SearchInput>({
    originCityId: '',
    destCityId: '',
    journeyDate: todayLocal(),
    sort: 'departure',
  });
  const [originLabel, setOriginLabel] = useState('');
  const [destLabel, setDestLabel] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [waitFor, setWaitFor] = useState<SearchResult | null>(null);

  const search = useMutation({
    mutationFn: () =>
      storefrontApi.search({
        ...form,
        filter: priceMax ? { maxPriceMinor: Number(priceMax) * 100 } : undefined,
      }),
  });

  const resultPage = usePaged(search.data?.results ?? []);
  const set = (patch: Partial<SearchInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      <PageHeader title="Search & Book" subtitle="Find trips with live availability and fares" />

      <Card className="mb-6">
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search.mutate();
            }}
            className="grid grid-cols-1 gap-4 md:grid-cols-5"
          >
            <CityInput
              label="Origin city"
              value={originLabel}
              onSelect={(c) => {
                set({ originCityId: c.id });
                setOriginLabel(c.name);
              }}
              onClear={() => set({ originCityId: '' })}
            />
            <CityInput
              label="Destination city"
              value={destLabel}
              onSelect={(c) => {
                set({ destCityId: c.id });
                setDestLabel(c.name);
              }}
              onClear={() => set({ destCityId: '' })}
            />
            <Input
              label="Date"
              type="date"
              value={form.journeyDate}
              min={todayLocal()}
              onChange={(e) => set({ journeyDate: e.target.value })}
              required
            />
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
              <Button
                type="submit"
                fullWidth
                loading={search.isPending}
                disabled={!form.originCityId || !form.destCityId || form.originCityId === form.destCityId}
                leftIcon={<SearchIcon className="h-4 w-4" />}
              >
                Search
              </Button>
            </div>
          </form>
          <div className="mt-4 max-w-xs">
            <Input
              label="Max price (₹, optional)"
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              placeholder="e.g. 1500"
            />
          </div>
        </CardBody>
      </Card>

      {search.isPending && (
        <div className="flex justify-center py-10">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {search.isError && <ErrorState error={search.error} onRetry={() => search.mutate()} />}
      {search.isSuccess &&
        (search.data.results.length === 0 ? (
          <EmptyState title="No trips found" description="Try a different date or city pair." />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-text-muted">{search.data.count} trip(s) found</div>
            {resultPage.pageItems.map((r) => (
              <div key={r.tripId}>
                <TripResultCard
                  trip={r}
                  actionLabel={r.availableSeats > 0 ? 'Select seats' : 'Full — add to waitlist'}
                  onSelect={(trip) => (trip.availableSeats > 0 ? navigate('/staff-trip', { state: { trip } }) : setWaitFor(trip))}
                />
              </div>
            ))}
            {resultPage.pager}
          </div>
        ))}
      {waitFor && <WaitlistModal trip={waitFor} onClose={() => setWaitFor(null)} />}
    </>
  );
}
