import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Copy, Mail, RotateCcw } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, ErrorState, Skeleton, useToast } from '@/components/ui';
import { QrCode } from '@/components/common/QrCode';
import { PrintTicketButton } from '@/components/customer/PrintTicketButton';
import { bookingsApi } from '@/lib/api/bookings';
import { resultsUrl } from '@/lib/search-filters';
import { useAuth } from '@/stores/auth';
import { useBooking } from '@/stores/booking';
import { SEAT_TYPE_LABEL, formatDateLabel, formatTime, localDateOf } from '@/lib/utils';

export function ConfirmationPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const b = useBooking();
  const signedIn = Boolean(useAuth((s) => s.token));
  // The booking's own mobile proves ownership for a guest; a signed-in customer needs nothing.
  const mobile = signedIn ? undefined : b.contactPhone || undefined;

  const tickets = useQuery({
    queryKey: ['tickets', b.bookingId],
    queryFn: () => bookingsApi.tickets(b.bookingId!, mobile),
    enabled: Boolean(b.bookingId),
    // The booking is confirmed by the payment call; tickets appear right after.
    retry: 2,
  });

  if (!b.bookingId || !b.pnr) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-text-muted">No recent booking to show.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => navigate('/')}>Book a trip</Button>
          <Button variant="outline" onClick={() => navigate('/account')}>My trips</Button>
        </div>
      </div>
    );
  }

  const trip = b.trip;
  const copyPnr = async () => {
    try { await navigator.clipboard.writeText(b.pnr!); toast.success('PNR copied'); } catch { /* clipboard blocked */ }
  };
  const bookAnother = () => { b.reset(); navigate('/'); };
  const bookReturn = () => {
    const r = b.pendingReturn!;
    b.setPendingReturn(undefined);
    b.reset();
    navigate(resultsUrl(r.fromLabel, r.toLabel, r.date));
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <CheckCircle2 className="h-9 w-9 text-success" />
        <div>
          <h1 className="text-2xl font-semibold text-text">Booking confirmed</h1>
          <p className="flex items-center gap-2 text-sm text-text-muted">
            PNR <b className="text-text">{b.pnr}</b>
            <button type="button" onClick={() => void copyPnr()} aria-label="Copy PNR" className="rounded p-0.5 hover:bg-surface-muted"><Copy className="h-3.5 w-3.5" /></button>
          </p>
        </div>
      </div>

      {b.pendingReturn && (
        <Card className="mb-4 border-primary/40">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold text-text">Now book your return</div>
              <div className="text-text-muted">{b.pendingReturn.fromLabel} → {b.pendingReturn.toLabel} · {formatDateLabel(b.pendingReturn.date)}</div>
            </div>
            <Button onClick={bookReturn} rightIcon={<ArrowRight className="h-4 w-4" />}>Find return buses</Button>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Card className="md:col-span-3">
          <CardHeader title={trip?.operatorName ?? 'Your journey'} subtitle={trip ? `${formatDateLabel(localDateOf(trip.departsAt), { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })} · ${SEAT_TYPE_LABEL[b.seatType ?? ''] ?? ''}` : undefined} />
          <CardBody className="flex flex-col gap-3 text-sm">
            {b.points && (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
                <b>{formatTime(b.points.fromAt)}</b><span>{b.points.from} <span className="text-text-muted">(boarding)</span></span>
                <b>{formatTime(b.points.toAt)}</b><span>{b.points.to} <span className="text-text-muted">(dropping)</span></span>
              </div>
            )}
            <div className="border-t border-border pt-3">
              {b.passengers.map((p) => (
                <div key={p.seatNumber} className="flex justify-between py-0.5">
                  <span>{p.fullName}{p.age ? `, ${p.age}` : ''}{p.gender ? ` ${p.gender[0].toUpperCase()}` : ''}</span>
                  <span className="font-medium">Seat {p.seatNumber}</span>
                </div>
              ))}
            </div>
            {b.contactEmail ? (
              <p className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-xs text-text-muted"><Mail className="h-3.5 w-3.5" /> Ticket and GST invoice are emailed to {b.contactEmail}</p>
            ) : (
              <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-text-muted">No email given — save or print your ticket below. Updates come by SMS to {b.contactPhone}.</p>
            )}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader title="Boarding pass" subtitle="Show this QR to the conductor" />
          <CardBody className="flex flex-col items-center gap-3">
            {tickets.isLoading ? <Skeleton className="h-44 w-44" /> : tickets.isError ? (
              <ErrorState error={tickets.error} onRetry={tickets.refetch} />
            ) : tickets.data ? (
              <QrCode value={tickets.data.bookingQrToken} label={`Boarding QR for PNR ${b.pnr}`} />
            ) : null}
            <PrintTicketButton bookingId={b.bookingId} mobile={mobile} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="outline" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={bookAnother}>Book another trip</Button>
        <Button onClick={() => navigate('/account')}>My trips</Button>
      </div>
    </div>
  );
}
