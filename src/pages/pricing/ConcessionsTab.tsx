import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, Card, CardBody, ErrorState, Input, Modal, PageLoader, useToast } from '@/components/ui';
import { concessionsApi, type ConcessionCategory, type ConcessionSettings } from '@/lib/api/concessions';
import { formatMoney, todayLocal } from '@/lib/utils';

const CATEGORIES: { key: ConcessionCategory; label: string; hint: string }[] = [
  { key: 'child', label: 'Children', hint: 'Age band below adult age' },
  { key: 'senior', label: 'Senior citizens', hint: 'From a starting age' },
  { key: 'student', label: 'Students', hint: 'Usually with ID proof' },
  { key: 'defence', label: 'Defence personnel', hint: 'With service ID' },
  { key: 'disabled', label: 'Passengers with disability', hint: 'Also keeps accessible seats for them' },
];
const intOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
const isInt = (v: string, min: number, max: number) => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max);

/** Who travels cheaper, and when sales open and close. */
export function ConcessionsTab() {
  const q = useQuery({ queryKey: ['concessions'], queryFn: concessionsApi.get });
  const [editing, setEditing] = useState<ConcessionCategory | null>(null);
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data;
  return (
    <div className="flex flex-col gap-4">
      <Card><CardBody>
        <div className="mb-2 font-semibold text-text">Concessions</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {CATEGORIES.map((c) => {
            const r = s.rules.find((x) => x.category === c.key);
            return (
              <div key={c.key} className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                <div>
                  <div className="font-medium">{c.label} {r?.active ? <Badge tone="success">{Number(r.discountPct)}% off</Badge> : <Badge tone="neutral">Off</Badge>}</div>
                  <div className="text-xs text-text-muted">{r?.active ? [r.minAge != null && `from ${r.minAge}`, r.maxAge != null && `up to ${r.maxAge}`, r.requiresIdProof && 'ID proof', r.maxPerBooking && `max ${r.maxPerBooking}/booking`, r.validTo && `till ${r.validTo}`].filter(Boolean).join(' · ') || 'Any age' : c.hint}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditing(c.key)}>{r ? 'Edit' : 'Set up'}</Button>
              </div>
            );
          })}
        </div>
      </CardBody></Card>
      <PolicyCard s={s} />
      {editing && <RuleModal category={editing} settings={s} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RuleModal({ category, settings, onClose }: { category: ConcessionCategory; settings: ConcessionSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const existing = settings.rules.find((r) => r.category === category);
  const [f, setF] = useState({
    discountPct: existing ? String(Number(existing.discountPct)) : '', minAge: existing?.minAge?.toString() ?? '', maxAge: existing?.maxAge?.toString() ?? '',
    requiresIdProof: existing?.requiresIdProof ?? category !== 'child', validFrom: existing?.validFrom ?? '', validTo: existing?.validTo ?? '',
    maxPerBooking: existing?.maxPerBooking?.toString() ?? '', active: existing?.active ?? true,
  });
  const p = settings.policy;
  const e: Record<string, string> = {};
  const pct = Number(f.discountPct);
  if (f.discountPct === '' || !(pct >= 0 && pct <= 100)) e.discountPct = '0 to 100';
  else if (f.active && pct === 0) e.discountPct = '0% gives nothing — switch it off instead';
  if (!isInt(f.minAge, 0, 120)) e.minAge = 'An age';
  if (!isInt(f.maxAge, 0, 120)) e.maxAge = 'An age';
  if (!e.minAge && !e.maxAge && f.minAge && f.maxAge && Number(f.minAge) > Number(f.maxAge)) e.maxAge = 'Below the starting age';
  if (category === 'child') {
    if (!f.maxAge) e.maxAge = 'Oldest age that counts as a child';
    else if (Number(f.maxAge) >= p.adultAge) e.maxAge = `Must be below adult age (${p.adultAge})`;
    if (f.minAge && Number(f.minAge) < p.infantMaxAge) e.minAge = `Under ${p.infantMaxAge} travel as infants`;
  }
  if (category === 'senior') {
    if (!f.minAge) e.minAge = 'Age from which someone is a senior';
    else if (Number(f.minAge) < p.adultAge) e.minAge = 'At least adult age';
  }
  if (!isInt(f.maxPerBooking, 1, 10)) e.maxPerBooking = '1 to 10, or empty';
  if (f.validFrom && f.validTo && f.validFrom > f.validTo) e.validTo = 'After the start date';
  if (f.validTo && f.validTo < todayLocal()) e.validTo = 'Already passed';
  const save = useMutation({
    mutationFn: () => concessionsApi.saveRule({ category, discountPct: pct, minAge: intOrNull(f.minAge), maxAge: intOrNull(f.maxAge), requiresIdProof: f.requiresIdProof, validFrom: f.validFrom || null, validTo: f.validTo || null, maxPerBooking: intOrNull(f.maxPerBooking), active: f.active }),
    onSuccess: () => { toast.success('Concession saved — applies to new bookings'); void qc.invalidateQueries({ queryKey: ['concessions'] }); onClose(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });
  const label = CATEGORIES.find((c) => c.key === category)!.label;
  return (
    <Modal open onClose={onClose} title={`Concession — ${label}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={save.isPending || Object.keys(e).length > 0} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(x) => setF({ ...f, active: x.target.checked })} /> Offer this concession</label>
        <Input label="Discount %" type="number" value={f.discountPct} error={e.discountPct} onChange={(x) => setF({ ...f, discountPct: x.target.value })} />
        <Input label="Max per booking (optional)" type="number" value={f.maxPerBooking} error={e.maxPerBooking} onChange={(x) => setF({ ...f, maxPerBooking: x.target.value })} />
        <Input label="From age" type="number" value={f.minAge} error={e.minAge} onChange={(x) => setF({ ...f, minAge: x.target.value })} />
        <Input label="Up to age" type="number" value={f.maxAge} error={e.maxAge} onChange={(x) => setF({ ...f, maxAge: x.target.value })} />
        <Input label="Journeys from (optional)" type="date" value={f.validFrom} onChange={(x) => setF({ ...f, validFrom: x.target.value })} />
        <Input label="Journeys until (optional)" type="date" value={f.validTo} min={todayLocal()} error={e.validTo} onChange={(x) => setF({ ...f, validTo: x.target.value })} />
        <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={f.requiresIdProof} onChange={(x) => setF({ ...f, requiresIdProof: x.target.checked })} /> Ask for ID proof at booking (checked at boarding)</label>
      </div>
    </Modal>
  );
}

function PolicyCard({ s }: { s: ConcessionSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [p, setP] = useState({ adultAge: String(s.policy.adultAge), infantMaxAge: String(s.policy.infantMaxAge), infantFee: String(s.policy.infantFeeMinor / 100), unaccompanied: s.policy.allowUnaccompaniedMinors });
  const [w, setW] = useState({ maxAdvanceDays: s.bookingWindow.maxAdvanceDays?.toString() ?? '', minMinutes: String(s.bookingWindow.minMinutesBeforeDeparture), accessible: s.accessibleSeats.releaseHours?.toString() ?? '' });
  const [rt, setRt] = useState(String(s.roundTrip?.discountPct ?? 0));
  const rtError = isInt(rt, 0, 50) && rt !== '' ? undefined : 'A whole number from 0 to 50';
  const done = (m: string) => ({ onSuccess: () => { toast.success(m); void qc.invalidateQueries({ queryKey: ['concessions'] }); }, onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed') });
  const pe: Record<string, string> = {};
  if (!isInt(p.adultAge, 12, 21) || !p.adultAge) pe.adultAge = '12 to 21';
  if (!isInt(p.infantMaxAge, 1, 6) || !p.infantMaxAge) pe.infantMaxAge = '1 to 6';
  if (!(Number(p.infantFee) >= 0 && Number(p.infantFee) <= 10000) || p.infantFee === '') pe.infantFee = '₹0 to ₹10,000';
  const child = s.rules.find((r) => r.category === 'child' && r.active);
  if (!pe.adultAge && child?.maxAge != null && Number(p.adultAge) <= child.maxAge) pe.adultAge = `Your child concession runs to ${child.maxAge}`;
  const we: Record<string, string> = {};
  if (!isInt(w.maxAdvanceDays, 1, 365)) we.maxAdvanceDays = '1 to 365, or empty for no limit';
  if (!isInt(w.minMinutes, 0, 1440) || w.minMinutes === '') we.minMinutes = '0 to 1440 minutes';
  if (!isInt(w.accessible, 0, 720)) we.accessible = '0 to 720 hours, or empty';
  const policy = useMutation({ mutationFn: () => concessionsApi.savePolicy({ adultAge: Number(p.adultAge), infantMaxAge: Number(p.infantMaxAge), infantFeeMinor: Math.round(Number(p.infantFee) * 100), allowUnaccompaniedMinors: p.unaccompanied }), ...done('Passenger rules saved') });
  const windowM = useMutation({
    mutationFn: async () => {
      await concessionsApi.saveBookingWindow({ maxAdvanceDays: intOrNull(w.maxAdvanceDays), minMinutesBeforeDeparture: Number(w.minMinutes) });
      await concessionsApi.saveAccessibleSeats(intOrNull(w.accessible));
    },
    ...done('Booking rules saved'),
  });
  const roundTrip = useMutation({ mutationFn: () => concessionsApi.saveRoundTrip(Number(rt)), ...done('Round-trip discount saved') });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card><CardBody className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2 font-semibold text-text">Passengers</div>
        <Input label="Adult from age" type="number" value={p.adultAge} error={pe.adultAge} onChange={(x) => setP({ ...p, adultAge: x.target.value })} />
        <Input label="Infants are under" type="number" value={p.infantMaxAge} error={pe.infantMaxAge} onChange={(x) => setP({ ...p, infantMaxAge: x.target.value })} />
        <Input label="Infant fee (₹, 0 = free)" type="number" value={p.infantFee} error={pe.infantFee} hint={Number(p.infantFee) > 0 ? `${formatMoney(Math.round(Number(p.infantFee) * 100))} per infant, no seat` : 'Travel free on a lap'} onChange={(x) => setP({ ...p, infantFee: x.target.value })} />
        <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={p.unaccompanied} onChange={(x) => setP({ ...p, unaccompanied: x.target.checked })} /> Minors may travel alone</label>
        <div className="col-span-2 flex justify-end"><Button size="sm" loading={policy.isPending} disabled={policy.isPending || Object.keys(pe).length > 0} onClick={() => policy.mutate()}>Save passenger rules</Button></div>
      </CardBody></Card>
      <Card><CardBody className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2 font-semibold text-text">When people can book</div>
        <Input label="Sales open (days ahead)" type="number" value={w.maxAdvanceDays} error={we.maxAdvanceDays} hint="Empty = as soon as trips exist" onChange={(x) => setW({ ...w, maxAdvanceDays: x.target.value })} />
        <Input label="Sales close (minutes before departure)" type="number" value={w.minMinutes} error={we.minMinutes} onChange={(x) => setW({ ...w, minMinutes: x.target.value })} />
        <Input label="Accessible seats open to all (hours before)" type="number" value={w.accessible} error={we.accessible} hint="Empty = only for passengers with disability" onChange={(x) => setW({ ...w, accessible: x.target.value })} />
        <div className="col-span-2 flex justify-end"><Button size="sm" loading={windowM.isPending} disabled={windowM.isPending || Object.keys(we).length > 0} onClick={() => windowM.mutate()}>Save booking rules</Button></div>
      </CardBody></Card>
      <Card><CardBody className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2 font-semibold text-text">Round trip</div>
        <Input label="Discount on the way back (%)" type="number" value={rt} error={rtError} hint={Number(rt) > 0 && !rtError ? `${rt}% off the return, when booked against a confirmed onward booking with you` : '0 = no round-trip discount'} onChange={(x) => setRt(x.target.value)} />
        <p className="self-end pb-2 text-xs text-text-muted">Same passenger (account or booking mobile), back the way they came, on a later bus — once per onward booking.</p>
        <div className="col-span-2 flex justify-end"><Button size="sm" loading={roundTrip.isPending} disabled={roundTrip.isPending || Boolean(rtError)} onClick={() => roundTrip.mutate()}>Save round-trip discount</Button></div>
      </CardBody></Card>
    </div>
  );
}
