import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  AlertCircle, Baby, BadgeCheck, Beer, Bus as BusIcon, Check, CigaretteOff, Clock, Landmark, Luggage, MapPin, PawPrint, ShieldCheck, Star, X,
} from 'lucide-react';

import { Button, ErrorState, Modal, Skeleton } from '@/components/ui';
import { flowApi, type TripBusDetails } from '@/lib/api/booking-flow';
import { REVIEW_ASPECTS } from '@/lib/api/content';
import { SEAT_TYPE_LABEL, cn, formatMoney } from '@/lib/utils';

const TABS = [
  ['highlights', 'Highlights'],
  ['cancellation', 'Cancellation policy'],
  ['route', 'Bus route'],
  ['boarding', 'Boarding points'],
  ['dropping', 'Dropping points'],
  ['features', 'Bus features'],
  ['reviews', 'Reviews'],
  ['safety', 'Bus safety'],
  ['about', 'About bus'],
  ['policies', 'Other policies'],
] as const;
type TabKey = (typeof TABS)[number][0];

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/**
 * Everything about this bus under the seat map, as booking sites show it: tabs that
 * jump to each section, and the sections in one scroll — highlights, the
 * cancellation policy with this trip's real dates, the route, boarding and
 * dropping points, features, this bus's own reviews, safety, the bus and the
 * operator's other policies.
 */
export function BusDetails({ tripId, fromStopId, toStopId, tenantId }: { tripId: string; fromStopId?: string; toStopId?: string; tenantId?: string }) {
  const q = useQuery({ queryKey: ['bus-details', tripId, fromStopId, toStopId], queryFn: () => flowApi.busDetails(tripId, fromStopId, toStopId, tenantId), staleTime: 60_000 });
  const [active, setActive] = useState<TabKey>('highlights');
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const tabBar = useRef<HTMLDivElement>(null);

  // Highlight the tab of the section being read.
  useEffect(() => {
    if (!q.data) return;
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.getAttribute('data-tab') as TabKey);
    }, { rootMargin: '-120px 0px -60% 0px' });
    Object.values(refs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [q.data]);
  useEffect(() => {
    tabBar.current?.querySelector(`[data-key="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active]);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data!;
  const go = (k: TabKey) => { setActive(k); refs.current[k]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const section = (k: TabKey, title: string, body: React.ReactNode, sub?: string) => (
    <section key={k} data-tab={k} ref={(el) => { refs.current[k] = el; }} aria-labelledby={`bd-${k}`} className="scroll-mt-32 border-b border-border px-4 py-6 last:border-0 sm:px-6">
      <h3 id={`bd-${k}`} className="text-lg font-semibold text-text">{title}</h3>
      {sub && <p className="text-sm text-text-muted">{sub}</p>}
      <div className="mt-4">{body}</div>
    </section>
  );

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div ref={tabBar} role="tablist" aria-label="About this bus" className="sticky top-16 z-10 flex gap-1 overflow-x-auto rounded-t-2xl border-b border-border bg-surface px-2 [scrollbar-width:none]">
        {TABS.map(([k, label]) => (
          <button key={k} data-key={k} role="tab" aria-selected={active === k} onClick={() => go(k)}
            className={cn('shrink-0 border-b-2 px-3 py-3 text-sm font-medium', active === k ? 'border-text text-text' : 'border-transparent text-text-muted hover:text-text')}>
            {label}
          </button>
        ))}
      </div>

      {section('highlights', 'Highlights', (
        <dl className="grid gap-x-8 sm:grid-cols-2">
          {d.highlights.map((h) => (
            <div key={h.key} className="border-b border-border py-3 last:border-0 sm:[&:nth-last-child(2)]:border-0">
              <dt className="font-medium text-text">{h.title}</dt>
              <dd className="text-sm text-text-muted">{h.detail}</dd>
            </div>
          ))}
        </dl>
      ))}

      {section('cancellation', 'Cancellation policy', (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left"><tr><th className="px-4 py-3 font-semibold">Cancellation time</th><th className="px-4 py-3 font-semibold">Refund</th></tr></thead>
              <tbody>
                {d.cancellation.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-3">{r.from ? `From ${when(r.from)} until ${when(r.until)}` : `Before ${when(r.until)}`}</td>
                    <td className={cn('px-4 py-3 font-medium', r.refundPct > 0 ? 'text-success' : 'text-text-muted')}>{r.refundPct > 0 ? `${r.refundPct}% refund` : 'No refund'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-1 text-xs text-text-muted">
            {d.cancellation.freeCancellationHours > 0 && <li>Cancel within {d.cancellation.freeCancellationHours} hours of paying for a full refund.</li>}
            {d.cancellation.flatFeeMinor > 0 && <li>A cancellation fee of {formatMoney(d.cancellation.flatFeeMinor, 'INR')} per seat is deducted.</li>}
            {d.cancellation.cutoffHours > 0 && <li>Tickets cannot be cancelled online in the last {d.cancellation.cutoffHours} hours.</li>}
            <li>{d.cancellation.partialCancellation ? 'You can cancel some seats of a booking and keep the rest.' : 'Only a whole booking can be cancelled.'}</li>
          </ul>
        </div>
      ))}

      {section('route', 'Bus route', (
        <ol className="flex flex-wrap items-center gap-y-2 text-base text-text">
          {d.route.stops.map((s, i) => (
            <li key={i} className="flex items-center whitespace-nowrap">
              <span className={cn((s.boardHere || s.dropHere) && 'rounded bg-surface-muted px-1.5 font-medium')}>{s.name}</span>
              {i < d.route.stops.length - 1 && <span aria-hidden className="mx-2 text-text-muted">→</span>}
            </li>
          ))}
        </ol>
      ), `${d.route.distanceKm} km · ${Math.floor(d.route.durationMin / 60)}h ${d.route.durationMin % 60}m`)}

      {section('boarding', 'Boarding points', <PointList points={d.boardingPoints} />, d.boardingPoints[0]?.city ?? undefined)}
      {section('dropping', 'Dropping points', <PointList points={d.droppingPoints} />, d.droppingPoints[0]?.city ?? undefined)}

      {section('features', 'Bus features', d.amenities.length ? (
        <div className="flex flex-wrap gap-2">
          {d.amenities.map((a) => <span key={a.code} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text">{a.name}</span>)}
        </div>
      ) : <p className="text-sm text-text-muted">The operator has not listed the features of this bus yet.</p>)}

      {section('reviews', 'Ratings & reviews', <Reviews d={d} tenantId={tenantId} />)}

      {section('safety', 'Bus safety details', (
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.safety.map((s) => (
            <li key={s.key} className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
              {s.ok ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />}
              <span><span className={cn('font-medium', s.ok ? 'text-text' : 'text-text-muted')}>{s.label}</span><span className="block text-xs text-text-muted">{s.detail}</span></span>
            </li>
          ))}
        </ul>
      ))}

      {section('about', 'About bus', d.bus ? (
        <div className="flex flex-col gap-4">
          {d.bus.photos.length > 0 ? (
            <div className="flex snap-x gap-3 overflow-x-auto pb-1">
              {d.bus.photos.map((p, i) => <img key={i} src={p.url} alt={p.caption ?? `${d.bus!.name} photo ${i + 1}`} className="h-44 w-72 shrink-0 snap-start rounded-2xl object-cover" loading="lazy" />)}
            </div>
          ) : <div className="flex h-32 items-center justify-center rounded-2xl bg-surface-muted text-sm text-text-muted"><BusIcon className="mr-2 h-5 w-5" /> No photos yet</div>}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-text-muted">Bus</dt><dd className="font-semibold text-text">{d.bus.name}</dd></div>
            <div><dt className="text-text-muted">Type</dt><dd className="font-semibold text-text">{[d.bus.type, d.bus.ac ? 'AC' : 'Non-AC'].filter(Boolean).join(' · ')}</dd></div>
            <div><dt className="text-text-muted">Seats</dt><dd className="font-semibold text-text">{d.bus.seats} · {d.bus.seatTypes.map((t) => SEAT_TYPE_LABEL[t] ?? t).join(', ')}</dd></div>
            <div><dt className="text-text-muted">{d.bus.decks > 1 ? 'Decks' : 'Built'}</dt><dd className="font-semibold text-text">{d.bus.decks > 1 ? 'Lower + upper' : d.bus.year ?? '—'}</dd></div>
          </dl>
          <p className="text-xs text-text-muted">Photos are of this bus, uploaded by {d.operatorName}.</p>
        </div>
      ) : <p className="text-sm text-text-muted">The operator will assign the bus for this trip before departure — its number comes in the 4-hour reminder.</p>)}

      {section('policies', 'Other policies', (
        <div className="flex flex-col gap-6">
          {(d.stateRules?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-center gap-2 font-semibold text-text"><Landmark className="h-5 w-5" /> Government rules on this route</div>
              <p className="mb-3 text-xs text-text-muted">Set for each state the bus passes through. They apply to every passenger, whatever the operator’s policies below say.</p>
              <div className="flex flex-col gap-3">
                {d.stateRules!.map((s) => (
                  <div key={s.stateId}>
                    <div className="text-sm font-semibold text-text">{s.stateName}</div>
                    <ul className="mt-1 flex flex-col gap-2">
                      {s.norms.map((n) => (
                        <li key={n.id} className="text-sm"><span className="font-medium text-text">{n.title}.</span> <span className="text-text-muted">{n.body}</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        <ul className="flex flex-col gap-5">
          {d.policies.map((p) => (
            <li key={p.key} className="flex gap-4">
              <PolicyIcon k={p.key} />
              <span><span className="block font-semibold text-text">{p.title}</span><span className="text-sm text-text-muted">{p.text}</span></span>
            </li>
          ))}
        </ul>
        </div>
      ))}
    </div>
  );
}

function PolicyIcon({ k }: { k: string }) {
  const cls = 'mt-0.5 h-6 w-6 shrink-0 text-text';
  if (k === 'child') return <Baby className={cls} />;
  if (k === 'luggage') return <Luggage className={cls} />;
  if (k === 'pets') return <PawPrint className={cls} />;
  if (k === 'liquor') return <Beer className={cls} />;
  if (k === 'smoking') return <CigaretteOff className={cls} />;
  if (k === 'pickup') return <Clock className={cls} />;
  return <BadgeCheck className={cls} />;
}

function PointList({ points }: { points: TripBusDetails['boardingPoints'] }) {
  if (!points.length) return <p className="text-sm text-text-muted">None for your journey.</p>;
  return (
    <ol className="relative flex flex-col gap-5 pl-0">
      {points.map((p, i) => (
        <li key={p.stopId} className="grid grid-cols-[4rem_1rem_1fr] gap-3">
          <span className="text-right"><span className="block text-lg font-semibold text-text">{hhmm(p.at)}</span><span className="text-xs text-text-muted">{day(p.at)}</span></span>
          <span className="relative flex justify-center">
            <span className="mt-2 h-3 w-3 rounded-full bg-text" />
            {i < points.length - 1 && <span className="absolute top-5 h-[calc(100%+0.75rem)] w-0.5 bg-border" />}
          </span>
          <span><span className="block font-semibold text-text">{p.name}</span><span className="text-sm text-text-muted">{[p.landmark, p.address].filter(Boolean).join(' · ') || <><MapPin className="inline h-3 w-3" /> {p.city}</>}</span></span>
        </li>
      ))}
    </ol>
  );
}

function Reviews({ d, tenantId }: { d: TripBusDetails; tenantId?: string }) {
  const [all, setAll] = useState(false);
  const r = d.reviews;
  if (!d.bus) return <p className="text-sm text-text-muted">Reviews show once the bus for this trip is assigned.</p>;
  if (!r || r.count === 0) return <p className="text-sm text-text-muted">No reviews for this bus yet — travellers can rate it after their trip.</p>;
  const pct = (n: number) => Math.round((n / r.count) * 100);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm font-medium text-success"><BadgeCheck className="h-4 w-4" /> Real feedback from verified travellers of this bus</span>
        <span className="text-right"><span className="flex items-center gap-1 text-3xl font-semibold text-text"><Star className="h-5 w-5 fill-current text-warning" />{r.average}</span><span className="text-xs text-text-muted">{r.count} rating{r.count === 1 ? '' : 's'}</span></span>
      </div>
      <div className="flex flex-col gap-2">
        {([5, 4, 3, 2, 1] as const).map((n) => (
          <div key={n} className="flex items-center gap-3 text-sm">
            <span className="flex w-8 items-center gap-0.5">{n}<Star className="h-3.5 w-3.5 fill-current" /></span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full bg-text" style={{ width: `${pct(r.distribution[String(n) as '1'])}%` }} /></span>
            <span className="w-10 text-right text-text-muted">{pct(r.distribution[String(n) as '1'])}%</span>
          </div>
        ))}
      </div>
      {r.liked.length > 0 && (
        <div>
          <div className="mb-2 font-semibold text-text">Loved by travellers</div>
          <div className="flex flex-wrap gap-2">{r.liked.map((l) => <span key={l.aspect} className="rounded-lg border border-border px-3 py-1.5 text-sm text-text">{l.label} ({l.count})</span>)}</div>
        </div>
      )}
      <ul className="flex flex-col gap-3">{r.items.slice(0, 3).map((x) => <ReviewItem key={x.id} x={x} />)}</ul>
      {r.count > 3 && <Button variant="outline" onClick={() => setAll(true)}>Read all reviews ({r.count})</Button>}
      {all && <AllReviews vehicleId={d.bus.id} tenantId={tenantId} total={r.count} onClose={() => setAll(false)} />}
    </div>
  );
}

function ReviewItem({ x }: { x: NonNullable<TripBusDetails['reviews']>['items'][number] }) {
  return (
    <li className="rounded-2xl border border-border p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2"><span className={cn('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-bold text-white', x.rating >= 4 ? 'bg-success' : x.rating >= 3 ? 'bg-warning' : 'bg-danger')}>{x.rating}<Star className="h-3 w-3 fill-current" /></span><span className="font-semibold text-text">{x.reviewer || 'Traveller'}</span></span>
        <span className="text-xs text-text-muted">{x.travelledOn ? `Travelled ${day(x.travelledOn)}` : day(x.createdAt)}</span>
      </div>
      {x.title && <div className="mt-2 font-medium text-text">{x.title}</div>}
      {x.body && <p className="mt-1 text-text-muted">{x.body}</p>}
      {x.liked.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{x.liked.map((a) => <span key={a} className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs"><Check className="h-3 w-3 text-success" />{REVIEW_ASPECTS.find((r) => r.value === a)?.label ?? a}</span>)}</div>}
      {x.reply && <div className="mt-3 rounded-xl bg-surface-muted p-3 text-xs"><span className="font-semibold">Operator replied:</span> {x.reply}</div>}
    </li>
  );
}

function AllReviews({ vehicleId, tenantId, total, onClose }: { vehicleId: string; tenantId?: string; total: number; onClose: () => void }) {
  const q = useInfiniteQuery({
    queryKey: ['bus-reviews', vehicleId],
    queryFn: ({ pageParam }) => flowApi.busReviews(vehicleId, pageParam, tenantId),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (pages.flatMap((p) => p.items).length < total && last.items.length ? pages.flatMap((p) => p.items).length : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Modal open onClose={onClose} title={`All reviews (${total})`} size="lg">
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">{items.map((x) => <ReviewItem key={x.id} x={x} />)}</ul>
          {q.isLoading && <Skeleton className="h-24 w-full" />}
          {q.hasNextPage && <Button variant="outline" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Show more</Button>}
          {!q.hasNextPage && !q.isLoading && <p className="flex items-center justify-center gap-1 text-xs text-text-muted"><X className="h-3 w-3" /> That is every review of this bus</p>}
        </div>
      )}
    </Modal>
  );
}
