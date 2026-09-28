import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button, ErrorState, Input, Modal, useToast } from '@/components/ui';
import { bookingsApi } from '@/lib/api/bookings';
import { formatMoney } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Cancel a whole booking or some of its seats, showing the refund first.
 * Staff give a reason; the customer (with the booking mobile) may skip it and
 * the refund always goes back to how they paid.
 */
export function CancelBookingModal({ bookingId, currency, seats, passengers, customer, onClose, onDone }: {
  bookingId: string; currency: string; seats: string[];
  passengers: { seatNumber: string; fullName: string }[];
  /** The customer cancelling their own booking: the booking's mobile (their proof), a reason is optional and the refund goes back to how they paid. */
  customer?: { contactPhone: string };
  onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(seats);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const inFlight = useRef(false);
  const preview = useQuery({ queryKey: ['refund-preview', bookingId], queryFn: () => bookingsApi.refundPreview(bookingId) });
  const all = picked.length === seats.length || seats.length === 0;
  const reasonError = !customer && reason.trim().length < 3 ? 'Say why (at least 3 characters)' : '';
  const seatError = picked.length === 0 ? 'Pick at least one seat' : '';

  const cancel = useMutation({
    mutationFn: () => {
      const why = reason.trim() || undefined;
      if (customer) return all ? bookingsApi.selfCancel(bookingId, customer.contactPhone, why) : bookingsApi.cancelSeats(bookingId, picked, why, customer.contactPhone);
      return all ? bookingsApi.cancel(bookingId, reason.trim()) : bookingsApi.cancelSeats(bookingId, picked, reason.trim());
    },
    onSuccess: (r) => { toast.success(`Cancelled · refund ${formatMoney(r.refundMinor, currency)} (${r.refundPct}%)`); onDone(); },
    onError: (e) => toast.error(errText(e, 'Could not cancel')),
    onSettled: () => { inFlight.current = false; },
  });
  const submit = () => {
    setTouched(true);
    if (reasonError || seatError || inFlight.current || preview.data?.cancellable === false) return;
    inFlight.current = true;
    cancel.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Cancel booking"
      footer={<><Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>Keep booking</Button><Button variant="danger" loading={cancel.isPending} disabled={cancel.isPending || preview.data?.cancellable === false} onClick={submit}>{all ? 'Cancel whole booking' : `Cancel ${picked.length} seat${picked.length === 1 ? '' : 's'}`}</Button></>}>
      <div className="flex flex-col gap-4 text-sm">
        {preview.isLoading ? <p className="text-text-muted">Working out the refund…</p> : preview.isError ? <ErrorState error={preview.error} onRetry={preview.refetch} /> : preview.data?.cancellable === false ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-danger">{preview.data.reason ?? 'This booking can no longer be cancelled.'}</p>
        ) : preview.data ? (
          <p className="rounded-md bg-surface-muted px-3 py-2">
            Cancelling now refunds <b>{preview.data.refundPct}%</b>{all ? <> — <b>{formatMoney(preview.data.refundMinor, currency)}</b> for the whole booking</> : ' of each cancelled seat’s fare'}, to the original payment.
          </p>
        ) : null}
        {seats.length > 1 && (
          <fieldset>
            <legend className="mb-2 font-medium text-text">Seats to cancel</legend>
            <div className="flex flex-col gap-1">
              {seats.map((s) => (
                <label key={s} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))} />
                  Seat {s} <span className="text-text-muted">{passengers.find((p) => p.seatNumber === s)?.fullName}</span>
                </label>
              ))}
            </div>
            {touched && seatError && <p role="alert" className="mt-1 text-xs text-danger">{seatError}</p>}
          </fieldset>
        )}
        <Input label={customer ? 'Reason (optional)' : 'Reason'} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={customer ? 'e.g. Plans changed' : 'e.g. Customer called to cancel'} maxLength={500} error={touched ? reasonError : undefined} />
      </div>
    </Modal>
  );
}
