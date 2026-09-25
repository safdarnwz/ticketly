import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, Ticket, ExternalLink, ShieldCheck, Phone, List, XCircle } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, Badge, statusTone, useToast, EmptyState, Modal } from '@/components/ui';
import { bookingsApi } from '@/lib/api/bookings';
import { LiveTrackingCard } from '@/components/customer/LiveTrackingCard';
import { useBooking } from '@/stores/booking';
import type { Booking, Ticket as T } from '@/lib/api/types';
import { formatMoney, cn } from '@/lib/utils';

type Mode = 'pnr' | 'mobile';
/** Statuses a customer can still self-cancel from — matches isCancellable() on the backend. */
const CANCELLABLE = new Set(['held', 'confirmed']);

export function AccountPage() {
  const toast = useToast();
  const setViewedBookingTenant = useBooking((s) => s.setViewedBookingTenant);

  const [mode, setMode] = useState<Mode>('pnr');
  const [pnr, setPnr] = useState('');
  const [mobile, setMobile] = useState('');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [seats, setSeats] = useState<string[]>([]);
  const [tickets, setTickets] = useState<T[]>([]);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [lookupMobile, setLookupMobile] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // PNR + mobile → one specific booking (mobile disambiguates AND proves ownership —
  // PNR alone isn't globally unique since every operator mints its own).
  const lookupByPnr = useMutation({
    mutationFn: async () => {
      const { booking: bk, seats: st } = await bookingsApi.getByPnr(pnr.trim().toUpperCase(), mobile.trim());
      setViewedBookingTenant(bk.tenantId);
      const tk = await bookingsApi.tickets(bk.id).catch(() => ({ pnr: bk.pnr, tickets: [] as T[] }));
      return { bk, st, tk };
    },
    onSuccess: ({ bk, st, tk }) => { setBooking(bk); setSeats(st); setTickets(tk.tickets ?? []); setBookings(null); setLookupMobile(mobile.trim()); },
    onError: (e) => { setBooking(null); toast.error(e instanceof Error ? e.message : 'Booking not found — check the PNR and mobile number'); },
  });

  // Mobile only → every booking across every operator for that number.
  const lookupByMobile = useMutation({
    mutationFn: () => bookingsApi.mine(mobile.trim()),
    onSuccess: (res) => { setBookings(res.bookings); setBooking(null); setLookupMobile(mobile.trim()); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not load bookings'),
  });

  const openOne = async (bk: Booking) => {
    setViewedBookingTenant(bk.tenantId);
    const tk = await bookingsApi.tickets(bk.id).catch(() => ({ pnr: bk.pnr, tickets: [] as T[] }));
    setBooking(bk); setSeats([]); setTickets(tk.tickets ?? []); setBookings(null); setLookupMobile(mobile.trim());
  };

  const cancelInFlight = useRef(false);
  const cancelBooking = useMutation({
    mutationFn: () => bookingsApi.selfCancel(booking!.id, lookupMobile, cancelReason || undefined),
    onSuccess: (res) => {
      toast.success(res.refundMinor > 0 ? `Cancelled — ₹${(res.refundMinor / 100).toFixed(2)} will be refunded` : 'Cancelled');
      setBooking((b) => (b ? { ...b, status: 'cancelled' } : b));
      setCancelling(false); setCancelReason(''); cancelInFlight.current = false;
    },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Could not cancel — please contact support'); cancelInFlight.current = false; },
  });
  const handleCancelBooking = () => {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    cancelBooking.mutate();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'pnr' && pnr.trim() && mobile.trim()) lookupByPnr.mutate();
    if (mode === 'mobile' && mobile.trim()) lookupByMobile.mutate();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-text">My trips</h1>
      <p className="mb-6 text-sm text-text-muted">Find your booking by PNR, or see every trip booked with your mobile number.</p>

      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setMode('pnr')}
          className={cn('flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium', mode === 'pnr' ? 'border-primary bg-surface-muted text-text' : 'border-border text-text-muted')}>
          <Ticket className="h-3.5 w-3.5" /> By PNR
        </button>
        <button type="button" onClick={() => setMode('mobile')}
          className={cn('flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium', mode === 'mobile' ? 'border-primary bg-surface-muted text-text' : 'border-border text-text-muted')}>
          <List className="h-3.5 w-3.5" /> All my bookings
        </button>
      </div>

      <Card className="mb-6">
        <CardBody>
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {mode === 'pnr' && (
              <div className="flex-1"><Input label="PNR" placeholder="e.g. YB12AB" value={pnr} onChange={(e) => setPnr(e.target.value)} leftIcon={<Ticket className="h-4 w-4" />} /></div>
            )}
            <div className="flex-1"><Input label="Mobile number" placeholder="+9198…" value={mobile} onChange={(e) => setMobile(e.target.value)} leftIcon={<Phone className="h-4 w-4" />} /></div>
            <Button type="submit" loading={lookupByPnr.isPending || lookupByMobile.isPending} leftIcon={<Search className="h-4 w-4" />}>Find</Button>
          </form>
          {mode === 'pnr' && <p className="mt-2 text-xs text-text-muted">Both PNR and mobile are required — this also confirms the booking is yours.</p>}
        </CardBody>
      </Card>

      {/* Mobile-only mode: list of every booking */}
      {bookings && (
        bookings.length > 0 ? (
          <div className="flex flex-col gap-3">
            {bookings.map((bk) => (
              <Card key={bk.id} className="cursor-pointer hover:border-primary/40" onClick={() => void openOne(bk)}>
                <CardBody className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-text">PNR {bk.pnr}</div>
                    <div className="text-xs text-text-muted">{bk.seatCount} seat(s) · {formatMoney(bk.totalMinor, bk.currency)}</div>
                  </div>
                  <Badge tone={statusTone(bk.status)}>{bk.status}</Badge>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No bookings found" description="No trips are linked to this mobile number." icon={<List className="h-10 w-10" />} />
        )
      )}

      {/* Single-booking detail (from either mode) */}
      {booking && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={`PNR ${booking.pnr}`}
              subtitle={<Badge tone={statusTone(booking.status)}>{booking.status}</Badge>}
              action={<a href={bookingsApi.ticketHtmlUrl(booking.id)} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" leftIcon={<ExternalLink className="h-4 w-4" />}>Print</Button></a>}
            />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between"><span className="text-text-muted">Seats</span><span className="font-medium">{seats.length > 0 ? seats.join(', ') : booking.seatCount}</span></div>
              <div className="flex justify-between"><span className="text-text-muted">Total</span><span className="font-medium">{formatMoney(booking.totalMinor, booking.currency)}</span></div>
              {tickets.length > 0 && (
                <div className="mt-2 flex flex-col gap-2">
                  {tickets.map((t) => (
                    <div key={t.seat} className="flex items-center justify-between rounded-md border border-border p-2.5">
                      <span className="flex items-center gap-2 font-medium text-text"><ShieldCheck className="h-4 w-4 text-success" /> Seat {t.seat}</span>
                      <code className="max-w-[55%] truncate rounded bg-surface-muted px-2 py-1 text-[11px]">{t.boardingToken}</code>
                    </div>
                  ))}
                </div>
              )}
              {CANCELLABLE.has(booking.status) && (
                <Button variant="outline" className="mt-2 self-start text-danger" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => setCancelling(true)}>
                  Cancel booking
                </Button>
              )}
            </CardBody>
          </Card>

          {(booking.status === 'confirmed' || booking.status === 'completed') && <LiveTrackingCard tripId={booking.tripId} />}
        </div>
      )}

      <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel this booking?"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>Keep booking</Button>
            <Button variant="danger" loading={cancelBooking.isPending} onClick={handleCancelBooking}>Confirm cancellation</Button>
          </>
        )}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Your refund amount depends on how close to departure you are — the operator cancellation policy applies.</p>
          <Input label="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Change of plans" />
        </div>
      </Modal>

      {!booking && !bookings && (
        <EmptyState title={mode === 'pnr' ? 'Enter your PNR + mobile' : 'Enter your mobile number'} description="Your PNR is in your confirmation email." icon={<Ticket className="h-10 w-10" />} />
      )}
    </div>
  );
}
