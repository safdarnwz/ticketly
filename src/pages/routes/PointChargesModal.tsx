import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button, ErrorState, Input, Modal, PageLoader, useToast } from '@/components/ui';
import { masterDataApi, type PointCharge, type RouteRow } from '@/lib/api/masterData';
import { ApiError } from '@/lib/api/client';

const MAX_RUPEES = 1000;
type Draft = Record<string, { board: string; drop: string }>;

/** Rupees typed → paise, or an error message. Empty = 0. */
function parse(v: string): { minor?: number; error?: string } {
  const t = v.trim();
  if (!t) return { minor: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Rupees, up to 2 decimals' };
  const n = Number(t);
  if (n > MAX_RUPEES) return { error: `At most ₹${MAX_RUPEES}` };
  return { minor: Math.round(n * 100) };
}
const toRupees = (minor: number) => (minor ? String(minor / 100) : '');

/**
 * Pickup / drop charges for one route (#286, #287): extra per seat for boarding
 * at, or getting off at, a stop. Only stops where passengers can board get a
 * pickup field, only stops where they can get off get a drop field.
 */
export function PointChargesModal({ route, onClose }: { route: RouteRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['point-charges', route?.id], queryFn: () => masterDataApi.pointCharges(route!.id), enabled: Boolean(route) });
  const [draft, setDraft] = useState<Draft>({});
  const stops = useMemo(() => list.data?.items ?? [], [list.data]);
  useEffect(() => {
    setDraft(Object.fromEntries(stops.map((s) => [s.stopId, { board: toRupees(s.boardChargeMinor), drop: toRupees(s.dropChargeMinor) }])));
  }, [stops]);

  const first = stops[0]?.sequence;
  const last = stops[stops.length - 1]?.sequence;
  const canBoard = (s: PointCharge) => s.canBoard && s.sequence !== last;
  const canDrop = (s: PointCharge) => s.canAlight && s.sequence !== first;
  const errors: Record<string, string> = {};
  for (const s of stops) {
    const d = draft[s.stopId];
    if (!d) continue;
    const b = parse(d.board); const x = parse(d.drop);
    if (b.error) errors[`${s.stopId}.board`] = b.error;
    if (x.error) errors[`${s.stopId}.drop`] = x.error;
  }
  const changed = stops.filter((s) => {
    const d = draft[s.stopId];
    return d && (parse(d.board).minor !== s.boardChargeMinor || parse(d.drop).minor !== s.dropChargeMinor);
  });

  const save = useMutation({
    mutationFn: () => masterDataApi.setPointCharges(route!.id, changed.map((s) => ({
      stopId: s.stopId,
      boardChargeMinor: canBoard(s) ? parse(draft[s.stopId].board).minor ?? 0 : 0,
      dropChargeMinor: canDrop(s) ? parse(draft[s.stopId].drop).minor ?? 0 : 0,
    }))),
    onSuccess: (r) => {
      qc.setQueryData(['point-charges', route?.id], r);
      toast.success('Pickup and drop charges saved');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the charges'),
  });

  const set = (id: string, k: 'board' | 'drop', v: string) => setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));

  return (
    <Modal open={!!route} onClose={onClose} size="lg" title={`Pickup & drop charges — ${route?.name ?? ''}`}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending || changed.length === 0 || Object.keys(errors).length > 0} onClick={() => save.mutate()}>Save charges</Button>
      </>}>
      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">Per seat, in rupees, added to the fare before GST. Coupons never discount them. Leave empty for no charge.</p>
          {stops.map((s) => (
            <div key={s.stopId} className="grid grid-cols-1 items-start gap-2 rounded-2xl bg-surface-muted/60 p-3 sm:grid-cols-[1fr_140px_140px]">
              <div className="pt-1 text-sm">
                <div className="font-semibold text-text">{s.sequence + 1}. {s.name}</div>
                <div className="text-xs text-text-muted">{[canBoard(s) && 'boarding', canDrop(s) && 'getting off'].filter(Boolean).join(' · ') || 'no boarding or getting off'}</div>
              </div>
              <Input label="Pickup ₹" inputMode="decimal" placeholder="0" disabled={!canBoard(s)} value={canBoard(s) ? draft[s.stopId]?.board ?? '' : ''}
                error={errors[`${s.stopId}.board`]} onChange={(e) => set(s.stopId, 'board', e.target.value)} />
              <Input label="Drop ₹" inputMode="decimal" placeholder="0" disabled={!canDrop(s)} value={canDrop(s) ? draft[s.stopId]?.drop ?? '' : ''}
                error={errors[`${s.stopId}.drop`]} onChange={(e) => set(s.stopId, 'drop', e.target.value)} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
