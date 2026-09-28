import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgePercent, ChevronRight, Copy, History, MapPinned, ShieldCheck, Ticket, X } from 'lucide-react';

import { Skeleton, useToast } from '@/components/ui';
import { SearchForm } from '@/components/customer/SearchForm';
import { cmsApi } from '@/lib/api/content';
import { clearRecent, readRecent, type RecentSearch } from '@/lib/recent-searches';
import { useAuth } from '@/stores/auth';
import { useBooking } from '@/stores/booking';
import { formatDateLabel, localDateOf, todayLocal } from '@/lib/utils';

const dayParts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    day: d.getUTCDate(),
    weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(d),
    month: new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(d),
  };
};

/** A past search, one row: from → to and the day searched. */
function RecentTripCard({ r, onPick }: { r: RecentSearch; onPick: () => void }) {
  const p = r.date ? dayParts(r.date) : null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Search ${r.from.name} to ${r.to.name} again`}
      className="flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-surface-muted"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-muted"><History className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text">{r.from.name} → {r.to.name}</span>
        <span className="block text-xs text-text-muted">{p ? `${p.weekday}, ${p.day} ${p.month}` : 'Any day'}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
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
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 lg:pt-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:pt-6">
          <span className="w-fit rounded-pill bg-accent/10 px-3 py-1 text-xs font-medium text-accent">Buses from every operator, one app</span>
          <h1 className="max-w-xl text-[34px] font-semibold leading-[1.1] tracking-tight text-text sm:text-5xl">
            {firstName ? <>Hi {firstName},<br />where to next?</> : <>Where are you<br />headed next?</>}
          </h1>
          <p className="max-w-md text-text-muted">Compare fares, pick your exact seat and get your e-ticket in seconds.</p>
        </div>

        {/* The search card: under the heading on phones, beside it on desktop. */}
        <section
          id="search-sheet"
          aria-label="Search buses"
          className="min-w-0 scroll-mt-20 rounded-[28px] border border-border bg-surface p-4 sm:p-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <SearchForm />
        </section>

        <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
          {recent.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text">Recent searches</h2>
                <button type="button" onClick={() => { clearRecent(); setRecent([]); }} className="flex h-9 items-center gap-1 rounded-pill px-3 text-sm text-text-muted hover:bg-surface-muted hover:text-text" aria-label="Clear recent searches">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
              <div className="-mx-3 flex flex-col">
                {recent.map((r) => <RecentTripCard key={`${r.from.id}-${r.to.id}`} r={r} onPick={() => pickRecent(r)} />)}
              </div>
            </section>
          )}

          {offers.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /></div>
          ) : offerItems.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-text">Offers for you</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {offerItems.map((o) => (
                  <div key={o.code} className="flex min-w-0 flex-col justify-between gap-4 rounded-2xl bg-surface-muted p-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-text"><BadgePercent className="h-4 w-4 shrink-0 text-accent" /><span className="truncate">{o.title}</span></div>
                      <div className="mt-1 text-sm text-text-muted">
                        {o.description ? `${o.description} · ` : ''}till {formatDateLabel(localDateOf(o.validTo), { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    {o.couponCode && (
                      <button
                        type="button"
                        onClick={() => void copy(o.couponCode!)}
                        className="inline-flex w-fit items-center gap-2 rounded-pill border border-dashed border-accent/50 bg-surface px-3.5 py-1.5 font-mono text-xs font-medium text-accent hover:bg-accent/5"
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
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : bannerItems.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {bannerItems.map((bn) => {
                const img = <img src={bn.imageUrl} alt={bn.title} loading="lazy" className="aspect-[2/1] w-full rounded-2xl object-cover" />;
                return (
                  <div key={bn.id} className="min-w-0">
                    {bn.linkUrl ? <a href={bn.linkUrl} rel="noopener noreferrer">{img}</a> : img}
                  </div>
                );
              })}
            </div>
          )}

          <section className="grid grid-cols-1 gap-5 border-t border-border pt-8 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, title: 'Secure payments', desc: 'UPI, cards and net banking' },
              { icon: Ticket, title: 'Instant e-tickets', desc: 'A signed QR, checked at boarding' },
              { icon: MapPinned, title: 'Live tracking', desc: 'Follow your bus on the day' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"><Icon className="h-[18px] w-[18px]" /></span>
                <div>
                  <div className="font-medium text-text">{title}</div>
                  <div className="text-sm text-text-muted">{desc}</div>
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
