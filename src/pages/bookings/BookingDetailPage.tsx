import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, Mail, MailWarning, Send, ShieldCheck, Ticket, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, PageLoader, statusTone, useToast } from '@/components/ui';
import { CancelBookingModal } from '@/components/booking/CancelBookingModal';
import { amendmentsApi } from '@/lib/api/amendments';
import { BookingChangeModal, type ChangeKind } from './BookingChanges';
import { PageHeader } from '@/components/common/PageHeader';
import { PrintTicketButton } from '@/components/customer/PrintTicketButton';
import { bookingsApi } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/client';
import { openRazorpayCheckout, paymentsApi } from '@/lib/api/payments';
import { refundsApi } from '@/lib/api/ops';
import { isEmail } from '@/lib/checkout';
import { formatMoney, formatTime, formatDateLabel, localDateOf } from '@/lib/utils';

const CHANNEL_LABEL: Record<string, string> = { direct_web: 'Website', direct_app: 'Mobile app', ota: 'OTA partner', backoffice: 'Counter', phone: 'Phone booking', agent: 'Travel agent' };
const dt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const errText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * One booking for the operator's staff: journey, passengers, contact, tickets
 * (print, verify, upgrade), the e-ticket / invoice emails (with re-send),
 * refunds and GST invoices — and cancelling all or some seats, with the
 * refund shown before anything is done.
 */
export function BookingDetailPage() {
  const { pnr = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [upgrading, setUpgrading] = useState<{ ticketId: string; seat: string } | null>(null);
  const [toSeat, setToSeat] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [changing, setChanging] = useState<ChangeKind | null>(null);
  const upgradeInFlight = useRef(false);

  const q = useQuery({ queryKey: ['booking', pnr], queryFn: () => bookingsApi.byPnrStaff(pnr), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  const b = q.data?.booking;
  const id = b?.id;
  const confirmed = b ? ['confirmed', 'completed'].includes(b.status) : false;
  const tickets = useQuery({ queryKey: ['tickets', id], queryFn: () => bookingsApi.tickets(id!), enabled: Boolean(id) && confirmed });
  const invoices = useQuery({ queryKey: ['invoices', id], queryFn: () => bookingsApi.invoices(id!), enabled: Boolean(id) });
  const refunds = useQuery({ queryKey: ['refunds', id], queryFn: () => refundsApi.forBooking(id!), enabled: Boolean(id) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['booking', pnr] });
    void qc.invalidateQueries({ queryKey: ['refunds', id] });
    void qc.invalidateQueries({ queryKey: ['invoices', id] });
    void qc.invalidateQueries({ queryKey: ['staff-bookings'] });
  };

  const upgrade = useMutation({
    mutationFn: async () => {
      // The seat moves only after the gateway confirms the difference was paid.
      const r = await paymentsApi.upgradeSeat(upgrading!.ticketId, toSeat.trim());
      await openRazorpayCheckout(r.clientPayload);
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Paid ${formatMoney(r.differentialMinor, b?.currency)} extra — the new seat shows once the payment is confirmed.`);
      setUpgrading(null); setToSeat(''); void qc.invalidateQueries({ queryKey: ['tickets', id] });
    },
    onError: (e) => toast.error(errText(e, 'Upgrade failed')),
    onSettled: () => { upgradeInFlight.current = false; },
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return notFound
      ? <EmptyState title={`No booking ${pnr.toUpperCase()}`} description="Check the PNR — it may belong to another operator." action={<Link to="/bookings"><Button variant="outline">All bookings</Button></Link>} />
      : <ErrorState error={q.error} onRetry={q.refetch} />;
  }
  const { detail: d, passengers, emails } = q.data!;
  const booking = b!;
  const cancellable = ['held', 'confirmed'].includes(booking.status);
  const status = d?.liveHold ? 'paying now' : d?.status ?? booking.status;

  return (
    <>
      <PageHeader
        title={`PNR ${booking.pnr}`}
        subtitle={d ? `${d.routeName} · ${d.journeyDate} · departs ${formatTime(d.departsAt)}` : undefined}
        action={
          <div className="flex gap-2">
            {confirmed && <Button variant="outline" leftIcon={<Send className="h-4 w-4" />} onClick={() => setResendOpen(true)}>Resend e-ticket</Button>}
            {d && booking.status === 'confirmed' && new Date(d.departsAt).getTime() > Date.now() && (
              <select aria-label="Change booking" value="" onChange={(e) => setChanging(e.target.value as ChangeKind)} className="h-10 rounded-md border border-border bg-surface px-2 text-sm">
                <option value="">Change…</option>
                <option value="seats">Seats (same bus)</option>
                <option value="points">Boarding / drop point</option>
                <option value="name">Name spelling</option>
                <option value="reschedule">Date / bus</option>
              </select>
            )}
            {d && booking.status === 'held' && d.channel === 'phone' && d.liveHold && <Button onClick={() => setPayOpen(true)}>Take UPI payment</Button>}
            {d && booking.status === 'held' && d.channel === 'phone' && d.liveHold && <Button variant="outline" onClick={() => setChanging('hold')}>Release time…</Button>}
            {cancellable && <Button variant="danger" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>Cancel…</Button>}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Overview" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <Row label="Status"><Badge tone={d?.liveHold ? 'warning' : statusTone(booking.status)}>{status}</Badge></Row>
            {d && <Row label="Booked">{dt(d.createdAt)}</Row>}
            {d && <Row label="Channel">{CHANNEL_LABEL[d.channel] ?? d.channel}</Row>}
            {d?.agentName && <Row label="Sold by agent">{d.agentName}</Row>}
            {d?.noShowSeats?.length ? <Row label="No-show"><Badge tone="danger">{d.noShowSeats.join(', ')}</Badge></Row> : null}
            <Row label="Seats">{d?.seats.join(', ') || booking.seatCount}</Row>
            <Row label="Total">{formatMoney(booking.totalMinor, booking.currency)}</Row>
            <Row label="Paid">{formatMoney(booking.paidMinor, booking.currency)}</Row>
            {d?.cancelledAt && <Row label="Cancelled">{dt(d.cancelledAt)}</Row>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Journey" action={d ? <Link className="text-sm text-primary hover:underline" to={`/bookings?tripId=${d.tripId}&basis=journey&from=${d.journeyDate}&to=${d.journeyDate}&route=${encodeURIComponent(`${d.routeName} ${formatTime(d.departsAt)}`)}`}>Bus bookings</Link> : null} />
          <CardBody className="flex flex-col gap-3 text-sm">
            {d ? (
              <>
                <Row label="Boarding">{d.fromName ?? '—'}</Row>
                <Row label="Dropping">{d.toName ?? '—'}</Row>
                <Row label="Date">{d.journeyDate}</Row>
                <Row label="Bus departs">{formatTime(d.departsAt)}</Row>
              </>
            ) : <p className="text-text-muted">Journey details unavailable.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <Row label="Mobile">{d?.contactPhone ? <a className="text-primary" href={`tel:${d.contactPhone}`}>{d.contactPhone}</a> : '—'}</Row>
            <Row label="Email">{d?.contactEmail ?? '—'}</Row>
            <Row label="E-ticket email"><EmailStatus status={emails.eticket} /></Row>
            <Row label="Invoice email"><EmailStatus status={emails.invoice} /></Row>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Passengers" />
          <CardBody>
            {passengers.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-text-muted"><th className="py-2">Seat</th><th>Name</th><th>Age</th><th>Gender</th></tr></thead>
                  <tbody>
                    {passengers.map((p) => (
                      <tr key={p.seatNumber} className="border-t border-border">
                        <td className="py-2 font-semibold">{p.seatNumber}</td><td>{p.fullName}</td><td>{p.age ?? '—'}</td><td className="capitalize">{p.gender ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-text-muted">No passenger details.</p>}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title={<span className="flex items-center gap-2"><Ticket className="h-4 w-4" /> Tickets</span>} action={id && confirmed ? <PrintTicketButton bookingId={id} /> : null} />
          <CardBody>
            {!confirmed ? (
              <EmptyState title="No tickets" description={booking.status === 'cancelled' ? 'This booking was cancelled.' : 'Tickets are issued once the booking is paid.'} />
            ) : tickets.isLoading ? <PageLoader /> : tickets.isError ? <ErrorState error={tickets.error} onRetry={tickets.refetch} /> : (
              <div className="flex flex-col gap-2">
                {tickets.data?.tickets.map((t) => (
                  <div key={t.seat} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div className="font-medium text-text">Seat {t.seat} <span className="text-text-muted">· {passengers.find((p) => p.seatNumber === t.seat)?.fullName ?? ''}</span></div>
                    <div className="flex gap-2">
                      {t.ticketId && booking.status === 'confirmed' && <Button variant="ghost" size="sm" leftIcon={<ArrowUpCircle className="h-4 w-4" />} onClick={() => { setUpgrading({ ticketId: t.ticketId!, seat: t.seat }); setToSeat(''); }}>Upgrade</Button>}
                      <VerifyButton token={t.boardingToken} />
                      {t.ticketId && d && new Date(d.departsAt).getTime() <= Date.now() && booking.status === 'confirmed' && <NoShowButton ticketId={t.ticketId} onDone={() => void qc.invalidateQueries({ queryKey: ['tickets', id] })} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Refunds & invoices" />
          <CardBody className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-text-muted">Refunds</div>
              {refunds.isError ? <ErrorState error={refunds.error} onRetry={refunds.refetch} /> : refunds.data?.refunds?.length ? (
                <div className="flex flex-col gap-2">
                  {refunds.data.refunds.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                      <span>{formatMoney(r.amountMinor, r.currency)} — {r.destination === 'alternate_account' ? 'Alternate account' : 'Original payment'}</span>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-text-muted">No refunds.</p>}
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-text-muted">GST invoices</div>
              {invoices.isError ? <ErrorState error={invoices.error} onRetry={invoices.refetch} /> : invoices.data?.invoices?.length ? (
                <div className="flex flex-col gap-2">
                  {invoices.data.invoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                      <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                      <span className="text-xs text-text-muted">{inv.kind === 'credit' ? 'Credit note' : 'Tax invoice'}</span>
                      <span>{formatMoney(inv.totalMinor, booking.currency)}</span>
                      <span className="text-xs text-text-muted">{formatDateLabel(localDateOf(inv.issuedAt), { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-text-muted">No invoices.</p>}
            </div>
          </CardBody>
        </Card>
      </div>

      {changing && id && d && (
        <BookingChangeModal kind={changing} bookingId={id} pnr={booking.pnr} tripId={d.tripId} seats={d.seats} passengers={passengers}
          onClose={() => setChanging(null)} onDone={() => { setChanging(null); refresh(); void qc.invalidateQueries({ queryKey: ['tickets', id] }); }} />
      )}
      {cancelOpen && id && (
        <CancelBookingModal bookingId={id} currency={booking.currency} seats={d?.seats ?? []} passengers={passengers} onClose={() => setCancelOpen(false)} onDone={() => { setCancelOpen(false); refresh(); }} />
      )}
      {payOpen && id && d?.holdExpiresAt && (
        <PhonePayModal bookingId={id} totalMinor={booking.totalMinor} currency={booking.currency} holdExpiresAt={d.holdExpiresAt} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); refresh(); }} />
      )}
      {resendOpen && id && (
        <ResendModal bookingId={id} defaultEmail={d?.contactEmail ?? ''} onClose={() => setResendOpen(false)} onDone={() => { setResendOpen(false); refresh(); }} />
      )}

      <Modal open={!!upgrading} onClose={() => setUpgrading(null)} title={`Upgrade seat ${upgrading?.seat ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setUpgrading(null)}>Close</Button><Button loading={upgrade.isPending} disabled={!toSeat.trim() || upgrade.isPending} onClick={() => { if (upgradeInFlight.current) return; upgradeInFlight.current = true; upgrade.mutate(); }}>Upgrade & charge difference</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Only the fare difference (plus its GST) is charged. Closes 1 hour before departure.</p>
          <Input label="New seat number" value={toSeat} onChange={(e) => setToSeat(e.target.value)} placeholder="e.g. U5" />
        </div>
      </Modal>
    </>
  );
}

function ResendModal({ bookingId, defaultEmail, onClose, onDone }: { bookingId: string; defaultEmail: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(defaultEmail);
  const [touched, setTouched] = useState(false);
  const error = !email.trim() ? 'Enter the email to send it to' : !isEmail(email.trim()) ? 'Enter a valid email address' : '';
  const send = useMutation({
    mutationFn: () => bookingsApi.resendTicket(bookingId, email.trim() === defaultEmail ? undefined : email.trim()),
    onSuccess: () => { toast.success(`E-ticket sent to ${email.trim()}`); onDone(); },
    onError: (e) => toast.error(errText(e, 'Could not send the e-ticket')),
  });
  return (
    <Modal open onClose={onClose} title="Resend e-ticket"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={send.isPending} disabled={send.isPending} onClick={() => { setTouched(true); if (!error) send.mutate(); }}>Send</Button></>}>
      <Input label="Send to" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={touched ? error : undefined} />
      <p className="mt-2 text-xs text-text-muted">The GST invoice is not re-sent; it is in the first email and on this page.</p>
    </Modal>
  );
}

function EmailStatus({ status }: { status?: string }) {
  if (!status) return <span className="text-text-muted">not sent</span>;
  const ok = status === 'sent';
  return <span className={ok ? 'inline-flex items-center gap-1 text-success' : 'inline-flex items-center gap-1 text-danger'}>{ok ? <Mail className="h-3.5 w-3.5" /> : <MailWarning className="h-3.5 w-3.5" />}{status}</span>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-medium text-text">{children}</span>
    </div>
  );
}

function VerifyButton({ token }: { token: string }) {
  const toast = useToast();
  const verify = useMutation({
    mutationFn: () => bookingsApi.verifyTicket(token),
    onSuccess: (r) => (r.valid ? toast.success('Ticket signature valid ✓') : toast.error('Invalid ticket')),
    onError: (e) => toast.error(errText(e, 'Verification failed')),
  });
  return <Button variant="ghost" size="sm" onClick={() => verify.mutate()} loading={verify.isPending} leftIcon={<ShieldCheck className="h-4 w-4" />}>Verify</Button>;
}

/** After departure: record that a passenger never turned up (for reports, not a refund decision). */
function NoShowButton({ ticketId, onDone }: { ticketId: string; onDone: () => void }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => amendmentsApi.noShow(ticketId),
    onSuccess: () => { toast.success('Marked as no-show'); onDone(); },
    onError: (e) => toast.error(errText(e, 'Could not mark')),
  });
  return <Button variant="ghost" size="sm" loading={m.isPending} disabled={m.isPending} onClick={() => m.mutate()}>No-show</Button>;
}

/** A phone booking's caller pays by UPI before the release time; the booking is then confirmed and the e-ticket sent. */
function PhonePayModal({ bookingId, totalMinor, currency, holdExpiresAt, onClose, onDone }: { bookingId: string; totalMinor: number; currency: string; holdExpiresAt: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [vpa, setVpa] = useState('');
  const [tried, setTried] = useState(false);
  const ok = /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
  const expired = Date.parse(holdExpiresAt) <= Date.now();
  const pay = useMutation({
    mutationFn: () => paymentsApi.chargeTest(bookingId, vpa.trim()),
    onSuccess: () => { toast.success('Paid — booking confirmed, e-ticket sent'); onDone(); },
    onError: (e) => toast.error(errText(e, 'Payment failed')),
  });
  return (
    <Modal open onClose={onClose} title="Take UPI payment"
      footer={<><Button variant="ghost" onClick={onClose} disabled={pay.isPending}>Close</Button>
        <Button loading={pay.isPending} disabled={pay.isPending || expired} onClick={() => { setTried(true); if (ok) pay.mutate(); }}>Charge {formatMoney(totalMinor, currency)}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        {expired ? <p role="alert" className="text-danger">The hold has expired — the seats were released. Book again.</p>
          : <p className="text-text-muted">Seats are held until {dt(holdExpiresAt)}.</p>}
        <Input label="Caller's UPI ID" value={vpa} placeholder="name@bank" onChange={(e) => setVpa(e.target.value)} error={tried && !ok ? 'Enter a UPI ID like name@bank' : undefined} disabled={pay.isPending || expired} />
        {pay.isError && <p role="alert" className="text-xs text-danger">{errText(pay.error, 'Payment failed')} — the seats are still held; try again.</p>}
      </div>
    </Modal>
  );
}
