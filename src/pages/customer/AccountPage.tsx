import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Ticket, Phone, List, ChevronRight } from 'lucide-react';

import { Button, Card, CardBody, Input, Badge, statusTone, useToast, EmptyState, ErrorState, PageLoader } from '@/components/ui';
import { bookingsApi } from '@/lib/api/bookings';
import { useAuth } from '@/stores/auth';
import { formatMoney, formatTime, cn } from '@/lib/utils';
import type { Booking } from '@/lib/api/types';
import { rememberManageMobile } from '@/lib/manageMobile';

type Mode = 'pnr' | 'mine';

const INACTIVE = new Set(['cancelled', 'expired', 'refunded', 'failed']);
/** Upcoming trips (soonest first), then past and cancelled ones (latest first). */
function splitTrips(list: Booking[]): [string, Booking[]][] {
  const now = Date.now();
  const at = (b: Booking) => (b.departsAt ? Date.parse(b.departsAt) : 0);
  const upcoming = list.filter((b) => at(b) >= now && !INACTIVE.has(b.status)).sort((x, y) => at(x) - at(y));
  const rest = list.filter((b) => !upcoming.includes(b)).sort((x, y) => at(y) - at(x));
  return [['Upcoming', upcoming], ['Past & cancelled', rest]];
}

/** One trip: a date block (month, big day) and the journey with its ring dots. */
function TripRow({ bk, highlight }: { bk: Booking; highlight: boolean }) {
  const d = bk.departsAt ? new Date(bk.departsAt) : null;
  const month = d ? new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' }).format(d) : '';
  const day = d ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' }).format(d) : '—';
  const [from, to] = bk.fromName && bk.toName ? [bk.fromName, bk.toName] : (bk.routeName ?? '').split(/\s*(?:→|->|-)\s*/);
  return (
    <Link to={`/bookings/${bk.id}/manage`} className="block">
      <div className={cn('flex items-stretch gap-4 rounded-[20px] p-3 pr-4 transition hover:-translate-y-0.5', highlight ? 'bg-surface shadow-md' : 'bg-surface shadow-sm')}>
        <div className={cn('flex w-[68px] shrink-0 flex-col items-center justify-center rounded-2xl', highlight ? 'bg-accent text-white' : 'bg-surface-muted text-text')}>
          <span className={cn('text-[11px] font-semibold', !highlight && 'text-text-muted')}>{month}</span>
          <span className="font-display text-[28px] leading-none">{day}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-text"><span className="dot-from !h-2.5 !w-2.5" /><span className="truncate">{from || `PNR ${bk.pnr}`}</span></span>
          {to && <span className="flex items-center gap-2 text-sm font-semibold text-text"><span className="dot-to !h-2.5 !w-2.5" /><span className="truncate">{to}</span></span>}
          <span className="truncate text-[11px] text-text-muted">
            {d ? `${formatTime(bk.departsAt!)} · ` : ''}{bk.operatorName ? `${bk.operatorName} · ` : ''}PNR {bk.pnr} · {bk.seatCount} seat{bk.seatCount === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between py-1">
          <Badge tone={statusTone(bk.status)}>{bk.status}</Badge>
          <span className="flex items-center gap-1 font-display text-base text-price">{formatMoney(bk.totalMinor, bk.currency)}<ChevronRight className="h-4 w-4 text-text-muted" /></span>
        </div>
      </div>
    </Link>
  );
}

/**
 * "My trips": find one booking by PNR + the mobile it was booked with, or —
 * signed in — every trip booked from this account. Each opens Manage booking.
 */
export function AccountPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const signedIn = useAuth((s) => !!s.token);
  const [mode, setMode] = useState<Mode>(signedIn ? 'mine' : 'pnr');
  const [pnr, setPnr] = useState('');
  const [mobile, setMobile] = useState('');
  const [tried, setTried] = useState(false);

  const errors = {
    pnr: pnr.trim().length < 4 ? 'Enter the PNR from your ticket' : undefined,
    mobile: mobile.replace(/\D/g, '').length < 10 ? 'Enter the 10-digit mobile number' : undefined,
  };
  // PNR + mobile → one booking (the mobile disambiguates across operators AND proves it is yours).
  const lookup = useMutation({
    mutationFn: () => bookingsApi.getByPnr(pnr.trim().toUpperCase(), mobile.trim()),
    onSuccess: ({ booking }) => {
      rememberManageMobile(booking.id, mobile.trim());
      navigate(`/bookings/${booking.id}/manage`, { state: { mobile: mobile.trim() } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Booking not found — check the PNR and mobile number'),
  });
  const mine = useQuery({ queryKey: ['my-bookings'], queryFn: bookingsApi.mine, enabled: signedIn && mode === 'mine' });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!errors.pnr && !errors.mobile && !lookup.isPending) lookup.mutate();
  };

  const tab = (m: Mode, label: string, Icon: typeof Ticket) => (
    <button type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
      className={cn('flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-xs font-semibold transition', mode === m ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text')}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <h1 className="mb-1 font-display text-3xl text-text">My trips</h1>
      <p className="mb-6 text-sm text-text-muted">Download your ticket, change the date or seats, cancel, track your bus.</p>

      <div className="mb-5 inline-flex gap-1 rounded-pill bg-surface-muted p-1">
        {tab('mine', 'All my bookings', List)}
        {tab('pnr', 'Find by PNR', Ticket)}
      </div>

      {mode === 'pnr' ? (
        <Card>
          <CardBody>
            <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1"><Input label="PNR" placeholder="e.g. YB12AB" value={pnr} error={tried ? errors.pnr : undefined} onChange={(e) => setPnr(e.target.value)} leftIcon={<Ticket className="h-4 w-4" />} /></div>
              <div className="flex-1"><Input label="Mobile number" placeholder="98…" value={mobile} error={tried ? errors.mobile : undefined} onChange={(e) => setMobile(e.target.value)} leftIcon={<Phone className="h-4 w-4" />} /></div>
              <Button type="submit" className="sm:mt-6" loading={lookup.isPending} disabled={lookup.isPending} leftIcon={<Search className="h-4 w-4" />}>Find</Button>
            </form>
            <p className="mt-2 text-xs text-text-muted">The mobile number it was booked with — this confirms the booking is yours.</p>
          </CardBody>
        </Card>
      ) : !signedIn ? (
        <EmptyState title="Sign in to see all your trips" description="Or find one booking by its PNR and mobile number." icon={<List className="h-10 w-10" />}
          action={<div className="flex gap-2"><Link to="/login?next=/account"><Button>Sign in</Button></Link><Button variant="outline" onClick={() => setMode('pnr')}>Find by PNR</Button></div>} />
      ) : mine.isLoading ? <PageLoader /> : mine.isError ? <ErrorState error={mine.error} onRetry={mine.refetch} /> : (mine.data?.bookings.length ?? 0) === 0 ? (
        <EmptyState title="No trips yet" description="Bookings made while signed in show up here." icon={<List className="h-10 w-10" />} action={<Link to="/"><Button>Book a bus</Button></Link>} />
      ) : (
        <div className="flex flex-col gap-6">
          {splitTrips(mine.data!.bookings).map(([title, list]) => list.length > 0 && (
            <section key={title}>
              <h2 className="mb-3 font-display text-lg text-text">{title}</h2>
              <div className="flex flex-col gap-3">
                {list.map((bk, i) => <TripRow key={bk.id} bk={bk} highlight={title === 'Upcoming' && i === 0} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
