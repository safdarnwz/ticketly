import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Armchair, CheckCircle2, AlertTriangle } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { flowApi } from '@/lib/api/booking-flow';
import { connectionsApi, type ConnectingOption, type ConnectionPassenger } from '@/lib/api/connections';
import { formatMoney } from '@/lib/utils';

type Step = 'seats' | 'payment' | 'done';

function LegSeatPicker({ label, tripId, fromStopId, toStopId, selected, onToggle }: {
  label: string; tripId: string; fromStopId: string; toStopId: string;
  selected: string[]; onToggle: (seat: string) => void;
}) {
  const avail = useQuery({ queryKey: ['conn-avail', tripId], queryFn: () => flowApi.availability(tripId, fromStopId, toStopId) });
  if (avail.isLoading) return <PageLoader />;
  if (avail.isError) return <ErrorState error={avail.error} onRetry={avail.refetch} />;
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-text">{label}</div>
      <div className="flex flex-wrap gap-2">
        {(avail.data?.seats ?? []).map((s) => {
          const isSel = selected.includes(s.seatNumber);
          return (
            <button key={s.seatNumber} onClick={() => s.available && onToggle(s.seatNumber)} disabled={!s.available} title={s.seatNumber}
              className={[
                'flex h-10 w-10 items-center justify-center rounded-md border text-xs font-medium transition',
                !s.available ? 'cursor-not-allowed border-border bg-surface-muted text-text-muted/50'
                  : isSel ? 'border-primary bg-primary text-primary-fg'
                  : 'border-success/40 bg-success/10 text-success hover:border-success',
              ].join(' ')}>
              <Armchair className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ConnectingCheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const option = (location.state as { option?: ConnectingOption } | null)?.option;

  const [step, setStep] = useState<Step>('seats');
  const [leg1Seats, setLeg1Seats] = useState<string[]>([]);
  const [leg2Seats, setLeg2Seats] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [contactPhone, setContactPhone] = useState('');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ leg1: { status: string; pnr?: string }; leg2: { status: string; pnr?: string; error?: string } } | null>(null);

  if (!option) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-warning" />
        <p className="text-text-muted">No connecting option selected. Please search again.</p>
        <Button className="mt-4" onClick={() => navigate('/results')}>Back to search</Button>
      </div>
    );
  }

  const toggleLeg1 = (seat: string) => setLeg1Seats((cur) => cur.includes(seat) ? cur.filter((s) => s !== seat) : [...cur, seat]);
  const toggleLeg2 = (seat: string) => setLeg2Seats((cur) => cur.includes(seat) ? cur.filter((s) => s !== seat) : [...cur, seat]);

  // Edge case: both legs of a connecting journey must carry the SAME
  // number of passengers — a group travelling together doesn't split
  // mid-journey. Enforced here (UI) AND on the backend (the real
  // guarantee); this is just so the customer sees why the button is
  // disabled rather than discovering it as a hold-time error.
  const seatCountMismatch = leg1Seats.length > 0 && leg2Seats.length > 0 && leg1Seats.length !== leg2Seats.length;
  const allSeats = [...leg1Seats, ...leg2Seats];
  const namesComplete = allSeats.length > 0 && allSeats.every((s) => names[s]?.trim());
  const canProceed = leg1Seats.length > 0 && leg1Seats.length === leg2Seats.length && namesComplete && contactPhone.trim().length >= 6;

  const buildPassengers = (seats: string[]): ConnectionPassenger[] =>
    seats.map((s) => ({ seatNumber: s, fullName: names[s]?.trim() ?? '' }));

  const hold = useMutation({
    mutationFn: async () => {
      const [q1, q2] = await Promise.all([
        flowApi.quote({ tripId: option.leg1.tripId, fromStopId: option.leg1.fromStopId, toStopId: option.leg1.toStopId, seatType: 'seater', seatNumbers: leg1Seats }),
        flowApi.quote({ tripId: option.leg2.tripId, fromStopId: option.leg2.fromStopId, toStopId: option.leg2.toStopId, seatType: 'seater', seatNumbers: leg2Seats }),
      ]);
      return connectionsApi.hold({
        leg1: { tenantId: option.leg1.tenantId, quoteId: q1.quoteId, seatNumbers: leg1Seats, passengers: buildPassengers(leg1Seats) },
        leg2: { tenantId: option.leg2.tenantId, quoteId: q2.quoteId, seatNumbers: leg2Seats, passengers: buildPassengers(leg2Seats) },
        contactPhone: contactPhone.trim(),
      });
    },
    onSuccess: (res) => { setConnectionId(res.connectionId); setStep('payment'); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not hold seats — the second leg may no longer be available. Please search again.'),
  });

  const confirm = useMutation({
    mutationFn: () => connectionsApi.confirm(connectionId!, { method: 'upi', vpa: 'success@ticketly' }, { method: 'upi', vpa: 'success@ticketly' }),
    onSuccess: (res) => {
      setConfirmResult(res);
      setStep('done');
      if (res.leg2.error) {
        // Edge case surfaced directly, not hidden behind a generic success
        // toast — leg 1 IS confirmed and ticketed; leg 2 genuinely needs
        // the customer's attention.
        toast.error('Leg 1 is confirmed. Leg 2 payment did not go through — you can retry it separately.');
      } else {
        toast.success('Both legs confirmed! Your tickets are ready.');
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Payment failed for one or both legs.'),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader title="Connecting Journey Checkout" subtitle={`Via ${option.connectionCityName} — ${Math.floor(option.layoverMinutes / 60)}h ${option.layoverMinutes % 60}m layover`} />

      {step === 'seats' && (
        <div className="flex flex-col gap-4">
          <Card><CardBody><LegSeatPicker label={`Leg 1 — ${option.leg1.fromStopName} to ${option.leg1.toStopName} (${option.leg1.operatorName})`} tripId={option.leg1.tripId} fromStopId={option.leg1.fromStopId} toStopId={option.leg1.toStopId} selected={leg1Seats} onToggle={toggleLeg1} /></CardBody></Card>
          <Card><CardBody><LegSeatPicker label={`Leg 2 — ${option.leg2.fromStopName} to ${option.leg2.toStopName} (${option.leg2.operatorName})`} tripId={option.leg2.tripId} fromStopId={option.leg2.fromStopId} toStopId={option.leg2.toStopId} selected={leg2Seats} onToggle={toggleLeg2} /></CardBody></Card>

          {seatCountMismatch && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" /> Both legs need the same number of seats — you have picked {leg1Seats.length} on leg 1 and {leg2Seats.length} on leg 2.
            </div>
          )}

          {allSeats.length > 0 && (
            <Card>
              <CardHeader title="Passenger names" />
              <CardBody className="flex flex-col gap-3">
                {allSeats.map((s) => (
                  <Input key={s} label={`Seat ${s}`} value={names[s] ?? ''} onChange={(e) => setNames((n) => ({ ...n, [s]: e.target.value }))} />
                ))}
                <Input label="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="9876543210" />
              </CardBody>
            </Card>
          )}

          <Button disabled={!canProceed} loading={hold.isPending} onClick={() => hold.mutate()}>
            Hold seats on both legs — {formatMoney(option.leg1.baseFareMinor + option.leg2.baseFareMinor, 'INR')}
          </Button>
        </div>
      )}

      {step === 'payment' && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Both seats are held. Since the two legs are run by different operators, they are charged as two separate payments — you will get two PNRs, one per leg.
            </p>
            <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>Pay for both legs</Button>
          </CardBody>
        </Card>
      )}

      {step === 'done' && confirmResult && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className={`h-12 w-12 ${confirmResult.leg2.error ? 'text-warning' : 'text-success'}`} />
            <div>
              <div className="text-sm text-text-muted">Leg 1</div>
              <div className="font-semibold text-text">{confirmResult.leg1.status === 'confirmed' ? `Confirmed — PNR ${confirmResult.leg1.pnr}` : confirmResult.leg1.status}</div>
            </div>
            <div>
              <div className="text-sm text-text-muted">Leg 2</div>
              <div className="font-semibold text-text">
                {confirmResult.leg2.status === 'confirmed' ? `Confirmed — PNR ${confirmResult.leg2.pnr}` : (confirmResult.leg2.error ?? confirmResult.leg2.status)}
              </div>
            </div>
            <Button onClick={() => navigate('/account')}>View my bookings</Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
