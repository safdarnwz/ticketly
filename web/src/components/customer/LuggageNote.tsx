import { useQuery } from '@tanstack/react-query';
import { Luggage } from 'lucide-react';

import { flowApi } from '@/lib/api/booking-flow';
import { formatMoney } from '@/lib/utils';

/** The operator's luggage allowance for this trip; nothing when it has not published one. */
export function LuggageNote({ tripId, tenantId }: { tripId: string; tenantId?: string }) {
  const q = useQuery({ queryKey: ['trip-public', tripId], queryFn: () => flowApi.trip(tripId, tenantId), staleTime: 300_000 });
  const l = q.data?.luggage;
  if (!l) return null;
  return (
    <div className="flex gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-muted">
      <Luggage className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <b className="text-text">Luggage:</b> {l.freePieces} piece{l.freePieces === 1 ? '' : 's'} up to {l.freeKg} kg free
        {l.extraPerKgMinor ? ` · ${formatMoney(l.extraPerKgMinor)} per extra kg` : ' · more can be added as an extra bag'}
        {l.note ? ` · ${l.note}` : ''}
      </span>
    </div>
  );
}
