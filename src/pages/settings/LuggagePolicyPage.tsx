import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, Select, useToast } from '@/components/ui';
import { luggagePolicyApi, travelPoliciesApi, type TravelPolicies } from '@/lib/api/waitlistRules';

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
    <div className="flex flex-col gap-6">
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
    <TravelPoliciesCard />
    </div>
  );
}

const EMPTY: TravelPolicies = { pets: 'not_allowed', liquor: 'prohibited', smoking: 'prohibited', pickupWaitMinutes: 0, notes: [] };

/** Pets, liquor, smoking, pickup wait and own notes — "Other policies" under every trip, before booking. */
function TravelPoliciesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['travel-policies'], queryFn: travelPoliciesApi.get });
  const [f, setF] = useState<TravelPolicies & { wait: string; notesText: string }>({ ...EMPTY, wait: '0', notesText: '' });
  useEffect(() => {
    const p = q.data?.policies;
    if (p) setF({ ...p, wait: String(p.pickupWaitMinutes), notesText: p.notes.join('\n') });
  }, [q.data]);
  const notes = f.notesText.split('\n').map((n) => n.trim()).filter(Boolean);
  const e = {
    wait: !whole(f.wait, 0, 30) ? '0 to 30 minutes' : undefined,
    notes: notes.length > 8 ? 'At most 8 notes' : notes.some((n) => n.length < 3 || n.length > 200) ? 'Each note 3 to 200 characters' : undefined,
  };
  const done = (m: string) => { toast.success(m); void qc.invalidateQueries({ queryKey: ['travel-policies'] }); };
  const save = useMutation({
    mutationFn: () => travelPoliciesApi.set({ pets: f.pets, liquor: f.liquor, smoking: f.smoking, pickupWaitMinutes: Number(f.wait), notes }),
    onSuccess: () => done('Published — passengers see it under every trip'),
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  const reset = useMutation({ mutationFn: travelPoliciesApi.reset, onSuccess: () => done('Travel policies withdrawn'), onError: (x) => toast.error(errText(x, 'Could not withdraw')) });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const live = q.data!.policies !== null;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">Other travel policies <Badge tone={live ? 'success' : 'neutral'}>{live ? 'published' : 'not published'}</Badge></span>}
        subtitle="Shown under the seat map of every trip (Other policies). Child tickets follow your passenger policy; luggage follows the card above." />
      <CardBody className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Pets" value={f.pets} onChange={(x) => setF({ ...f, pets: x.target.value as TravelPolicies['pets'] })}
            options={[{ value: 'not_allowed', label: 'Not allowed' }, { value: 'small_in_carrier', label: 'Small pets in a closed carrier' }, { value: 'allowed', label: 'Allowed' }]} />
          <Select label="Liquor" value={f.liquor} onChange={(x) => setF({ ...f, liquor: x.target.value as TravelPolicies['liquor'] })}
            options={[{ value: 'prohibited', label: 'Prohibited — drunk passengers may be refused' }, { value: 'sealed_in_luggage', label: 'Sealed bottles in luggage only' }]} />
          <Select label="Smoking" value={f.smoking} onChange={(x) => setF({ ...f, smoking: x.target.value as TravelPolicies['smoking'] })}
            options={[{ value: 'prohibited', label: 'Prohibited' }, { value: 'at_stops_only', label: 'Only outside, at stops' }]} />
          <Input label="Bus waits at a pickup point (minutes)" type="number" value={f.wait} error={e.wait} hint="0 = leaves on time" onChange={(x) => setF({ ...f, wait: x.target.value })} />
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text">Your own notes (one per line, optional)</span>
          <textarea rows={3} value={f.notesText} onChange={(x) => setF({ ...f, notesText: x.target.value })} placeholder={'Carrying fish is not allowed\nID proof needed at boarding'}
            className="rounded-md border border-border bg-surface px-3 py-2" aria-invalid={Boolean(e.notes)} />
          {e.notes && <span className="text-xs text-danger">{e.notes}</span>}
        </label>
        <div className="flex gap-2">
          <Button loading={save.isPending} disabled={save.isPending || Object.values(e).some(Boolean)} onClick={() => save.mutate()}>{live ? 'Save' : 'Publish'}</Button>
          {live && <Button variant="ghost" loading={reset.isPending} disabled={reset.isPending} onClick={() => reset.mutate()}>Withdraw</Button>}
        </div>
      </CardBody>
    </Card>
  );
}
