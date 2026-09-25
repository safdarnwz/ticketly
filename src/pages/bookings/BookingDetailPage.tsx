import type { ReactNode } from 'react';
import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket, ExternalLink, ShieldCheck, XCircle, ArrowUpCircle } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Badge, statusTone, Modal, Input, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { bookingsApi } from '@/lib/api/bookings';
import { paymentsApi, openRazorpayCheckout } from '@/lib/api/payments';
import { refundsApi } from '@/lib/api/ops';
import { formatMoney } from '@/lib/utils';

export function BookingDetailPage() {
  const { pnr = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [upgrading, setUpgrading] = useState<{ ticketId: string; seat: string } | null>(null);
  const [toSeat, setToSeat] = useState('');
  const upgradeInFlight = useRef(false);
  const cancelInFlight = useRef(false);

  const booking = useQuery({
    queryKey: ['booking', pnr],
    queryFn: () => bookingsApi.byPnrStaff(pnr).then((r) => r.booking),
  });
  const id = booking.data?.id;

  const tickets = useQuery({ queryKey: ['tickets', id], queryFn: () => bookingsApi.tickets(id!), enabled: Boolean(id) });
  const invoices = useQuery({ queryKey: ['invoices', id], queryFn: () => bookingsApi.invoices(id!), enabled: Boolean(id) });
  const refunds = useQuery({ queryKey: ['refunds', id], queryFn: () => refundsApi.forBooking(id!), enabled: Boolean(id) });

  const cancel = useMutation({
    mutationFn: () => bookingsApi.cancel(id!, 'operator cancel'),
    onSuccess: (r) => {
      toast.success(`Cancelled · refund ${formatMoney(r.refundMinor, booking.data?.currency)} (${r.refundPct}%)`);
      void qc.invalidateQueries({ queryKey: ['booking', pnr] });
      void qc.invalidateQueries({ queryKey: ['refunds', id] });
    },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Cancel failed'); cancelInFlight.current = false; },
  });
  const handleCancel = () => {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    cancel.mutate();
  };

  const upgrade = useMutation({
    mutationFn: async () => {
      const r = await paymentsApi.upgradeSeat(upgrading!.ticketId, toSeat.trim());
      // The seat is NOT swapped yet — only a real gateway order was
      // created (see PaymentService.upgradeSeat's own doc comment for the
      // critical bug this replaced: the old flow swapped the seat and
      // faked its own payment capture, meaning every upgrade was free).
      // The customer must actually complete Razorpay checkout here; the
      // seat only actually changes once the webhook confirms a real capture.
      await openRazorpayCheckout(r.clientPayload);
      return r;
    },
    onSuccess: (r) => {
      toast.success(`Payment complete — charged ${formatMoney(r.differentialMinor, booking.data?.currency)} extra. Your new seat will show shortly once confirmed.`);
      setUpgrading(null); setToSeat(''); upgradeInFlight.current = false;
      void qc.invalidateQueries({ queryKey: ['tickets', id] });
    },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Upgrade failed'); upgradeInFlight.current = false; },
  });
  const handleUpgrade = () => {
    if (upgradeInFlight.current) return;
    upgradeInFlight.current = true;
    upgrade.mutate();
  };

  if (booking.isLoading) return <PageLoader />;
  if (booking.isError) return <ErrorState error={booking.error} onRetry={booking.refetch} />;
  const b = booking.data!;
  const cancellable = ['held', 'confirmed'].includes(b.status);

  return (
    <>
      <PageHeader
        back
        backTo="/bookings"
        title={`PNR ${b.pnr}`}
        subtitle={`Trip ${b.tripId}`}
        action={
          cancellable ? (
            <Button variant="danger" onClick={handleCancel} loading={cancel.isPending} leftIcon={<XCircle className="h-4 w-4" />}>
              Cancel booking
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Overview" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <Row label="Status"><Badge tone={statusTone(b.status)}>{b.status}</Badge></Row>
            <Row label="Seats">{b.seatCount}</Row>
            <Row label="Total">{formatMoney(b.totalMinor, b.currency)}</Row>
            <Row label="Paid">{formatMoney(b.paidMinor, b.currency)}</Row>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={<span className="flex items-center gap-2"><Ticket className="h-4 w-4" /> Tickets</span>}
            action={id ? <a href={bookingsApi.ticketHtmlUrl(id)} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" leftIcon={<ExternalLink className="h-4 w-4" />}>Print</Button></a> : null}
          />
          <CardBody>
            {tickets.isLoading ? <PageLoader /> : tickets.data?.tickets?.length ? (
              <div className="flex flex-col gap-2">
                {tickets.data.tickets.map((t) => (
                  <div key={t.seat} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div className="font-medium text-text">Seat {t.seat}</div>
                    <div className="flex gap-2">
                      {t.ticketId && <Button variant="ghost" size="sm" leftIcon={<ArrowUpCircle className="h-4 w-4" />} onClick={() => { setUpgrading({ ticketId: t.ticketId!, seat: t.seat }); setToSeat(''); }}>Upgrade</Button>}
                      <VerifyButton token={t.boardingToken} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No tickets yet" description="Tickets appear once the booking is confirmed." />
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Refunds & Invoices" />
          <CardBody className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-text-muted">Refunds</div>
              {refunds.data?.refunds?.length ? (
                <div className="flex flex-col gap-2">
                  {refunds.data.refunds.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                      <span>{formatMoney(r.amountMinor, r.currency)} — {r.destination === 'alternate_account' ? 'Alternate account' : 'Original source'}</span>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-text-muted">No refunds.</p>}
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-text-muted">GST invoices</div>
              {invoices.data?.invoices?.length ? (
                <div className="flex flex-col gap-2">
                  {invoices.data.invoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                      <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                      <span className="text-xs text-text-muted">{inv.kind === 'credit' ? 'Credit note' : 'Tax invoice'}</span>
                      <span>{formatMoney(inv.totalMinor, booking.data?.currency ?? 'INR')}</span>
                      <span className="text-xs text-text-muted">{new Date(inv.issuedAt).toLocaleDateString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-text-muted">No invoices.</p>}
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal open={!!upgrading} onClose={() => setUpgrading(null)} title={`Upgrade seat ${upgrading?.seat ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setUpgrading(null)}>Cancel</Button><Button loading={upgrade.isPending} disabled={!toSeat.trim() || upgrade.isPending} onClick={handleUpgrade}>Upgrade & charge difference</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Only the FARE DIFFERENCE (plus its own GST) is charged — closes 1 hour before departure.</p>
          <Input label="New seat number" value={toSeat} onChange={(e) => setToSeat(e.target.value)} placeholder="e.g. U5" />
        </div>
      </Modal>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{children}</span>
    </div>
  );
}

function VerifyButton({ token }: { token: string }) {
  const toast = useToast();
  const verify = useMutation({
    mutationFn: () => bookingsApi.verifyTicket(token),
    onSuccess: (r) => (r.valid ? toast.success('Ticket signature valid ✓') : toast.error('Invalid ticket')),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Verification failed'),
  });
  return (
    <Button variant="ghost" size="sm" onClick={() => verify.mutate()} loading={verify.isPending} leftIcon={<ShieldCheck className="h-4 w-4" />}>
      Verify
    </Button>
  );
}
