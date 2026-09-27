import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, useToast } from '@/components/ui';
import { luggagePolicyApi } from '@/lib/api/waitlistRules';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const whole = (v: string, min: number, max: number) => { const n = Number(v); return v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max; };

/**
 * The luggage policy passengers see with every trip (#252, #253): what is free
 * and what more costs — per extra kg, or extra bags sold as an add-on per piece.
 */
export function LuggagePolicyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['luggage-policy'], queryFn: luggagePolicyApi.get });
  const [f, setF] = useState({ freeKg: '15', freePieces: '1', perKg: '', note: '' });
  useEffect(() => {
    const p = q.data?.policy;
    if (p) setF({ freeKg: String(p.freeKg), freePieces: String(p.freePieces), perKg: p.extraPerKgMinor === null ? '' : String(p.extraPerKgMinor / 100), note: p.note });
  }, [q.data]);
  const perKg = Number(f.perKg);
  const e = {
    freeKg: !whole(f.freeKg, 0, 100) ? '0 to 100 kg' : undefined,
    freePieces: !whole(f.freePieces, 0, 10) ? '0 to 10' : undefined,
    perKg: f.perKg.trim() !== '' && !(perKg >= 1 && perKg <= 1000) ? '₹1 to ₹1000, or empty' : undefined,
    note: f.note.length > 300 ? 'At most 300 characters' : undefined,
  };
  const done = (m: string) => { toast.success(m); void qc.invalidateQueries({ queryKey: ['luggage-policy'] }); };
  const save = useMutation({
    mutationFn: () => luggagePolicyApi.set({ freeKg: Number(f.freeKg), freePieces: Number(f.freePieces), extraPerKgMinor: f.perKg.trim() === '' ? null : Math.round(perKg * 100), note: f.note.trim() }),
    onSuccess: () => done('Published — passengers see it on every trip'),
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  const reset = useMutation({
    mutationFn: luggagePolicyApi.reset,
    onSuccess: () => done('Luggage policy withdrawn'),
    onError: (x) => toast.error(errText(x, 'Could not withdraw')),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const live = q.data!.policy !== null;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">Luggage <Badge tone={live ? 'success' : 'neutral'}>{live ? 'published' : 'not published'}</Badge></span>}
        subtitle="Shown to passengers when they choose seats and on their booking" />
      <CardBody className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input label="Free pieces" type="number" value={f.freePieces} error={e.freePieces} onChange={(x) => setF({ ...f, freePieces: x.target.value })} />
          <Input label="Free weight (kg)" type="number" value={f.freeKg} error={e.freeKg} onChange={(x) => setF({ ...f, freeKg: x.target.value })} />
          <Input label="Per extra kg (₹, optional)" type="number" value={f.perKg} error={e.perKg} hint="Empty = extra bags are sold as an add-on" onChange={(x) => setF({ ...f, perKg: x.target.value })} />
        </div>
        <Input label="Note for passengers (optional)" value={f.note} error={e.note} maxLength={300} placeholder="e.g. No gas cylinders or live animals" onChange={(x) => setF({ ...f, note: x.target.value })} />
        <p className="text-xs text-text-muted">Extra bags per piece are an add-on at checkout — set their price in <Link className="underline" to="/pricing">Settings → Add-ons</Link>.</p>
        <div className="flex gap-2">
          <Button loading={save.isPending} disabled={save.isPending || Object.values(e).some(Boolean)} onClick={() => save.mutate()}>{live ? 'Save' : 'Publish'}</Button>
          {live && <Button variant="ghost" loading={reset.isPending} disabled={reset.isPending} onClick={() => reset.mutate()}>Withdraw</Button>}
        </div>
      </CardBody>
    </Card>
  );
}
