import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button, Input, Modal, useToast } from '@/components/ui';
import { tripOpsExtraApi } from '@/lib/api/tripOps';
import type { SearchResult } from '@/lib/api/types';
import { normalizeMobile } from '@/lib/checkout';
import { formatDateTime, idempotencyKey } from '@/lib/utils';

/** A full bus: put the passenger on its waitlist; they get an SMS if seats free up. */
export function WaitlistModal({ trip, onClose }: { trip: SearchResult; onClose: () => void }) {
  const toast = useToast();
  const [count, setCount] = useState('1');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const [key] = useState(() => idempotencyKey('waitlist'));
  const n = Number(count);
  const mobile = normalizeMobile(phone);
  const errors: Record<string, string> = {};
  if (!Number.isInteger(n) || n < 1 || n > 10) errors.count = '1 to 10 seats';
  if (!mobile) errors.phone = 'Enter a 10-digit mobile';
  const join = useMutation({
    mutationFn: () => tripOpsExtraApi.joinWaitlist(trip.tripId, { fromStopId: trip.boardingStop.id, toStopId: trip.droppingStop.id, seatCount: n, contactPhone: mobile! }, key, trip.tenantId),
    onSuccess: () => { toast.success('On the waitlist — the passenger gets an SMS if seats free up'); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not join the waitlist'),
  });
  return (
    <Modal open onClose={onClose} title="Add to waitlist"
      footer={<><Button variant="ghost" onClick={onClose} disabled={join.isPending}>Cancel</Button><Button loading={join.isPending} disabled={join.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) join.mutate(); }}>Join waitlist</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">{trip.operatorName} · {trip.boardingStop.name} → {trip.droppingStop.name} · {formatDateTime(trip.departsAt)} is full.</p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Seats needed" type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} error={tried ? errors.count : undefined} />
          <Input label="Passenger mobile" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={tried ? errors.phone : undefined} />
        </div>
      </div>
    </Modal>
  );
}
