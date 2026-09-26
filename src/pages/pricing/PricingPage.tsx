import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, IndianRupee, TrendingUp, Ticket, CheckCircle2, Users, Clock } from 'lucide-react';

import { Button, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { ConcessionsTab } from './ConcessionsTab';
import { FareBulkTools, RouteRulesTab } from './RouteRulesTab';
import { PageHeader } from '@/components/common/PageHeader';
import { pricingAdminApi, type FarePlan, type Coupon, type PricingPolicy, type YieldLadder } from '@/lib/api/pricingAdmin';
import { masterDataApi } from '@/lib/api/masterData';
import { formatMoney, cn, formatDateLabel, localDateOf, todayLocal } from '@/lib/utils';
import { ApiError } from '@/lib/api/client';

type Tab = 'plans' | 'routeRules' | 'policies' | 'coupons' | 'concessions';

export function PricingPage() {
  const [tab, setTab] = useState<Tab>('plans');
  const tabs: { key: Tab; label: string; icon: typeof IndianRupee }[] = [
    { key: 'plans', label: 'Fare Plans', icon: IndianRupee },
    { key: 'routeRules', label: 'Route limits & peak times', icon: Clock },
    { key: 'policies', label: 'Yield Policies', icon: TrendingUp },
    { key: 'coupons', label: 'Coupons', icon: Ticket },
    { key: 'concessions', label: 'Concessions & booking rules', icon: Users },
  ];
  return (
    <>
      <PageHeader title="Pricing" subtitle="Fares, dynamic yield, and discount coupons" />
      <div className="mb-6 flex gap-2 border-b border-border">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'plans' && <PlansTab />}
      {tab === 'routeRules' && <RouteRulesTab />}
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'concessions' && <ConcessionsTab />}
    </>
  );
}

function PlansTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [ruleFor, setRuleFor] = useState<FarePlan | null>(null);
  const [form, setForm] = useState({ routeId: '', name: '', currency: 'INR' });
  const [rule, setRule] = useState({ seatType: 'seater', baseFareMinor: 50000, perKmMinor: 0 });

  const plans = useQuery({ queryKey: ['fare-plans'], queryFn: pricingAdminApi.listPlans });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });
  const rules = useQuery({ queryKey: ['fare-rules', ruleFor?.id], queryFn: () => pricingAdminApi.listRules(ruleFor!.id), enabled: !!ruleFor });
  const seatOverrides = useQuery({ queryKey: ['seat-overrides', ruleFor?.id], queryFn: () => pricingAdminApi.listSeatOverrides(ruleFor!.id), enabled: !!ruleFor });
  const [seatOverride, setSeatOverride] = useState({ seatNumber: '', fareMinor: 50000 });

  const create = useMutation({
    mutationFn: () => pricingAdminApi.createPlan(form),
    onSuccess: () => { toast.success('Fare plan created — add its fares, then activate it'); setAdding(false); setForm({ routeId: '', name: '', currency: 'INR' }); void qc.invalidateQueries({ queryKey: ['fare-plans'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const activate = useMutation({
    mutationFn: (id: string) => pricingAdminApi.activatePlan(id),
    onSuccess: () => { toast.success('Plan activated'); void qc.invalidateQueries({ queryKey: ['fare-plans'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const addRule = useMutation({
    mutationFn: () => pricingAdminApi.addRule({ farePlanId: ruleFor!.id, ...rule }),
    onSuccess: () => { toast.success('Fare saved — it replaces any earlier fare for this seat type'); setRuleTried(false); void qc.invalidateQueries({ queryKey: ['fare-rules', ruleFor?.id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const setOverride = useMutation({
    mutationFn: () => pricingAdminApi.setSeatOverride(ruleFor!.id, seatOverride.seatNumber, seatOverride.fareMinor),
    onSuccess: () => { toast.success(`Seat ${seatOverride.seatNumber} priced individually`); setSeatOverride((s) => ({ ...s, seatNumber: '' })); void qc.invalidateQueries({ queryKey: ['seat-overrides', ruleFor?.id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const removeOverride = useMutation({
    mutationFn: (id: string) => pricingAdminApi.deleteSeatOverride(id),
    onSuccess: () => { toast.success('Override removed — seat back to the seat-type rule'); void qc.invalidateQueries({ queryKey: ['seat-overrides', ruleFor?.id] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const ruleError = rule.baseFareMinor < 100 ? 'A fare is at least ₹1' : rule.baseFareMinor > 10_000_000 ? 'At most ₹1,00,000' : '';
  const [ruleTried, setRuleTried] = useState(false);
  const seatFareError = seatOverride.fareMinor < 100 ? 'At least ₹1' : seatOverride.fareMinor > 10_000_000 ? 'At most ₹1,00,000' : undefined;
  const columns: Column<FarePlan>[] = [
    { key: 'name', header: 'Plan', render: (r) => <span className="font-medium text-text">{r.name}</span> },
    { key: 'route', header: 'Route', render: (r) => <span className="text-text-muted">{routes.data?.items.find((x) => x.id === r.routeId)?.name ?? '—'}</span> },
    { key: 'currency', header: 'Currency', render: (r) => r.currency },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRuleFor(r)}>Fare rules</Button>
          {r.status !== 'active' && <Button size="sm" variant="outline" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={activate.isPending && activate.variables === r.id} disabled={activate.isPending} onClick={() => activate.mutate(r.id)}>Activate</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New fare plan</Button></div>
      {plans.isLoading ? <PageLoader /> : plans.isError ? <ErrorState error={plans.error} onRetry={plans.refetch} /> :
        (plans.data?.plans.length ? <Table columns={columns} rows={plans.data.plans} /> : <EmptyState title="No fare plans yet" icon={<IndianRupee className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a fare plan"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.routeId || !form.name} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="flex flex-col gap-3">
          <Select label="Route" value={form.routeId} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}
            options={[{ label: 'Select…', value: '' }, ...(routes.data?.items.map((r) => ({ label: r.name, value: r.id })) ?? [])]} />
          <Input label="Plan name" placeholder="Standard fares" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
      </Modal>

      <Modal open={!!ruleFor} onClose={() => setRuleFor(null)} title={`Fare rules — ${ruleFor?.name ?? ''}`} size="lg">
        <div className="flex flex-col gap-4">
          {ruleFor && <FareBulkTools planId={ruleFor.id} onChanged={() => void qc.invalidateQueries({ queryKey: ['fare-rules', ruleFor.id] })} />}
          {rules.data?.rules.length ? (
            <div className="flex flex-col gap-2">
              {rules.data.rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <Badge>{r.seatType.replace('_', '-')}</Badge>
                  <span className="text-xs text-text-muted">{r.fromStopId ? 'one segment' : 'whole route'}</span>
                  <span className="font-medium text-text">{formatMoney(Number(r.baseFareMinor), 'INR')}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-text-muted">No fares yet — a bus on this route cannot be sold until its seat type has a fare.</p>}

          <div className="flex items-end gap-2 border-t border-border pt-3">
            <Select label="Seat type" value={rule.seatType} onChange={(e) => setRule((r) => ({ ...r, seatType: e.target.value }))}
              options={[{ label: 'Seater', value: 'seater' }, { label: 'Sleeper', value: 'sleeper' }, { label: 'Semi-sleeper', value: 'semi_sleeper' }]} />
            <Input label="Base fare (₹)" type="number" min={1} step="1" value={rule.baseFareMinor / 100} onChange={(e) => setRule((r) => ({ ...r, baseFareMinor: Math.round(Number(e.target.value) * 100) || 0 }))} error={ruleTried ? ruleError : undefined} />
            <Button size="sm" loading={addRule.isPending} disabled={addRule.isPending} onClick={() => { setRuleTried(true); if (!ruleError) addRule.mutate(); }}>Save rule</Button>
          </div>

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-semibold text-text">Per-seat overrides — price a specific seat number differently</div>
            {seatOverrides.data?.items.length ? (
              <div className="mb-2 flex flex-col gap-2">
                {seatOverrides.data.items.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <span className="font-mono font-medium text-text">Seat {o.seatNumber}</span>
                    <span className="text-text">{formatMoney(o.fareMinor, 'INR')}</span>
                    <Button size="sm" variant="ghost" className="text-danger" loading={removeOverride.isPending && removeOverride.variables === o.id} disabled={removeOverride.isPending} onClick={() => removeOverride.mutate(o.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            ) : <p className="mb-2 text-xs text-text-muted">No overrides yet — every seat uses the seat-type rule above.</p>}
            <div className="flex items-end gap-2">
              <Input label="Seat number" placeholder="e.g. 1 or U5" value={seatOverride.seatNumber} onChange={(e) => setSeatOverride((s) => ({ ...s, seatNumber: e.target.value }))} className="w-28" />
              <Input label="Fare (₹)" type="number" min={1} value={seatOverride.fareMinor / 100} error={seatFareError} onChange={(e) => setSeatOverride((s) => ({ ...s, fareMinor: Math.round(Number(e.target.value) * 100) || 0 }))} />
              <Button size="sm" loading={setOverride.isPending} disabled={!seatOverride.seatNumber.trim() || !!seatFareError || setOverride.isPending} onClick={() => setOverride.mutate()}>Set price</Button>
            </div>
            <p className="mt-1 text-xs text-text-muted">Applies to that seat number regardless of which stops the passenger boards/alights at, on this fare plan.</p>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** A multiplier shown as the price change it makes: 1.2 → "+20%". */
const pctOf = (mult: number) => Math.round((mult - 1) * 100);
const signed = (pct: number) => `${pct > 0 ? '+' : ''}${pct}%`;
type Step = { at: string; pct: string };
const POLICY_FORM = {
  routeId: '',
  name: '',
  occupancy: [{ at: '60', pct: '10' }, { at: '80', pct: '30' }, { at: '95', pct: '60' }] as Step[],
  advance: [{ at: '1', pct: '20' }] as Step[],
  floorPct: '-20',
  capPct: '100',
};
type PolicyForm = typeof POLICY_FORM;

/** Field → message, mirroring the API: every step −50%…+200%, each threshold once, floor ≤ 0 ≤ cap. */
function policyErrors(f: PolicyForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Give the policy a name';
  const stepPct = (v: string) => v.trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= -50 && Number(v) <= 200;
  const check = (steps: Step[], key: 'occupancy' | 'advance', min: number, max: number, unit: string) => {
    const seen = new Set<number>();
    steps.forEach((s, i) => {
      const at = Number(s.at);
      if (s.at.trim() === '' || !Number.isInteger(at) || at < min || at > max) e[`${key}.${i}.at`] = `${min}–${max} ${unit}`;
      else if (seen.has(at)) e[`${key}.${i}.at`] = 'Already used above';
      seen.add(at);
      if (!stepPct(s.pct)) e[`${key}.${i}.pct`] = '−50% to +200%';
    });
  };
  check(f.occupancy, 'occupancy', 1, 100, '%');
  check(f.advance, 'advance', 0, 365, 'days');
  const floor = Number(f.floorPct);
  const cap = Number(f.capPct);
  if (f.floorPct.trim() === '' || !Number.isInteger(floor) || floor < -50 || floor > 0) e.floorPct = '−50% to 0%';
  if (f.capPct.trim() === '' || !Number.isInteger(cap) || cap < 0 || cap > 200) e.capPct = '0% to +200%';
  return e;
}

function ladderSummary(l: YieldLadder): string[] {
  const occ = [...l.occupancy].sort((a, b) => a.atPct - b.atPct).map((s) => `${s.atPct}% sold → ${signed(pctOf(s.mult))}`);
  const adv = [...l.advancePurchase].sort((a, b) => b.withinDays - a.withinDays).map((s) => `${s.withinDays === 0 ? 'same day' : `≤ ${s.withinDays} day${s.withinDays === 1 ? '' : 's'} before`} → ${signed(pctOf(s.mult))}`);
  return [...occ, ...adv, `limits ${signed(pctOf(l.minMultiplier))} … ${signed(pctOf(l.maxMultiplier))}`];
}

function PoliciesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [tried, setTried] = useState(false);
  const [form, setForm] = useState(POLICY_FORM);
  const [stopping, setStopping] = useState<PricingPolicy | null>(null);

  const policies = useQuery({ queryKey: ['pricing-policies'], queryFn: pricingAdminApi.listPolicies });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });
  const routeName = (id: string | null) => (id ? routes.data?.items.find((r) => r.id === id)?.name ?? 'A route' : 'All routes');
  const active = policies.data?.policies.filter((p) => p.isActive) ?? [];
  const replaces = active.find((p) => (p.routeId ?? '') === form.routeId);

  const create = useMutation({
    mutationFn: () => pricingAdminApi.createPolicy({
      routeId: form.routeId || undefined,
      name: form.name.trim(),
      ladder: {
        occupancy: form.occupancy.map((s) => ({ atPct: Number(s.at), mult: 1 + Number(s.pct) / 100 })),
        advancePurchase: form.advance.map((s) => ({ withinDays: Number(s.at), mult: 1 + Number(s.pct) / 100 })),
        minMultiplier: 1 + Number(form.floorPct) / 100,
        maxMultiplier: 1 + Number(form.capPct) / 100,
      },
    }),
    onSuccess: () => { toast.success(`${form.name.trim()} now prices ${form.routeId ? routeName(form.routeId) : 'every route without its own policy'}`); setAdding(false); void qc.invalidateQueries({ queryKey: ['pricing-policies'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const stop = useMutation({
    mutationFn: (id: string) => pricingAdminApi.deactivatePolicy(id),
    onSuccess: () => { toast.success('Policy switched off — those routes sell at their plain fares'); setStopping(null); void qc.invalidateQueries({ queryKey: ['pricing-policies'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const errors = policyErrors(form);
  const err = (k: string) => (tried ? errors[k] : undefined);
  const open = () => { setForm(POLICY_FORM); setTried(false); create.reset(); setAdding(true); };
  const submit = () => { setTried(true); if (Object.keys(errors).length === 0) create.mutate(); };
  const setStep = (key: 'occupancy' | 'advance', i: number, patch: Partial<Step>) =>
    setForm((f) => ({ ...f, [key]: f[key].map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const addStep = (key: 'occupancy' | 'advance') => setForm((f) => ({ ...f, [key]: [...f[key], { at: '', pct: '' }] }));
  const removeStep = (key: 'occupancy' | 'advance', i: number) => setForm((f) => ({ ...f, [key]: f[key].filter((_, j) => j !== i) }));

  const columns: Column<PricingPolicy>[] = [
    { key: 'name', header: 'Policy', render: (r) => <span className="font-medium text-text">{r.name}</span> },
    { key: 'scope', header: 'Applies to', render: (r) => routeName(r.routeId) },
    { key: 'ladder', header: 'Price changes', render: (r) => <ul className="text-xs text-text-muted">{ladderSummary(r.ladder).map((l) => <li key={l}>{l}</li>)}</ul> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Off'}</Badge> },
    { key: 'actions', header: '', render: (r) => r.isActive ? <div className="flex justify-end"><Button size="sm" variant="ghost" className="text-danger" onClick={() => setStopping(r)}>Switch off</Button></div> : null },
  ];

  const stepRows = (key: 'occupancy' | 'advance', atLabel: string, unit: string, max: number) => (
    <div className="flex flex-col gap-2">
      {form[key].map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
          <Input label={i === 0 ? `${atLabel} (${unit})` : undefined} aria-label={`${atLabel} ${i + 1}`} type="number" min={key === 'occupancy' ? 1 : 0} max={max} value={s.at} error={err(`${key}.${i}.at`)} onChange={(e) => setStep(key, i, { at: e.target.value })} />
          <Input label={i === 0 ? 'Price change %' : undefined} aria-label={`Price change ${key} ${i + 1}`} type="number" min={-50} max={200} value={s.pct} error={err(`${key}.${i}.pct`)} onChange={(e) => setStep(key, i, { pct: e.target.value })} />
          <Button size="sm" variant="ghost" className={cn('text-danger', i === 0 && 'mt-6')} aria-label={`Remove step ${i + 1}`} onClick={() => removeStep(key, i)}>Remove</Button>
        </div>
      ))}
      {form[key].length < 10 && <div><Button size="sm" variant="outline" leftIcon={<Plus className="h-4 w-4" />} onClick={() => addStep(key)}>Add step</Button></div>}
    </div>
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-text-muted">A yield policy raises or lowers fares as a bus fills up and as departure gets close. A route’s own policy wins over the all-routes one.</p>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={open}>New policy</Button>
      </div>
      {policies.isLoading ? <PageLoader /> : policies.isError ? <ErrorState error={policies.error} onRetry={policies.refetch} /> :
        (policies.data?.policies.length ? <Table columns={columns} rows={policies.data.policies} /> : <EmptyState title="No yield policies" description="Fares stay exactly as set in the fare plans until you add one." icon={<TrendingUp className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a yield policy" size="lg"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)} disabled={create.isPending}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending || (tried && Object.keys(errors).length > 0)} onClick={submit}>{replaces ? 'Replace policy' : 'Create policy'}</Button></>}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Applies to" value={form.routeId} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}
              options={[{ label: 'All routes', value: '' }, ...(routes.data?.items.map((r) => ({ label: r.name, value: r.id })) ?? [])]} />
            <Input label="Policy name" placeholder="Weekend demand" maxLength={120} value={form.name} error={err('name')} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          {replaces && <p className="rounded-md bg-warning/10 p-2 text-xs text-text">This replaces <strong>{replaces.name}</strong>, the active policy for {routeName(replaces.routeId)}.</p>}
          <div>
            <div className="mb-2 text-sm font-semibold text-text">As the bus fills up</div>
            {stepRows('occupancy', 'When sold reaches', '%', 100)}
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold text-text">Close to departure</div>
            {stepRows('advance', 'Booked within', 'days', 365)}
            <p className="mt-1 text-xs text-text-muted">The closest window applies — e.g. “within 1 day +20%” beats “within 7 days +10%” for a booking made the day before.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <Input label="Never cheaper than (%)" type="number" min={-50} max={0} value={form.floorPct} error={err('floorPct')} hint="e.g. −20 = at most 20% off the fare" onChange={(e) => setForm((f) => ({ ...f, floorPct: e.target.value }))} />
            <Input label="Never dearer than (%)" type="number" min={0} max={200} value={form.capPct} error={err('capPct')} hint="e.g. 100 = at most double the fare" onChange={(e) => setForm((f) => ({ ...f, capPct: e.target.value }))} />
          </div>
        </div>
      </Modal>

      <Modal open={!!stopping} onClose={() => setStopping(null)} title="Switch off this policy?"
        footer={<><Button variant="ghost" onClick={() => setStopping(null)} disabled={stop.isPending}>Keep it</Button><Button variant="danger" loading={stop.isPending} onClick={() => stopping && stop.mutate(stopping.id)}>Switch off</Button></>}>
        <p className="text-sm text-text">{stopping?.name} stops changing fares on {routeName(stopping?.routeId ?? null).toLowerCase() === 'all routes' ? 'routes without their own policy' : routeName(stopping?.routeId ?? null)}. Quotes already given keep their price.</p>
      </Modal>
    </>
  );
}

const COUPON_FORM = { code: '', kind: 'percent' as 'percent' | 'flat', value: '10', maxDiscount: '', minFare: '', validTo: '', maxRedemptions: '100', perUserLimit: '1', firstBookingOnly: false, description: '' };
type CouponForm = typeof COUPON_FORM;

/** Client-side mirror of the API's coupon rules — each message sits next to its field. */
function couponErrors(f: CouponForm, today: string): Record<string, string> {
  const e: Record<string, string> = {};
  const code = f.code.trim();
  if (!code) e.code = 'Enter a code';
  else if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) e.code = '2–40 letters or digits (dash and underscore allowed)';
  const v = Number(f.value);
  if (f.value.trim() === '' || !Number.isFinite(v)) e.value = 'Enter an amount';
  else if (f.kind === 'percent' && (!Number.isInteger(v) || v < 1 || v > 100)) e.value = 'A whole percentage from 1 to 100';
  else if (f.kind === 'flat' && (v < 1 || v > 100_000)) e.value = 'From ₹1 to ₹1,00,000';
  if (f.kind === 'percent' && f.maxDiscount.trim() && !(Number(f.maxDiscount) >= 1)) e.maxDiscount = 'At least ₹1, or leave empty';
  if (f.minFare.trim() && !(Number(f.minFare) >= 0)) e.minFare = 'Zero or more, or leave empty';
  if (f.validTo && f.validTo < today) e.validTo = 'Pick today or a later date';
  if (f.maxRedemptions.trim() && !(Number.isInteger(Number(f.maxRedemptions)) && Number(f.maxRedemptions) >= 1)) e.maxRedemptions = 'At least 1, or leave empty for no limit';
  if (!(Number.isInteger(Number(f.perUserLimit)) && Number(f.perUserLimit) >= 1 && Number(f.perUserLimit) <= 100)) e.perUserLimit = 'From 1 to 100';
  return e;
}

/** Last moment of a local calendar day, as an instant the API accepts. */
function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

function CouponsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [tried, setTried] = useState(false);
  const [viewingStats, setViewingStats] = useState<Coupon | null>(null);
  const [form, setForm] = useState(COUPON_FORM);
  const set = <K extends keyof CouponForm>(k: K, v: CouponForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const today = todayLocal();

  const coupons = useQuery({ queryKey: ['coupons'], queryFn: pricingAdminApi.listCoupons });
  const stats = useQuery({ queryKey: ['coupon-stats', viewingStats?.id], queryFn: () => pricingAdminApi.couponStats(viewingStats!.id), enabled: !!viewingStats });

  const rupees = (s: string) => (s.trim() === '' ? undefined : Math.round(Number(s) * 100));
  const create = useMutation({
    mutationFn: () => pricingAdminApi.createCoupon({
      code: form.code.trim(),
      kind: form.kind,
      // Percent as a whole number; a flat discount in paise, like every amount the API takes.
      value: form.kind === 'percent' ? Number(form.value) : Math.round(Number(form.value) * 100),
      maxDiscountMinor: form.kind === 'percent' ? rupees(form.maxDiscount) : undefined,
      minFareMinor: rupees(form.minFare),
      validTo: form.validTo ? endOfDay(form.validTo) : undefined,
      maxRedemptions: form.maxRedemptions.trim() ? Number(form.maxRedemptions) : undefined,
      perUserLimit: Number(form.perUserLimit),
      firstBookingOnly: form.firstBookingOnly,
      description: form.description.trim() || undefined,
    }),
    onSuccess: () => { toast.success(`Coupon ${form.code.trim()} created — customers can use it now`); setAdding(false); void qc.invalidateQueries({ queryKey: ['coupons'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const toggle = useMutation({
    mutationFn: (c: Coupon) => (c.isActive === false ? pricingAdminApi.enableCoupon(c.id) : pricingAdminApi.disableCoupon(c.id)),
    onSuccess: (_d, c) => { toast.success(c.isActive === false ? `${c.code} is on again` : `${c.code} switched off — it stops applying straight away`); void qc.invalidateQueries({ queryKey: ['coupons'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const local = couponErrors(form, today);
  const server = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const fieldError = (k: keyof CouponForm, apiKey: string = k) => (tried ? local[k] : undefined) ?? server[apiKey];
  const open = () => { setForm(COUPON_FORM); setTried(false); create.reset(); setAdding(true); };
  const submit = () => { setTried(true); if (Object.keys(local).length === 0) create.mutate(); };

  const expired = (c: Coupon) => !!c.validTo && Date.parse(c.validTo) < Date.now();
  const usedUp = (c: Coupon) => c.maxRedemptions != null && c.usageCount >= c.maxRedemptions;
  const columns: Column<Coupon>[] = [
    { key: 'code', header: 'Code', render: (r) => <div><div className="font-mono text-sm font-semibold text-text">{r.code}</div>{r.description && <div className="text-xs text-text-muted">{r.description}</div>}</div> },
    {
      key: 'value', header: 'Discount', render: (r) => (
        <div>
          <div className="font-medium text-text">{r.kind === 'percent' ? `${r.value}% off` : `${formatMoney(Number(r.value), 'INR')} off`}</div>
          <div className="text-xs text-text-muted">
            {[r.maxDiscountMinor ? `up to ${formatMoney(Number(r.maxDiscountMinor), 'INR')}` : null, r.minFareMinor ? `fares from ${formatMoney(Number(r.minFareMinor), 'INR')}` : null].filter(Boolean).join(' · ') || 'any fare'}
          </div>
        </div>
      ),
    },
    { key: 'usage', header: 'Used', render: (r) => <span>{r.usageCount}{r.maxRedemptions ? ` / ${r.maxRedemptions}` : ' (no limit)'}{r.perUserLimit ? <span className="block text-xs text-text-muted">{r.perUserLimit}× per customer</span> : null}</span> },
    { key: 'valid', header: 'Valid till', render: (r) => r.validTo ? <span className={expired(r) ? 'text-danger' : ''}>{formatDateLabel(localDateOf(r.validTo), { day: '2-digit', month: 'short', year: 'numeric' })}</span> : <span className="text-text-muted">No end date</span> },
    { key: 'flags', header: 'Flags', render: (r) => <div className="flex gap-1">{r.firstBookingOnly && <Badge>First booking</Badge>}</div> },
    {
      key: 'status', header: 'Status', render: (r) => {
        const [tone, label] = r.isActive === false ? ['neutral', 'Off'] : expired(r) ? ['danger', 'Expired'] : usedUp(r) ? ['warning', 'Used up'] : ['success', 'Active'];
        return <Badge tone={tone as 'neutral'}>{label}</Badge>;
      },
    },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setViewingStats(r)}>Stats</Button>
          <Button size="sm" variant={r.isActive === false ? 'outline' : 'ghost'} className={r.isActive === false ? undefined : 'text-danger'}
            loading={toggle.isPending && toggle.variables?.id === r.id} disabled={toggle.isPending}
            onClick={() => toggle.mutate(r)}>{r.isActive === false ? 'Switch on' : 'Switch off'}</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={open}>New coupon</Button></div>
      {coupons.isLoading ? <PageLoader /> : coupons.isError ? <ErrorState error={coupons.error} onRetry={coupons.refetch} /> :
        (coupons.data?.coupons.length ? <Table columns={columns} rows={coupons.data.coupons} /> : <EmptyState title="No coupons yet" description="Create a code customers enter at checkout for a discount." icon={<Ticket className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a coupon"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)} disabled={create.isPending}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending || (tried && Object.keys(local).length > 0)} onClick={submit}>Create coupon</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Input label="Coupon code" placeholder="FIRST50" value={form.code} error={fieldError('code')} hint="What customers type at checkout" onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} /></div>
          <Select label="Type" value={form.kind} onChange={(e) => set('kind', e.target.value as 'percent' | 'flat')}
            options={[{ label: 'Percent off', value: 'percent' }, { label: 'Flat amount off', value: 'flat' }]} />
          <Input label={form.kind === 'percent' ? 'Percent off' : 'Amount off (₹)'} type="number" min={1} max={form.kind === 'percent' ? 100 : undefined} value={form.value} error={fieldError('value')} onChange={(e) => set('value', e.target.value)} />
          {form.kind === 'percent' && <Input label="Maximum discount (₹)" type="number" min={1} placeholder="No cap" value={form.maxDiscount} error={fieldError('maxDiscount', 'maxDiscountMinor')} onChange={(e) => set('maxDiscount', e.target.value)} />}
          <Input label="Minimum fare (₹)" type="number" min={0} placeholder="Any fare" value={form.minFare} error={fieldError('minFare', 'minFareMinor')} onChange={(e) => set('minFare', e.target.value)} />
          <Input label="Valid till" type="date" min={today} value={form.validTo} error={fieldError('validTo')} hint="Leave empty for no end date" onChange={(e) => set('validTo', e.target.value)} />
          <Input label="Total uses" type="number" min={1} placeholder="No limit" value={form.maxRedemptions} error={fieldError('maxRedemptions')} onChange={(e) => set('maxRedemptions', e.target.value)} />
          <Input label="Uses per customer" type="number" min={1} max={100} value={form.perUserLimit} error={fieldError('perUserLimit')} onChange={(e) => set('perUserLimit', e.target.value)} />
          <div className="col-span-2"><Input label="Description (internal note)" maxLength={300} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={form.firstBookingOnly} onChange={(e) => set('firstBookingOnly', e.target.checked)} /> Only for a customer’s first booking</label>
        </div>
      </Modal>

      <Modal open={!!viewingStats} onClose={() => setViewingStats(null)} title={`Stats — ${viewingStats?.code ?? ''}`}>
        {stats.isLoading ? <PageLoader /> : stats.data && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><span className="text-text-muted">Redemptions</span><span className="font-medium text-text">{stats.data.usageCount}{stats.data.maxRedemptions ? ` / ${stats.data.maxRedemptions}` : ''}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Total discount given</span><span className="font-medium text-text">{formatMoney(stats.data.estimatedDiscountGivenMinor, 'INR')}</span></div>
          </div>
        )}
      </Modal>
    </>
  );
}
