import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, IndianRupee, TrendingUp, Ticket, CheckCircle2 } from 'lucide-react';

import { Button, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { pricingAdminApi, type FarePlan, type Coupon, type PricingPolicy } from '@/lib/api/pricingAdmin';
import { masterDataApi } from '@/lib/api/masterData';
import { formatMoney, cn } from '@/lib/utils';

type Tab = 'plans' | 'policies' | 'coupons';

export function PricingPage() {
  const [tab, setTab] = useState<Tab>('plans');
  const tabs: { key: Tab; label: string; icon: typeof IndianRupee }[] = [
    { key: 'plans', label: 'Fare Plans', icon: IndianRupee },
    { key: 'policies', label: 'Yield Policies', icon: TrendingUp },
    { key: 'coupons', label: 'Coupons', icon: Ticket },
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
      {tab === 'policies' && <PoliciesTab />}
      {tab === 'coupons' && <CouponsTab />}
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
    onSuccess: () => { toast.success('Fare plan created'); setAdding(false); void qc.invalidateQueries({ queryKey: ['fare-plans'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const activate = useMutation({
    mutationFn: (id: string) => pricingAdminApi.activatePlan(id),
    onSuccess: () => { toast.success('Plan activated'); void qc.invalidateQueries({ queryKey: ['fare-plans'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const addRule = useMutation({
    mutationFn: () => pricingAdminApi.addRule({ farePlanId: ruleFor!.id, ...rule }),
    onSuccess: () => { toast.success('Fare rule saved'); void qc.invalidateQueries({ queryKey: ['fare-rules', ruleFor?.id] }); },
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

  const columns: Column<FarePlan>[] = [
    { key: 'name', header: 'Plan', render: (r) => <span className="font-medium text-text">{r.name}</span> },
    { key: 'currency', header: 'Currency', render: (r) => r.currency },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRuleFor(r)}>Fare rules</Button>
          {r.status !== 'active' && <Button size="sm" variant="outline" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate(r.id)}>Activate</Button>}
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
          {rules.data?.rules.length ? (
            <div className="flex flex-col gap-2">
              {rules.data.rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <Badge>{r.seatType}</Badge>
                  <span className="font-medium text-text">{formatMoney(r.baseFareMinor, 'INR')}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-text-muted">No rules yet — whole-route fares apply per seat type below.</p>}

          <div className="flex items-end gap-2 border-t border-border pt-3">
            <Select label="Seat type" value={rule.seatType} onChange={(e) => setRule((r) => ({ ...r, seatType: e.target.value }))}
              options={[{ label: 'Seater', value: 'seater' }, { label: 'Sleeper', value: 'sleeper' }, { label: 'Semi-sleeper', value: 'semi_sleeper' }]} />
            <Input label="Base fare (₹)" type="number" value={rule.baseFareMinor / 100} onChange={(e) => setRule((r) => ({ ...r, baseFareMinor: Math.round(Number(e.target.value) * 100) }))} />
            <Button size="sm" loading={addRule.isPending} onClick={() => addRule.mutate()}>Save rule</Button>
          </div>

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-semibold text-text">Per-seat overrides — price a specific seat number differently</div>
            {seatOverrides.data?.items.length ? (
              <div className="mb-2 flex flex-col gap-2">
                {seatOverrides.data.items.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <span className="font-mono font-medium text-text">Seat {o.seatNumber}</span>
                    <span className="text-text">{formatMoney(o.fareMinor, 'INR')}</span>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => removeOverride.mutate(o.id)}>Remove</Button>
                  </div>
                ))}
              </div>
            ) : <p className="mb-2 text-xs text-text-muted">No overrides yet — every seat uses the seat-type rule above.</p>}
            <div className="flex items-end gap-2">
              <Input label="Seat number" placeholder="e.g. 1 or U5" value={seatOverride.seatNumber} onChange={(e) => setSeatOverride((s) => ({ ...s, seatNumber: e.target.value }))} className="w-28" />
              <Input label="Fare (₹)" type="number" value={seatOverride.fareMinor / 100} onChange={(e) => setSeatOverride((s) => ({ ...s, fareMinor: Math.round(Number(e.target.value) * 100) }))} />
              <Button size="sm" loading={setOverride.isPending} disabled={!seatOverride.seatNumber.trim()} onClick={() => setOverride.mutate()}>Set price</Button>
            </div>
            <p className="mt-1 text-xs text-text-muted">Applies to that seat number regardless of which stops the passenger boards/alights at, on this fare plan.</p>
          </div>
        </div>
      </Modal>
    </>
  );
}

function PoliciesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', gstRatePct: 5 });

  const policies = useQuery({ queryKey: ['pricing-policies'], queryFn: pricingAdminApi.listPolicies });

  const create = useMutation({
    mutationFn: () => pricingAdminApi.createPolicy({
      name: form.name, gstRatePct: form.gstRatePct,
      ladder: { occupancy: [{ atPct: 60, mult: 1.1 }, { atPct: 80, mult: 1.3 }, { atPct: 95, mult: 1.6 }], advancePurchase: [{ withinDays: 1, mult: 1.2 }], maxMultiplier: 2, minMultiplier: 0.8 },
    }),
    onSuccess: () => { toast.success('Policy created'); setAdding(false); void qc.invalidateQueries({ queryKey: ['pricing-policies'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const columns: Column<PricingPolicy>[] = [
    { key: 'name', header: 'Policy', render: (r) => <span className="font-medium text-text">{r.name}</span> },
    { key: 'gst', header: 'GST %', render: (r) => `${r.gstRatePct}%` },
    { key: 'scope', header: 'Scope', render: (r) => r.routeId ? 'Route-specific' : 'Tenant default' },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New policy</Button></div>
      {policies.isLoading ? <PageLoader /> : policies.isError ? <ErrorState error={policies.error} onRetry={policies.refetch} /> :
        (policies.data?.policies.length ? <Table columns={columns} rows={policies.data.policies} /> : <EmptyState title="No pricing policies yet" description="A default yield ladder + GST rate applies until you add one." icon={<TrendingUp className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a yield policy"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.name} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Policy name" placeholder="Standard yield" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="GST rate %" type="number" value={form.gstRatePct} onChange={(e) => setForm((f) => ({ ...f, gstRatePct: Number(e.target.value) || 0 }))} />
          <p className="text-xs text-text-muted">Uses a sensible default occupancy/advance-purchase yield ladder — edit rules via API for fine control.</p>
        </div>
      </Modal>
    </>
  );
}

function CouponsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [viewingStats, setViewingStats] = useState<Coupon | null>(null);
  const [form, setForm] = useState({ code: '', kind: 'percent' as 'percent' | 'flat', value: 10, maxRedemptions: 100, firstBookingOnly: false, description: '' });

  const coupons = useQuery({ queryKey: ['coupons'], queryFn: pricingAdminApi.listCoupons });
  const stats = useQuery({ queryKey: ['coupon-stats', viewingStats?.id], queryFn: () => pricingAdminApi.couponStats(viewingStats!.id), enabled: !!viewingStats });

  const create = useMutation({
    mutationFn: () => pricingAdminApi.createCoupon(form),
    onSuccess: () => { toast.success('Coupon created'); setAdding(false); void qc.invalidateQueries({ queryKey: ['coupons'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const disable = useMutation({
    mutationFn: (id: string) => pricingAdminApi.disableCoupon(id),
    onSuccess: () => { toast.success('Coupon disabled'); void qc.invalidateQueries({ queryKey: ['coupons'] }); },
  });
  const enable = useMutation({
    mutationFn: (id: string) => pricingAdminApi.enableCoupon(id),
    onSuccess: () => { toast.success('Coupon enabled'); void qc.invalidateQueries({ queryKey: ['coupons'] }); },
  });

  const columns: Column<Coupon>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-sm font-semibold text-text">{r.code}</span> },
    { key: 'value', header: 'Discount', render: (r) => r.kind === 'percent' ? `${r.value}%` : formatMoney(r.value, 'INR') },
    { key: 'usage', header: 'Used', render: (r) => `${r.usageCount}${r.maxRedemptions ? ` / ${r.maxRedemptions}` : ''}` },
    { key: 'flags', header: 'Flags', render: (r) => <div className="flex gap-1">{r.firstBookingOnly && <Badge>First-booking</Badge>}</div> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.isActive === false ? 'neutral' : 'success'}>{r.isActive === false ? 'Disabled' : 'Active'}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setViewingStats(r)}>Stats</Button>
          {r.isActive === false
            ? <Button size="sm" variant="outline" onClick={() => enable.mutate(r.id)}>Enable</Button>
            : <Button size="sm" variant="ghost" className="text-danger" onClick={() => disable.mutate(r.id)}>Disable</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New coupon</Button></div>
      {coupons.isLoading ? <PageLoader /> : coupons.isError ? <ErrorState error={coupons.error} onRetry={coupons.refetch} /> :
        (coupons.data?.coupons.length ? <Table columns={columns} rows={coupons.data.coupons} /> : <EmptyState title="No coupons yet" icon={<Ticket className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a coupon"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.code} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Input label="Coupon code" placeholder="FIRST50" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
          <Select label="Type" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'percent' | 'flat' }))}
            options={[{ label: 'Percent off', value: 'percent' }, { label: 'Flat amount off', value: 'flat' }]} />
          <Input label={form.kind === 'percent' ? 'Percent (0-100)' : 'Amount (₹)'} type="number" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))} />
          <Input label="Max redemptions" type="number" value={form.maxRedemptions} onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: Number(e.target.value) || 0 }))} />
          <div className="col-span-2"><Input label="Description (internal note)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={form.firstBookingOnly} onChange={(e) => setForm((f) => ({ ...f, firstBookingOnly: e.target.checked }))} /> First booking only</label>
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
