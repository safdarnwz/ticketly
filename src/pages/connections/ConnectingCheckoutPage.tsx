import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { flowApi } from '@/lib/api/booking-flow';
import { SeatSelector, type SeatSelection } from '@/components/customer/SeatSelector';
import { connectionsApi, type ConnectingOption, type ConnectionPassenger } from '@/lib/api/connections';
import { formatMoney } from '@/lib/utils';

type Step = 'seats' | 'payment' | 'done';

export function ConnectingCheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const option = (location.state as { option?: ConnectingOption } | null)?.option;
  if (!option) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-warning" />
        <p className="text-text-muted">No connecting option selected. Please search again.</p>
        <Button className="mt-4" onClick={() => navigate('/results')}>Back to search</Button>
      </div>
    );
  }

  return <ConnectingCheckout option={option} />;
}

/** The checkout itself — only mounted once an option exists, so its hooks always run in the same order. */
function ConnectingCheckout({ option }: { option: ConnectingOption }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>('seats');
  const [leg1, setLeg1] = useState<SeatSelection>({ seats: [] });
  const [leg2, setLeg2] = useState<SeatSelection>({ seats: [] });
  const leg1Seats = leg1.seats.map((s) => s.seatNumber);
  const leg2Seats = leg2.seats.map((s) => s.seatNumber);
  const [names, setNames] = useState<Record<string, string>>({});
  const [contactPhone, setContactPhone] = useState('');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ leg1: { status: string; pnr?: string }; leg2: { status: string; pnr?: string; error?: string } } | null>(null);


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
        flowApi.quote({ tripId: option.leg1.tripId, fromStopId: option.leg1.fromStopId, toStopId: option.leg1.toStopId, seatType: leg1.seatType, seatNumbers: leg1Seats }, option.leg1.tenantId),
        flowApi.quote({ tripId: option.leg2.tripId, fromStopId: option.leg2.fromStopId, toStopId: option.leg2.toStopId, seatType: leg2.seatType, seatNumbers: leg2Seats }, option.leg2.tenantId),
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
          {([['Leg 1', option.leg1, setLeg1], ['Leg 2', option.leg2, setLeg2]] as const).map(([label, leg, set]) => (
            <Card key={label}>
              <CardHeader title={`${label} — ${leg.operatorName}`} subtitle={`${leg.fromStopName} → ${leg.toStopName}`} />
              <CardBody>
                <SeatSelector tripId={leg.tripId} tenantId={leg.tenantId} initialFromStopId={leg.fromStopId} initialToStopId={leg.toStopId} lockStops priceOf={() => undefined} onChange={set} />
              </CardBody>
            </Card>
          ))}

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
