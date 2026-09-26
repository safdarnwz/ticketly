import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, Modal, PageLoader, useToast } from '@/components/ui';
import { agentPortalApi } from '@/lib/api/agentPortal';
import { bookingsApi } from '@/lib/api/bookings';
import { BookingChangeModal, type ChangeKind } from '@/pages/bookings/BookingChanges';
import { formatDateTime, formatMoney, idempotencyKey } from '@/lib/utils';

/** One of the agent's own bookings: details, changes (seat, points, name) and cancellation. */
export function AgentBookingPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['agent-booking', id], queryFn: () => agentPortalApi.booking(id) });
  const [change, setChange] = useState<ChangeKind | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['agent-booking', id] });
    void qc.invalidateQueries({ queryKey: ['agent-bookings'] });
    void qc.invalidateQueries({ queryKey: ['agent-me'] });
  };
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { booking: b, passengers, journey } = q.data!;
  const live = b.status === 'confirmed' && !!journey && Date.parse(journey.departsAt) > Date.now();
  const seats = passengers.map((p) => p.seatNumber);
  return (
    <div className="flex flex-col gap-4">
      <Link to="/agent/bookings" className="flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="h-4 w-4" /> My bookings</Link>
      <Card>
        <CardHeader title={<span>PNR <span className="font-mono">{b.pnr}</span></span>} subtitle={journey ? `${journey.routeName} · ${formatDateTime(journey.departsAt)}` : undefined}
          action={<Badge tone={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'danger' : 'neutral'}>{b.status}</Badge>} />
        <CardBody className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><div className="text-xs text-text-muted">Boards at</div><div className="text-text">{journey?.boardingStop ?? '—'}</div></div>
          <div><div className="text-xs text-text-muted">Gets off at</div><div className="text-text">{journey?.droppingStop ?? '—'}{journey ? ` · ${formatDateTime(journey.arrivesAt)}` : ''}</div></div>
          <div><div className="text-xs text-text-muted">Fare paid</div><div className="font-semibold text-text">{formatMoney(b.totalMinor, b.currency)}</div></div>
          <div><div className="text-xs text-text-muted">Your commission</div><div className="font-semibold text-success">{formatMoney(journey?.commissionMinor ?? 0, b.currency)}</div></div>
          <div className="col-span-2"><div className="text-xs text-text-muted">Passenger contact</div><a className="text-primary" href={`tel:${b.contactPhone}`}>{b.contactPhone}</a>{b.contactEmail ? ` · ${b.contactEmail}` : ''}</div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Passengers" />
        <CardBody>
          <ul className="divide-y divide-border text-sm">
            {passengers.map((p) => <li key={p.seatNumber} className="flex justify-between py-2"><span className="text-text">{p.fullName}</span><span className="text-text-muted">Seat {p.seatNumber}{p.age != null ? ` · ${p.age} yrs` : ''}{p.gender ? ` · ${p.gender}` : ''}</span></li>)}
          </ul>
        </CardBody>
      </Card>
      {live ? (
        <Card>
          <CardHeader title="Changes" subtitle="Same bus only. A different date is a new booking." />
          <CardBody className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setChange('points')}>Change boarding / drop point</Button>
            <Button variant="outline" onClick={() => setChange('seats')}>Change seat</Button>
            <Button variant="outline" onClick={() => setChange('name')}>Correct a name</Button>
            <Button variant="danger" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => setCancelling(true)}>Cancel…</Button>
          </CardBody>
        </Card>
      ) : <p className="text-sm text-text-muted">{b.status === 'cancelled' ? 'This booking is cancelled.' : 'The bus has left — this booking can no longer change.'}</p>}
      {change && <BookingChangeModal kind={change} bookingId={b.id} pnr={b.pnr} tripId={b.tripId} seats={seats} passengers={passengers}
        agentLeg={{ fromSeq: b.fromSeq, toSeq: b.toSeq }} onClose={() => setChange(null)} onDone={() => { setChange(null); refresh(); }} />}
      {cancelling && <CancelModal id={b.id} seats={seats} totalMinor={b.totalMinor} commissionMinor={journey?.commissionMinor ?? 0} onClose={() => setCancelling(false)}
        // The refund and the commission taken back post a moment later (the refund job): look again then.
        onDone={() => { setCancelling(false); refresh(); setTimeout(refresh, 3000); }} />}
    </div>
  );
}

/** Full or partial cancellation: what the policy refunds now, then the money back on the agent's account. */
function CancelModal({ id, seats, totalMinor, commissionMinor, onClose, onDone }: { id: string; seats: string[]; totalMinor: number; commissionMinor: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(seats);
  const [reason, setReason] = useState('');
  const [key] = useState(() => idempotencyKey('agent-cancel'));
  const preview = useQuery({ queryKey: ['refund-preview', id], queryFn: () => bookingsApi.refundPreview(id) });
  const all = picked.length === seats.length;
  const share = seats.length ? picked.length / seats.length : 0;
  const refund = preview.data ? Math.round(preview.data.refundMinor * share) : 0;
  const charges = Math.round(totalMinor * share) - refund;
  const go = useMutation({
    mutationFn: () => agentPortalApi.cancel(id, { reason: reason.trim() || undefined, seatNumbers: all ? undefined : picked }, key),
    onSuccess: (r) => { toast.success(`Cancelled — ${formatMoney(Number(r.refundMinor ?? 0))} credited back to your account`); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not cancel'),
  });
  return (
    <Modal open onClose={onClose} title="Cancel booking"
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Keep it</Button>
        <Button variant="danger" loading={go.isPending} disabled={!picked.length || go.isPending || preview.data?.cancellable === false} onClick={() => go.mutate()}>{all ? 'Cancel whole booking' : `Cancel ${picked.length} seat${picked.length === 1 ? '' : 's'}`}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        {seats.length > 1 && (
          <div>
            <div className="mb-1 font-medium text-text">Which seats</div>
            <div className="flex flex-wrap gap-2">{seats.map((s) => (
              <label key={s} className="flex items-center gap-1 rounded border border-border px-2 py-1"><input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s] : p.filter((x) => x !== s)))} /> Seat {s}</label>
            ))}</div>
            {!picked.length && <p className="mt-1 text-xs text-danger" role="alert">Pick at least one seat</p>}
          </div>
        )}
        {preview.isLoading ? <PageLoader /> : preview.isError ? <ErrorState error={preview.error} onRetry={preview.refetch} /> : preview.data!.cancellable === false ? (
          <p className="text-danger" role="alert">This booking can no longer be cancelled under the operator's policy.</p>
        ) : (
          <div className="rounded-md bg-surface-muted p-3">
            <div className="flex justify-between"><span className="text-text-muted">Cancellation charges ({100 - preview.data!.refundPct}%)</span><span>{formatMoney(Math.max(0, charges))}</span></div>
            <div className="flex justify-between font-semibold"><span>Refund to your account{all ? '' : ' (about)'}</span><span>{formatMoney(refund)}</span></div>
            <div className="mt-1 text-xs text-text-muted">The commission on the cancelled seats ({all ? formatMoney(commissionMinor) : `about ${formatMoney(Math.round(commissionMinor * share))}`}) is taken back in proportion to the refund.{all ? '' : ' Exact amounts are shown after cancelling.'}</div>
          </div>
        )}
        <Input label="Reason (optional)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
