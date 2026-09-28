import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, MapPinned, ShieldCheck, Ticket, X } from 'lucide-react';

import { Skeleton, useToast } from '@/components/ui';
import { SearchForm } from '@/components/customer/SearchForm';
import { cmsApi } from '@/lib/api/content';
import { clearRecent, readRecent, type RecentSearch } from '@/lib/recent-searches';
import { useAuth } from '@/stores/auth';
import { useBooking } from '@/stores/booking';
import { cn, formatDateLabel, localDateOf, todayLocal } from '@/lib/utils';

const dayParts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    day: d.getUTCDate(),
    weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(d),
    month: new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(d),
  };
};

/** A past search, one row: from → to and the day searched. */
function RecentTripCard({ r, first, onPick }: { r: RecentSearch; first: boolean; onPick: () => void }) {
  const p = r.date ? dayParts(r.date) : null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Search ${r.from.name} to ${r.to.name} again`}
      className={cn('flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-surface-muted', first && 'border-text-muted/40')}
    >
      <span className="min-w-0 truncate text-sm text-text">{r.from.name} → {r.to.name}</span>
      <span className="shrink-0 text-xs text-text-muted">{p ? `${p.day} ${p.month}` : 'Any day'}</span>
    </button>
  );
}

export function HomePage() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const setSearch = useBooking((s) => s.setSearch);
  const banners = useQuery({ queryKey: ['banners'], queryFn: cmsApi.banners, staleTime: 5 * 60_000 });
  const offers = useQuery({ queryKey: ['offers'], queryFn: cmsApi.offers, staleTime: 5 * 60_000 });
  const [recent, setRecent] = useState<RecentSearch[]>(readRecent);
  useEffect(() => {
    const on = () => setRecent(readRecent());
    window.addEventListener('ticketly:recent', on);
    return () => window.removeEventListener('ticketly:recent', on);
  }, []);

  const today = todayLocal();
  const firstName = user?.fullName?.split(' ')[0];

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Code ${code} copied — apply it at checkout`);
    } catch {
      toast.info(`Your code: ${code}`);
    }
  };

  const pickRecent = (r: RecentSearch) => {
    setSearch({
      originCityId: r.from.id, originLabel: r.from.name,
      destCityId: r.to.id, destLabel: r.to.name,
      ...(r.date && r.date >= today ? { journeyDate: r.date } : {}),
    });
    document.getElementById('search-sheet')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const bannerItems = banners.data?.items ?? [];
  const offerItems = offers.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 lg:pt-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          <div>
            <h1 className="text-2xl font-semibold text-text">{firstName ? `Hi ${firstName}, where to next?` : 'Book bus tickets'}</h1>
            <p className="mt-2 max-w-md text-text-muted">Compare buses from every operator, pick your seat and get an e-ticket straight away.</p>
          </div>

          {recent.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-text">Recent trips</h2>
                <button type="button" onClick={() => { clearRecent(); setRecent([]); }} className="flex items-center gap-1 text-xs text-text-muted hover:text-text" aria-label="Clear recent searches">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {recent.map((r, i) => <RecentTripCard key={`${r.from.id}-${r.to.id}`} r={r} first={i === 0} onPick={() => pickRecent(r)} />)}
              </div>
            </section>
          )}
        </div>

        {/* The search sheet: rises from the bottom on phones, sits beside on desktop. */}
        <section
          id="search-sheet"
          aria-label="Search buses"
          className="-mx-4 min-w-0 scroll-mt-20 border-y border-border bg-surface px-5 pb-6 pt-6 sm:mx-0 sm:rounded-2xl sm:border lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <SearchForm />
        </section>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-2">
          {/* Offers as pink promo pills. */}
          {offers.isLoading ? (
            <div className="flex flex-col gap-3"><Skeleton className="h-16 rounded-pill" /><Skeleton className="h-16 rounded-pill" /></div>
          ) : offerItems.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg text-text">Offers for you</h2>
              <div className="flex flex-col gap-3">
                {offerItems.map((o) => (
                  <div key={o.code} className="flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-3.5 text-text">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{o.title}</div>
                      <div className="truncate text-xs text-text-muted">
                        {o.description ? `${o.description} · ` : ''}till {formatDateLabel(localDateOf(o.validTo), { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    {o.couponCode && (
                      <button
                        type="button"
                        onClick={() => void copy(o.couponCode!)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-mono text-xs font-medium hover:bg-surface-muted"
                      >
                        {o.couponCode} <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {banners.isLoading ? (
            <Skeleton className="h-40 w-full rounded-card" />
          ) : bannerItems.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {bannerItems.map((bn) => {
                const img = <img src={bn.imageUrl} alt={bn.title} loading="lazy" className="aspect-[2/1] w-full rounded-lg object-cover" />;
                return (
                  <div key={bn.id} className="min-w-0">
                    {bn.linkUrl ? <a href={bn.linkUrl} rel="noopener noreferrer">{img}</a> : img}
                  </div>
                );
              })}
            </div>
          )}

          <div className="hidden grid-cols-3 gap-3 lg:grid">
            {[
              { icon: ShieldCheck, title: 'Secure payments', desc: 'UPI, cards and net banking' },
              { icon: Ticket, title: 'Instant e-tickets', desc: 'Signed QR, checked at boarding' },
              { icon: MapPinned, title: 'Live tracking', desc: 'Follow your bus on the day' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="soft-muted flex flex-col gap-2 p-4">
                <Icon className="h-5 w-5 text-secondary" />
                <div className="font-semibold text-text">{title}</div>
                <div className="text-xs text-text-muted">{desc}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
