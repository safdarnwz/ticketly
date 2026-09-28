import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, LifeBuoy, MapPin, Armchair, PencilLine, Star, XCircle, Phone, Mail } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Modal, PageLoader, Select, statusTone, useToast } from '@/components/ui';
import { CancelBookingModal } from '@/components/booking/CancelBookingModal';
import { LiveTrackingCard } from '@/components/customer/LiveTrackingCard';
import { LuggageNote } from '@/components/customer/LuggageNote';
import { PrintTicketButton } from '@/components/customer/PrintTicketButton';
import { BookingChangeModal, type ChangeKind } from '@/pages/bookings/BookingChanges';
import { bookingsApi, type ManagedBooking } from '@/lib/api/bookings';
import { REVIEW_ASPECTS, reviewsApi, supportApi } from '@/lib/api/content';
import { useAuth } from '@/stores/auth';
import { useBooking } from '@/stores/booking';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { recalledMobile, rememberManageMobile } from '@/lib/manageMobile';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
type Dialog = ChangeKind | 'cancel' | 'review' | 'help' | null;

/**
 * The customer's "Manage booking": the journey and travellers, the e-ticket,
 * and every change they may make themselves — another date, other seats,
 * another boarding / drop point, a name spelling, cancelling some or all
 * seats — plus live tracking, a review after the trip and help. The backend
 * decides what is still allowed; its message is shown when a change is refused.
 */
export function ManageBookingPage() {
  const { id = '' } = useParams();
  const location = useLocation() as { state?: { mobile?: string } };
  const qc = useQueryClient();
  const signedIn = useAuth((s) => !!s.token);
  const setViewedBookingTenant = useBooking((s) => s.setViewedBookingTenant);
  const [mobile, setMobile] = useState<string | undefined>(() => location.state?.mobile ?? recalledMobile(id));
  const [dialog, setDialog] = useState<Dialog>(null);

  const q = useQuery({ queryKey: ['manage-booking', id, mobile], queryFn: () => bookingsApi.manage(id, mobile), retry: false });
  const b = q.data;
  useEffect(() => { if (b) setViewedBookingTenant(b.tenantId); }, [b, setViewedBookingTenant]);
  const refresh = () => { setDialog(null); void qc.invalidateQueries({ queryKey: ['manage-booking', id] }); };

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !b) return <ProveIt error={q.error} onMobile={(m) => { rememberManageMobile(id, m); setMobile(m); }} />;

  const boardsAt = b.boardsAt ?? b.departsAt;
  const upcoming = new Date(boardsAt).getTime() > Date.now();
  const changeable = b.status === 'confirmed' && upcoming && ['open', 'scheduled'].includes(b.tripStatus);
  const travelled = b.status === 'completed' || (b.status === 'confirmed' && ['departed', 'closed', 'completed'].includes(b.tripStatus));
  const seats = b.passengers.map((p) => p.seatNumber);
  const changeProps = {
    bookingId: b.id, pnr: b.pnr, tripId: b.tripId, seats, passengers: b.passengers,
    customer: { leg: { fromSeq: b.fromSeq, toSeq: b.toSeq }, tenantId: b.tenantId, mobile },
    onClose: () => setDialog(null), onDone: refresh,
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <Card>
        <CardHeader
          title={b.routeName}
          subtitle={<span className="flex flex-wrap items-center gap-2">PNR <b className="font-mono">{b.pnr}</b> · {b.operatorName} <Badge tone={statusTone(b.status)}>{b.status}</Badge></span>}
          action={b.status !== 'cancelled' ? <PrintTicketButton bookingId={b.id} mobile={mobile} label="Download ticket" /> : undefined}
        />
        <CardBody className="flex flex-col gap-4 text-sm">
          {/* The journey with the pink "from" and purple "to" ring dots. */}
          <div className="flex gap-3 rounded-2xl bg-surface-muted p-4">
            <div className="flex flex-col items-center py-1"><span className="dot-from" /><span className="dot-line my-1 flex-1" /><span className="dot-to" /></div>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div>
                <div className="text-xs text-text-muted">Boarding</div>
                <div className="font-semibold text-text">{b.boardingPoint ?? '—'}</div>
                <div className="text-text-muted">{formatDateTime(boardsAt)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Drop</div>
                <div className="font-semibold text-text">{b.droppingPoint ?? '—'}</div>
                <div className="text-text-muted">{b.dropsAt ? formatDateTime(b.dropsAt) : formatDateTime(b.arrivesAt)}</div>
              </div>
            </div>
          </div>
          <div className="flex items-baseline justify-between"><span className="text-text-muted">Fare{b.status === 'cancelled' ? '' : ` · ${b.passengers.length} seat${b.passengers.length === 1 ? '' : 's'}`}</span><span className="font-display text-xl text-price">{formatMoney(b.totalMinor, b.currency)}</span></div>
        </CardBody>
      </Card>

      <LuggageNote tripId={b.tripId} tenantId={b.tenantId} />

      <Card>
        <CardHeader title="Travellers" subtitle={`${b.passengers.length} seat${b.passengers.length === 1 ? '' : 's'}`} />
        <CardBody className="flex flex-col divide-y divide-border p-0">
          {b.passengers.map((p) => (
            <div key={p.seatNumber} className="flex items-center justify-between px-4 py-3 text-sm">
              <span><b>Seat {p.seatNumber}</b> · {p.fullName}{p.age != null ? `, ${p.age}` : ''}{p.gender ? ` ${p.gender[0].toUpperCase()}` : ''}</span>
              {p.ticketStatus && <Badge tone={p.ticketStatus === 'valid' ? 'success' : p.ticketStatus === 'boarded' ? 'info' : 'neutral'}>{p.ticketStatus === 'valid' ? 'ticket valid' : p.ticketStatus}</Badge>}
            </div>
          ))}
        </CardBody>
      </Card>

      {b.status === 'cancelled' ? (
        <Card><CardBody className="text-sm text-text-muted">This booking is cancelled. Any refund goes back to how you paid; it shows in your account within 5–7 working days.</CardBody></Card>
      ) : changeable ? (
        <Card>
          <CardHeader title="Change your booking" subtitle="Changes close shortly before boarding; the operator's rules apply" />
          <CardBody className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => setDialog('reschedule')}>Change travel date</Button>
            <Button variant="outline" leftIcon={<Armchair className="h-4 w-4" />} onClick={() => setDialog('seats')}>Change seats</Button>
            <Button variant="outline" leftIcon={<MapPin className="h-4 w-4" />} onClick={() => setDialog('points')}>Change boarding / drop point</Button>
            <Button variant="outline" leftIcon={<PencilLine className="h-4 w-4" />} onClick={() => setDialog('name')}>Correct a name</Button>
            <Button variant="outline" className="text-danger sm:col-span-2" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => setDialog('cancel')}>{seats.length > 1 ? 'Cancel seats or the whole booking' : 'Cancel booking'}</Button>
          </CardBody>
        </Card>
      ) : b.status === 'confirmed' && !travelled ? (
        <Card><CardBody className="text-sm text-text-muted">Boarding time has passed — changes and cancellation are closed. Call the operator if you need help.</CardBody></Card>
      ) : null}

      {(b.status === 'confirmed' || b.status === 'completed') && <LiveTrackingCard tripId={b.tripId} />}

      <Card>
        <CardHeader title="Need help?" />
        <CardBody className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-4 text-text-muted">
            {b.operatorPhone && <a href={`tel:${b.operatorPhone}`} className="flex items-center gap-1 text-text"><Phone className="h-4 w-4" /> {b.operatorPhone}</a>}
            {b.operatorEmail && <a href={`mailto:${b.operatorEmail}`} className="flex items-center gap-1 text-text"><Mail className="h-4 w-4" /> {b.operatorEmail}</a>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" leftIcon={<LifeBuoy className="h-4 w-4" />} disabled={!signedIn} title={signedIn ? undefined : 'Sign in to the account you booked with'} onClick={() => setDialog('help')}>Write to support</Button>
            {travelled && <Button variant="outline" leftIcon={<Star className="h-4 w-4" />} disabled={!signedIn} title={signedIn ? undefined : 'Sign in to the account you booked with'} onClick={() => setDialog('review')}>Rate this trip</Button>}
          </div>
          {!signedIn && <p className="text-xs text-text-muted">Sign in with the account you booked from to write to support{travelled ? ' or leave a review' : ''}.</p>}
        </CardBody>
      </Card>

      {dialog && ['seats', 'points', 'name', 'reschedule'].includes(dialog) && <BookingChangeModal kind={dialog as ChangeKind} {...changeProps} />}
      {dialog === 'cancel' && (
        <CancelBookingModal bookingId={b.id} currency={b.currency} seats={seats} passengers={b.passengers}
          customer={{ contactPhone: b.contactPhone ?? mobile ?? '' }} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === 'review' && <ReviewModal booking={b} onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpModal booking={b} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Not signed in to the booking's account and no (or a wrong) mobile: ask for the booking mobile. */
function ProveIt({ error, onMobile }: { error: unknown; onMobile: (m: string) => void }) {
  const [m, setM] = useState('');
  const [tried, setTried] = useState(false);
  const bad = m.replace(/\D/g, '').length < 10;
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Link to="/account" className="mb-4 flex items-center gap-1 text-sm text-text-muted"><ArrowLeft className="h-4 w-4" /> My trips</Link>
      <EmptyState title="Confirm it is your booking" description={error ? errText(error, 'Booking not found') + ' — enter the mobile number it was booked with.' : 'Enter the mobile number it was booked with.'} />
      <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setTried(true); if (!bad) onMobile(m.trim()); }}>
        <div className="flex-1"><Input label="Mobile number" value={m} onChange={(e) => setM(e.target.value)} error={tried && bad ? 'Enter the 10-digit mobile number' : undefined} /></div>
        <Button type="submit">Open booking</Button>
      </form>
    </div>
  );
}

function ReviewModal({ booking, onClose }: { booking: ManagedBooking; onClose: () => void }) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [liked, setLiked] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const go = useMutation({
    mutationFn: () => reviewsApi.create(booking.id, rating, title.trim() || undefined, body.trim() || undefined, liked),
    onSuccess: () => { toast.success('Thanks — your review is published'); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not save your review')),
  });
  return (
    <Modal open onClose={onClose} title={`Rate ${booking.routeName}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={go.isPending} onClick={() => { setTried(true); if (rating) go.mutate(); }}>Publish review</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <div role="radiogroup" aria-label="Stars" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => setRating(n)}>
              <Star className={`h-7 w-7 ${n <= rating ? 'fill-warning text-warning' : 'text-border'}`} />
            </button>
          ))}
        </div>
        {tried && !rating && <p role="alert" className="text-xs text-danger">Choose 1 to 5 stars</p>}
        <div>
          <div className="mb-1.5 font-medium text-text">What did you like about this bus? <span className="font-normal text-text-muted">(optional)</span></div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="What you liked">
            {REVIEW_ASPECTS.map((a) => {
              const on = liked.includes(a.value);
              return (
                <button key={a.value} type="button" aria-pressed={on} onClick={() => setLiked(on ? liked.filter((x) => x !== a.value) : [...liked, a.value])}
                  className={`rounded-pill border px-3 py-1 text-xs font-medium ${on ? 'border-success bg-success/10 text-success' : 'border-border text-text'}`}>{a.label}</button>
              );
            })}
          </div>
        </div>
        <Input label="Title (optional)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <Input label="Your experience (optional)" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="Bus, staff, punctuality…" />
      </div>
    </Modal>
  );
}

const HELP_TOPICS = [
  { value: 'booking', label: 'My booking' },
  { value: 'refund', label: 'Refund' },
  { value: 'payment', label: 'Payment' },
  { value: 'general', label: 'Something else' },
];

function HelpModal({ booking, onClose }: { booking: ManagedBooking; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ category: 'booking', subject: '', body: '' });
  const [tried, setTried] = useState(false);
  const errors = {
    subject: f.subject.trim().length < 3 ? 'At least 3 characters' : undefined,
    body: f.body.trim().length < 5 ? 'Describe the problem in a few words' : undefined,
  };
  const go = useMutation({
    mutationFn: () => supportApi.open({ bookingId: booking.id, category: f.category, subject: f.subject.trim(), body: f.body.trim() }),
    onSuccess: () => { toast.success(`Sent to ${booking.operatorName} — they reply by email and SMS`); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not send')),
  });
  return (
    <Modal open onClose={onClose} title={`Write to ${booking.operatorName}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button loading={go.isPending} disabled={go.isPending} onClick={() => { setTried(true); if (!errors.subject && !errors.body) go.mutate(); }}>Send</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <Select label="About" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={HELP_TOPICS} />
        <Input label="Subject" value={f.subject} maxLength={160} error={tried ? errors.subject : undefined} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        <Input label="Message" value={f.body} maxLength={4000} error={tried ? errors.body : undefined} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={`PNR ${booking.pnr} — what happened?`} />
      </div>
    </Modal>
  );
}
