import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Ticket, Phone, List, ChevronRight } from 'lucide-react';

import { Button, Card, CardBody, Input, Badge, statusTone, useToast, EmptyState, ErrorState, PageLoader } from '@/components/ui';
import { bookingsApi } from '@/lib/api/bookings';
import { useAuth } from '@/stores/auth';
import { formatDateTime, formatMoney, cn } from '@/lib/utils';
import { rememberManageMobile } from '@/lib/manageMobile';

type Mode = 'pnr' | 'mine';

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
      className={cn('flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium', mode === m ? 'border-primary bg-surface-muted text-text' : 'border-border text-text-muted')}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-text">My trips</h1>
      <p className="mb-6 text-sm text-text-muted">Download your ticket, change the date or seats, cancel, track your bus.</p>

      <div className="mb-4 flex gap-2">
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
        <div className="flex flex-col gap-3">
          {mine.data!.bookings.map((bk) => (
            <Link key={bk.id} to={`/bookings/${bk.id}/manage`}>
              <Card className="hover:border-primary/40">
                <CardBody className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-text">{bk.routeName ?? `PNR ${bk.pnr}`}</div>
                    <div className="text-xs text-text-muted">
                      {bk.departsAt ? `${formatDateTime(bk.departsAt)} · ` : ''}{bk.operatorName ? `${bk.operatorName} · ` : ''}PNR {bk.pnr} · {bk.seatCount} seat{bk.seatCount === 1 ? '' : 's'} · {formatMoney(bk.totalMinor, bk.currency)}
                    </div>
                  </div>
                  <span className="flex items-center gap-2"><Badge tone={statusTone(bk.status)}>{bk.status}</Badge><ChevronRight className="h-4 w-4 text-text-muted" /></span>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
