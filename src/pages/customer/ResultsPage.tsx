import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight, Pencil, SlidersHorizontal, Waypoints, X } from 'lucide-react';

import { Button, Card, CardBody, EmptyState, ErrorState, Modal, Skeleton } from '@/components/ui';
import { SearchForm } from '@/components/customer/SearchForm';
import { CompactTripCard, TripResultCard } from '@/components/customer/TripResultCard';
import { ResultFilters } from '@/components/customer/ResultFilters';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  filtersFromParams,
  toApiFilter,
  writeFiltersToParams,
  type FilterState,
} from '@/lib/search-filters';
import { storefrontApi, type SearchInput } from '@/lib/api/storefront';
import { flowApi } from '@/lib/api/booking-flow';
import type { SearchResult } from '@/lib/api/types';
import { useBooking } from '@/stores/booking';
import { SEAT_TYPE_LABEL, addDaysIso, cn, formatDateLabel, slugifyCityName, todayLocal } from '@/lib/utils';

type Sort = NonNullable<SearchInput['sort']>;
const SORTS: { key: Sort; label: string }[] = [
  { key: 'departure', label: 'Departure' },
  { key: 'price', label: 'Cheapest' },
  { key: 'duration', label: 'Fastest' },
  { key: 'rating', label: 'Top rated' },
];
const isDate = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));

/** Buses grouped by their main seat type, groups in the order the sort put them. */
function groupByType(list: SearchResult[]): [string, SearchResult[]][] {
  const groups = new Map<string, SearchResult[]>();
  for (const t of list) {
    const key = t.seatTypes.length ? t.seatTypes.map((x) => SEAT_TYPE_LABEL[x] ?? x).join(' / ') : 'Bus';
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()];
}

export function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const b = useBooking();
  const today = todayLocal();
  const [editing, setEditing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const rawDate = params.get('date');
  const date = isDate(rawDate) ? rawDate : today;
  const rawReturn = params.get('return');
  const returnDate = isDate(rawReturn) && rawReturn >= date ? rawReturn : undefined;
  const leg: 'onward' | 'return' = returnDate && params.get('leg') === 'return' ? 'return' : 'onward';
  const sortParam = params.get('sort') as Sort | null;
  const sort: Sort = SORTS.some((s) => s.key === sortParam) ? sortParam! : 'departure';
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const apiFilter = toApiFilter(filters);
  const fromSlug = params.get('from');
  const toSlug = params.get('to');

  // Readable city slugs in the URL resolve to the real cities first.
  const origin = useQuery({ queryKey: ['city-slug', fromSlug], queryFn: () => flowApi.cityBySlug(fromSlug!), enabled: Boolean(fromSlug), staleTime: Infinity });
  const dest = useQuery({ queryKey: ['city-slug', toSlug], queryFn: () => flowApi.cityBySlug(toSlug!), enabled: Boolean(toSlug), staleTime: Infinity });
  const originId = fromSlug ? origin.data?.id : b.originCityId || undefined;
  const destId = toSlug ? dest.data?.id : b.destCityId || undefined;
  const originName = fromSlug ? origin.data?.name ?? '' : b.originLabel;
  const destName = toSlug ? dest.data?.name ?? '' : b.destLabel;
  const ready = Boolean(originId && destId && originId !== destId && date >= today);

  const run = (withFilter: boolean) => (): Promise<{ onward: SearchResult[]; ret: SearchResult[] }> => {
    const filter = withFilter ? apiFilter : undefined;
    if (returnDate) {
      return storefrontApi
        .roundTrip({ originCityId: originId!, destCityId: destId!, onwardDate: date, returnDate, filter, sort })
        .then((r) => ({ onward: r.onward, ret: r.return }));
    }
    return storefrontApi
      .search({ originCityId: originId!, destCityId: destId!, journeyDate: date, filter, sort })
      .then((r) => ({ onward: r.results, ret: [] }));
  };
  const keyBase = ['results', originId, destId, date, returnDate ?? null, sort] as const;
  const search = useQuery({ queryKey: [...keyBase, apiFilter ?? null], queryFn: run(true), enabled: ready, placeholderData: keepPreviousData });
  // Unfiltered results give the filter options (and the "0 of N" note); when
  // no filter is active it is the same request, served from cache.
  const all = useQuery({ queryKey: [...keyBase, null], queryFn: run(false), enabled: ready && Boolean(apiFilter), staleTime: 60_000 });

  const list = (leg === 'return' ? search.data?.ret : search.data?.onward) ?? [];
  const facets = ((apiFilter ? all.data : search.data)?.[leg === 'return' ? 'ret' : 'onward']) ?? [];

  const update = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mut(next);
    setParams(next, { replace: true });
  };
  const setFilters = (f: FilterState) => setParams(writeFiltersToParams(params, f), { replace: true });
  const setDate = (d: string) => update((p) => {
    p.set('date', d);
    if (returnDate && returnDate < d) p.set('return', d);
  });

  const select = (trip: SearchResult) => {
    const fromLbl = leg === 'return' ? destName : originName;
    const toLbl = leg === 'return' ? originName : destName;
    b.setSearch({
      originCityId: (leg === 'return' ? destId : originId) ?? '',
      destCityId: (leg === 'return' ? originId : destId) ?? '',
      originLabel: fromLbl,
      destLabel: toLbl,
      journeyDate: leg === 'return' ? returnDate! : date,
    });
    b.setPendingReturn(leg === 'onward' && returnDate ? { date: returnDate, fromLabel: destName, toLabel: originName } : undefined);
    navigate('/trip', { state: { trip } });
  };

  // ── page states ────────────────────────────────────────────────
  if ((fromSlug && origin.isLoading) || (toSlug && dest.isLoading)) {
    return <div className="mx-auto max-w-6xl px-4 py-8"><Skeleton className="h-24 w-full" /></div>;
  }
  if (!fromSlug || !toSlug || origin.isError || dest.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState title="We could not find those cities" description="The link may be old or mistyped. Search again below." />
        <Card className="mt-6"><CardBody><SearchForm compact /></CardBody></Card>
      </div>
    );
  }
  if (originId === destId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState title="From and To are the same city" description="Pick a different destination." />
        <Card className="mt-6"><CardBody><SearchForm compact /></CardBody></Card>
      </div>
    );
  }

  const legFrom = leg === 'return' ? destName : originName;
  const legTo = leg === 'return' ? originName : destName;
  const legDate = leg === 'return' ? returnDate! : date;
  const filterCount = activeFilterCount(filters);
  const stripStart = [date, addDaysIso(date, -1), addDaysIso(date, -2), addDaysIso(date, -3)].filter((d) => d >= today).pop() ?? today;
  const strip = Array.from({ length: 7 }, (_, i) => addDaysIso(stripStart, i));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4">
      {/* Journey header: pink "from" and purple "to", big city names, round edit button. */}
      <section className="soft-card relative mb-4 px-5 py-5 sm:px-7">
        <div className="flex items-center gap-4 pr-16">
          <div className="flex flex-col items-center self-stretch py-1.5">
            <span className="dot-from" /><span className="dot-line my-1 flex-1" /><span className="dot-to" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-text-muted">From</div>
            <div className="truncate font-display text-[22px] leading-tight text-text sm:text-[26px]">{originName}</div>
            <div className="my-2 h-px bg-border" />
            <div className="text-[12px] text-text-muted">Destination</div>
            <div className="truncate font-display text-[22px] leading-tight text-text sm:text-[26px]">{destName}</div>
          </div>
        </div>
        <div className="mt-3 text-sm text-text-muted">
          {formatDateLabel(date, { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
          {returnDate && <> · Return {formatDateLabel(returnDate)}</>}
        </div>
        <button
          type="button"
          aria-label={editing ? 'Close search' : 'Modify search'}
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
          className="absolute right-5 top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg transition hover:scale-105 sm:right-7"
        >
          {editing ? <X className="h-5 w-5" /> : <Pencil className="h-5 w-5" />}
        </button>
      </section>
      {editing && (
        <Card className="mb-4"><CardBody><SearchForm compact initialReturnDate={returnDate} onDone={() => setEditing(false)} /></CardBody></Card>
      )}

      {date < today && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <span className="flex items-center gap-2"><CalendarX2 className="h-4 w-4" /> This date has passed.</span>
          <Button size="sm" variant="outline" onClick={() => setDate(today)}>Show today’s buses</Button>
        </div>
      )}

      {returnDate && (
        <div className="mb-4 flex gap-2">
          {(['onward', 'return'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => update((p) => (l === 'return' ? p.set('leg', 'return') : p.delete('leg')))}
              className={cn(
                'flex-1 rounded-card px-4 py-2.5 text-left text-sm transition',
                leg === l ? 'bg-surface text-text shadow-md ring-2 ring-accent/60' : 'bg-surface-muted text-text-muted hover:bg-border',
              )}
            >
              <div className="font-semibold">{l === 'onward' ? 'Onward' : 'Return'}</div>
              <div className="text-xs">
                {l === 'onward' ? `${originName} → ${destName} · ${formatDateLabel(date)}` : `${destName} → ${originName} · ${formatDateLabel(returnDate)}`}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Date strip (onward date) */}
      {leg === 'onward' && (
        <div className="mb-4 flex items-center gap-1">
          <button type="button" aria-label="Earlier dates" disabled={stripStart <= today} onClick={() => setDate(addDaysIso(date, -1) < today ? today : addDaysIso(date, -1))} className="rounded-full p-1.5 text-text-muted hover:bg-surface-muted disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="grid flex-1 grid-cols-4 gap-2 sm:grid-cols-7">
            {strip.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                aria-pressed={d === date}
                className={cn(
                  'flex flex-col items-start rounded-2xl px-3 py-2 text-left transition',
                  i >= 4 && 'hidden sm:flex',
                  d === date ? 'bg-accent text-white shadow-md' : 'bg-surface-muted text-text-muted hover:bg-border',
                )}
              >
                <span className="text-[11px] font-semibold">{formatDateLabel(d, { weekday: 'short' })}</span>
                <span className={cn('font-display text-xl leading-tight', d !== date && 'text-text')}>{formatDateLabel(d, { day: 'numeric' })}<span className="ml-1 text-[11px] font-semibold">{formatDateLabel(d, { month: 'short' })}</span></span>
              </button>
            ))}
          </div>
          <button type="button" aria-label="Later dates" onClick={() => setDate(addDaysIso(date, 1))} className="rounded-full p-1.5 text-text-muted hover:bg-surface-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex gap-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <Card className="sticky top-20"><CardBody><ResultFilters value={filters} onChange={setFilters} facets={facets} /></CardBody></Card>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-text-muted" aria-live="polite">
              {search.isFetching && !search.data ? 'Searching…' : (
                <>
                  <b className="text-text">{list.length}</b> bus{list.length === 1 ? '' : 'es'} · {legFrom} → {legTo}, {formatDateLabel(legDate)}
                  {filterCount > 0 && facets.length > 0 && <> (of {facets.length})</>}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="lg:hidden" leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => setFiltersOpen(true)}>
                Filters{filterCount ? ` (${filterCount})` : ''}
              </Button>
              <div className="flex overflow-x-auto rounded-pill bg-surface-muted p-1 text-xs no-scrollbar" role="group" aria-label="Sort">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={sort === s.key}
                    onClick={() => update((p) => (s.key === 'departure' ? p.delete('sort') : p.set('sort', s.key)))}
                    className={cn('whitespace-nowrap rounded-pill px-3 py-1.5 font-semibold', sort === s.key ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={cn('flex flex-col gap-3', search.isFetching && search.data && 'opacity-60 transition-opacity')}>
            {search.isLoading ? (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full" />)
            ) : search.isError ? (
              <ErrorState error={search.error} onRetry={search.refetch} />
            ) : list.length > 0 ? (
              <>
                {/* Phones: one sideways carousel per bus type, like a shelf. */}
                <div className="flex flex-col gap-5 sm:hidden">
                  {groupByType(list).map(([type, trips]) => (
                    <section key={type} aria-label={`${type} buses`}>
                      <div className="mb-2 flex items-baseline justify-between">
                        <h3 className="font-display text-[17px] text-text">{type}</h3>
                        <span className="text-xs text-text-muted">{trips.length} bus{trips.length === 1 ? '' : 'es'}</span>
                      </div>
                      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 pt-1">
                        {trips.map((t, i) => <CompactTripCard key={t.tripId} trip={t} onSelect={select} muted={i > 0} />)}
                      </div>
                    </section>
                  ))}
                </div>
                <div className="hidden flex-col gap-3 sm:flex">
                  {list.map((t) => <TripResultCard key={t.tripId} trip={t} onSelect={select} />)}
                </div>
              </>
            ) : filterCount > 0 ? (
              <EmptyState
                title="No buses match these filters"
                description={facets.length ? `${facets.length} bus${facets.length === 1 ? '' : 'es'} run on this date without the filters.` : undefined}
                action={<Button variant="outline" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                title={`No direct buses ${legFrom} → ${legTo} on ${formatDateLabel(legDate)}`}
                description="Buses may be sold out or not running that day."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" onClick={() => (leg === 'return' ? update((p) => p.set('return', addDaysIso(returnDate!, 1))) : setDate(addDaysIso(date, 1)))}>
                      Try {formatDateLabel(addDaysIso(legDate, 1))}
                    </Button>
                    {leg === 'onward' && (
                      <Button
                        variant="outline"
                        leftIcon={<Waypoints className="h-4 w-4" />}
                        onClick={() => navigate(`/connecting/results?from=${slugifyCityName(originName)}&to=${slugifyCityName(destName)}&date=${date}`)}
                      >
                        Buses with one change
                      </Button>
                    )}
                  </div>
                }
              />
            )}
          </div>
        </div>
      </div>

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" footer={<Button fullWidth onClick={() => setFiltersOpen(false)}>Show {list.length} bus{list.length === 1 ? '' : 'es'}</Button>}>
        <ResultFilters value={filters} onChange={setFilters} facets={facets} showHeading={false} />
      </Modal>
    </div>
  );
}
