import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, Select, Badge, statusTone, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { refundsApi } from '@/lib/api/ops';
import { bookingsApi } from '@/lib/api/bookings';
import { formatMoney } from '@/lib/utils';

interface RefundRow { amountMinor: number; currency: string; status: string; destination: string }

export function RefundsPage() {
  const toast = useToast();
  const [pnr, setPnr] = useState('');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState<'source' | 'alternate_account'>('source');
  const [accountHolder, setAccountHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [refunds, setRefunds] = useState<RefundRow[] | null>(null);
  // A manual refund is exactly the kind of action a double-click should
  // NEVER duplicate — the backend's idempotency key is now deterministic
  // (bookingId+amount+destination), but this ref-guard stops a second
  // click from even firing the request, the same defense-in-depth pattern
  // used everywhere else money moves in this app (checkout, etc.).
  const inFlight = useRef(false);

  const lookup = useMutation({
    // PNR, not a raw booking UUID — no one on the phone with a passenger
    // (or reading a support ticket) has a booking's internal UUID handy;
    // they have the PNR the passenger can actually read off their ticket.
    // Resolves PNR -> the real booking id first (staff-only, no customer
    // phone-match needed — see BookingController.byPnrStaff), then looks
    // up refunds for THAT booking.
    mutationFn: async () => {
      const { booking } = await bookingsApi.byPnrStaff(pnr.trim().toUpperCase());
      setBookingId(booking.id);
      return refundsApi.forBooking(booking.id);
    },
    onSuccess: (r) => setRefunds(r.refunds),
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Lookup failed'); setBookingId(null); setRefunds(null); },
  });
  const initiate = useMutation({
    mutationFn: () => refundsApi.initiate(bookingId!, Number(amount) * 100, destination,
      destination === 'alternate_account' ? { accountHolder, accountNumber, ifsc, bankName: bankName || undefined } : undefined),
    onSuccess: (r) => { toast.success(`Refund ${r.status}`); inFlight.current = false; lookup.mutate(); },
    onError: (e) => { toast.error(e instanceof Error ? e.message : 'Refund failed'); inFlight.current = false; },
  });
  const handleInitiate = () => {
    if (inFlight.current || !bookingId) return;
    inFlight.current = true;
    initiate.mutate();
  };
  const altAccountValid = destination !== 'alternate_account' || (accountHolder && accountNumber && ifsc);

  return (
    <>
      <PageHeader title="Refunds" subtitle="Look up and initiate refunds for a booking" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Booking refunds" />
          <CardBody className="flex flex-col gap-4">
            <Input label="PNR" value={pnr} onChange={(e) => setPnr(e.target.value)} placeholder="e.g. TKT8X92QF" />
            <Button variant="outline" onClick={() => lookup.mutate()} loading={lookup.isPending} disabled={!pnr.trim()}>Look up refunds</Button>
            {refunds && (refunds.length ? (
              <div className="flex flex-col gap-2">
                {refunds.map((r, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                    <div>
                      <div className="font-medium text-text">{formatMoney(r.amountMinor, r.currency)}</div>
                      <div className="text-xs text-text-muted">To: {r.destination === 'alternate_account' ? 'Alternate account' : 'Original source'}</div>
                    </div>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-text-muted">No refunds for this booking.</p>)}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Initiate refund</span>} />
          <CardBody className="flex flex-col gap-4">
            <Input label="Amount (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Select label="Destination" value={destination} onChange={(e) => setDestination(e.target.value as 'source' | 'alternate_account')}
              options={[{ label: 'Original source (default)', value: 'source' }, { label: 'A different bank account', value: 'alternate_account' }]} />
            {destination === 'alternate_account' && (
              <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <p className="text-xs text-text-muted">A PSP can only refund back to the original payment method — a different account needs these details for a manual bank transfer.</p>
                <Input label="Account holder name" value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} />
                <Input label="Account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                <Input label="IFSC code" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="SBIN0001234" />
                <Input label="Bank name (optional)" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
            )}
            <Button onClick={handleInitiate} loading={initiate.isPending} disabled={!bookingId || !amount || !altAccountValid || initiate.isPending}>Initiate refund</Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
