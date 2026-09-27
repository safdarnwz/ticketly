import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, MapPinned, ShieldCheck, Ticket, UserRound, X } from 'lucide-react';

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

/** A past search as a trip card: month, big day, the pink "from" and purple "to" dots. */
function RecentTripCard({ r, first, onPick }: { r: RecentSearch; first: boolean; onPick: () => void }) {
  const p = r.date ? dayParts(r.date) : null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Search ${r.from.name} to ${r.to.name} again`}
      className={cn(
        'flex h-[168px] w-[136px] shrink-0 flex-col rounded-[20px] p-4 text-left transition hover:-translate-y-0.5',
        first ? 'bg-surface shadow-md' : 'bg-surface-muted',
      )}
    >
      <span className="text-[13px] text-text-muted">{p ? p.month : 'Any day'}</span>
      <span className={cn('font-display text-[40px] leading-none', first ? 'text-price' : 'text-text')}>{p ? p.day : '—'}</span>
      <span className="mt-auto flex flex-col gap-1 text-[13px] font-semibold text-text">
        <span className="flex items-center gap-2"><span className="dot-from !h-2.5 !w-2.5" /> <span className="truncate">{r.from.name}</span></span>
        <span className="ml-[4px] h-2 dot-line" />
        <span className="flex items-center gap-2"><span className="dot-to !h-2.5 !w-2.5" /> <span className="truncate">{r.to.name}</span></span>
      </span>
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
  const t = dayParts(today);
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
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          {/* Greeting: today's date, big and pink, and the account avatar. */}
          <div className="flex items-start justify-between">
            <div>
              <div className="font-display text-[44px] leading-none text-accent">{t.day}</div>
              <div className="mt-1 text-2xl text-text">{t.weekday}</div>
              <p className="mt-3 max-w-md text-[15px] text-text-muted">
                {firstName ? `Hi ${firstName}, where to next?` : 'Compare buses from every operator, pick your seat and get an instant e-ticket.'}
              </p>
            </div>
            <Link
              to={user ? '/account' : '/login'}
              aria-label={user ? 'My account' : 'Sign in'}
              className="flex h-12 w-12 items-center justify-center rounded-full sm:hidden bg-gradient-to-br from-accent to-secondary text-base font-bold text-white shadow-md"
            >
              {firstName ? firstName[0]!.toUpperCase() : <UserRound className="h-5 w-5" />}
            </Link>
          </div>

          {recent.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg text-text">Recent trips</h2>
                <button type="button" onClick={() => { clearRecent(); setRecent([]); }} className="flex items-center gap-1 text-xs text-text-muted hover:text-text" aria-label="Clear recent searches">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              </div>
              <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-3 pt-1">
                {recent.map((r, i) => <RecentTripCard key={`${r.from.id}-${r.to.id}`} r={r} first={i === 0} onPick={() => pickRecent(r)} />)}
              </div>
            </section>
          )}
        </div>

        {/* The search sheet: rises from the bottom on phones, sits beside on desktop. */}
        <section
          id="search-sheet"
          aria-label="Search buses"
          className="-mx-4 min-w-0 scroll-mt-20 bg-surface px-5 pb-6 pt-7 shadow-lg sheet-top sm:mx-0 sm:rounded-[32px] lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
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
                  <div key={o.code} className="flex items-center gap-4 rounded-[28px] bg-gradient-to-r from-accent to-accent/70 px-5 py-3.5 text-white shadow-md">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[17px]">{o.title}</div>
                      <div className="truncate text-[11px] text-white/85">
                        {o.description ? `${o.description} · ` : ''}till {formatDateLabel(localDateOf(o.validTo), { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    {o.couponCode && (
                      <button
                        type="button"
                        onClick={() => void copy(o.couponCode!)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-white/20 px-3 py-1.5 font-mono text-xs font-semibold hover:bg-white/30"
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
            <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
              {bannerItems.map((bn) => {
                const img = <img src={bn.imageUrl} alt={bn.title} loading="lazy" className="h-40 w-full rounded-card object-cover shadow-sm sm:h-44" />;
                return (
                  <div key={bn.id} className="w-[85%] shrink-0 snap-start sm:w-[60%]">
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
