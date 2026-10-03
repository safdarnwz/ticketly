import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  Building2,
  Bus,
  Ticket,
  XCircle,
  IndianRupee,
  TrendingUp,
  Plus,
  Package,
  ScrollText,
  Search,
  Settings,
  Percent,
  Landmark,
  Download,
  CheckCircle2,
} from 'lucide-react';

import {
  Button,
  Card,
  CardBody,
  Badge,
  statusTone,
  Table,
  type Column,
  Modal,
  Input,
  PageLoader,
  ErrorState,
  EmptyState,
  useToast,
  TabBar,
  usePaged,
} from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { tenantsApi, type Plan } from '@/lib/api/tenants';
import { auditApi, type AuditEntry } from '@/lib/api/audit';
import { promotionsApi } from '@/lib/api/promotions';
import { payoutsApi, type PayoutInstruction, type BankChangeRequest } from '@/lib/api/payouts';
import { useTabParam } from '@/lib/useTabParam';
import { SectionTabs } from '@/components/common/SectionTabs';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

type Tab = 'analytics' | 'plans' | 'audit' | 'settings' | 'payouts';

export function AnalyticsPage() {
  const [tab, setTab] = useTabParam<Tab>(['analytics', 'plans', 'audit', 'settings', 'payouts'], 'analytics');
  return (
    <>
      <PageHeader
        title="Analytics & Plans"
        subtitle="Platform-wide numbers, the plan catalogue, platform fees, payouts and the audit trail"
      />
      <TabBar
        className="mb-6"
        value={tab}
        onChange={setTab}
        items={
          [
            { key: 'analytics', label: 'Analytics', icon: TrendingUp },
            { key: 'payouts', label: 'Payouts', icon: Landmark },
            { key: 'plans', label: 'Plans', icon: Package },
            { key: 'settings', label: 'Platform Settings', icon: Settings },
            { key: 'audit', label: 'Audit Log', icon: ScrollText },
          ] as const
        }
      />
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'payouts' && <PayoutsTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}

function AnalyticsTab() {
  const analytics = useQuery({ queryKey: ['platform-analytics'], queryFn: tenantsApi.analytics });

  if (analytics.isLoading) return <PageLoader />;
  if (analytics.isError) return <ErrorState error={analytics.error} onRetry={analytics.refetch} />;
  const d = analytics.data!;

  const kpis = [
    { label: 'Active operators', value: `${d.operators.active} / ${d.operators.total}`, icon: Building2 },
    { label: 'Total bookings', value: d.totalBookings, icon: Ticket },
    { label: "Today's bookings", value: d.todayBookings, icon: TrendingUp },
    { label: 'Total cancelled', value: d.totalCancelled, icon: XCircle },
    { label: 'Total revenue', value: formatMoney(d.totalRevenueMinor, 'INR'), icon: IndianRupee },
    { label: 'Revenue this month', value: formatMoney(d.monthRevenueMinor, 'INR'), icon: IndianRupee },
    { label: 'Active buses', value: d.activeBuses, icon: Bus },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardBody>
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <k.icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className="mt-2 text-2xl font-semibold text-text">{k.value}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 text-sm font-semibold text-text">Bookings — last 14 days</div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--yb-color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, 'Bookings']} labelFormatter={(v: string) => v} />
                <Line type="monotone" dataKey="bookings" stroke="var(--yb-color-primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

const QUOTAS: { key: string; label: string }[] = [
  { key: 'max_vehicles', label: 'Buses' },
  { key: 'max_branches', label: 'Branches' },
  { key: 'max_agents', label: 'Agents' },
  { key: 'max_users', label: 'Staff logins' },
  { key: 'max_routes', label: 'Routes' },
];
const limitText = (v: unknown) => (typeof v === 'number' && v >= 0 ? String(v) : '∞');

/** The plan catalogue (#99, #102–#104): price, what each plan includes and how many buses, branches, agents… it allows. Saving an existing code updates that plan. */
function PlansTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const plans = useQuery({ queryKey: ['all-plans'], queryFn: tenantsApi.plans });
  const toggle = useMutation({
    mutationFn: (p: Plan) => tenantsApi.togglePlanActive(p.id, !p.isActive),
    onSuccess: () => {
      toast.success('Plan updated');
      void qc.invalidateQueries({ queryKey: ['all-plans'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const featureKeys = [...new Set((plans.data?.items ?? []).flatMap((p) => Object.keys(p.features ?? {})))].sort();

  const columns: Column<Plan>[] = [
    {
      key: 'name',
      header: 'Plan',
      look: 'strong',
      render: (p) => (
        <span className="font-medium text-text">
          {p.name} <span className="font-mono text-xs text-text-muted">{p.code}</span>
        </span>
      ),
    },
    { key: 'price', header: 'Price / month', look: 'figure', render: (p) => formatMoney(p.monthlyPrice, p.currency) },
    {
      key: 'limits',
      header: 'Allows',
      look: 'muted',
      under: 'name',
      render: (p) => (
        <span className="text-xs text-text-muted">
          {QUOTAS.map((q) => `${q.label} ${limitText(p.quotas?.[q.key])}`).join(' · ')}
        </span>
      ),
    },
    {
      key: 'features',
      header: 'Includes',
      optional: true,
      render: (p) => (
        <span className="text-xs text-text-muted">
          {Object.entries(p.features ?? {})
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(', ') || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Retired'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={toggle.isPending && toggle.variables?.id === p.id}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(p)}
          >
            {p.isActive ? 'Retire' : 'Reactivate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          New plan
        </Button>
      </div>
      {plans.isLoading ? (
        <PageLoader />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={plans.refetch} />
      ) : (
        <Table columns={columns} rows={plans.data?.items ?? []} />
      )}
      {editing && (
        <PlanModal plan={editing === 'new' ? null : editing} featureKeys={featureKeys} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function PlanModal({ plan, featureKeys, onClose }: { plan: Plan | null; featureKeys: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    price: plan ? String(plan.monthlyPrice / 100) : '0',
  });
  const [quotas, setQuotas] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      QUOTAS.map((q) => {
        const v = plan?.quotas?.[q.key];
        return [q.key, typeof v === 'number' && v >= 0 ? String(v) : ''];
      }),
    ),
  );
  const [features, setFeatures] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(featureKeys.map((k) => [k, Boolean(plan?.features?.[k])])),
  );
  const [newFeature, setNewFeature] = useState('');
  const [tried, setTried] = useState(false);
  const e = {
    code: !/^[a-z0-9][a-z0-9-]{1,30}$/.test(f.code.trim()) ? 'Lower-case letters, digits and -' : undefined,
    name: f.name.trim().length < 2 ? 'Name it' : undefined,
    price: !(Number(f.price) >= 0) ? '₹0 or more' : undefined,
    quota: QUOTAS.find(
      (q) => quotas[q.key].trim() !== '' && !(Number.isInteger(Number(quotas[q.key])) && Number(quotas[q.key]) >= 0),
    )
      ? 'Whole numbers, or empty for no limit'
      : undefined,
  };
  const save = useMutation({
    mutationFn: () =>
      tenantsApi.createPlan({
        code: f.code.trim(),
        name: f.name.trim(),
        monthlyPrice: Math.round(Number(f.price) * 100),
        features,
        quotas: Object.fromEntries(QUOTAS.map((q) => [q.key, quotas[q.key].trim() === '' ? null : Number(quotas[q.key])])),
      }),
    onSuccess: () => {
      toast.success(plan ? 'Plan saved — operators on it get the new limits now' : 'Plan created');
      void qc.invalidateQueries({ queryKey: ['all-plans'] });
      void qc.invalidateQueries({ queryKey: ['tenant-plans'] });
      onClose();
    },
    onError: (x) => toast.error(x instanceof Error ? x.message : 'Failed'),
  });
  const addFeature = () => {
    const k = newFeature.trim();
    if (/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(k)) {
      setFeatures({ ...features, [k]: true });
      setNewFeature('');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={plan ? `Edit ${plan.name}` : 'Create a plan'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={save.isPending}
            onClick={() => {
              setTried(true);
              if (!Object.values(e).some(Boolean)) save.mutate();
            }}
          >
            {plan ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Code"
            placeholder="growth"
            value={f.code}
            disabled={!!plan}
            error={tried ? e.code : undefined}
            onChange={(x) => setF({ ...f, code: x.target.value.toLowerCase() })}
          />
          <Input
            label="Name"
            placeholder="Growth"
            value={f.name}
            error={tried ? e.name : undefined}
            onChange={(x) => setF({ ...f, name: x.target.value })}
          />
          <Input
            label="Monthly price (₹)"
            type="number"
            value={f.price}
            error={tried ? e.price : undefined}
            onChange={(x) => setF({ ...f, price: x.target.value })}
          />
        </div>
        <div className="font-medium text-text">
          Allows at most <span className="font-normal text-text-muted">(empty = no limit)</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {QUOTAS.map((q) => (
            <Input
              key={q.key}
              label={q.label}
              type="number"
              min={0}
              value={quotas[q.key]}
              onChange={(x) => setQuotas({ ...quotas, [q.key]: x.target.value })}
            />
          ))}
        </div>
        {tried && e.quota && (
          <p role="alert" className="text-xs text-danger">
            {e.quota}
          </p>
        )}
        <div className="font-medium text-text">Includes</div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {Object.keys(features)
            .sort()
            .map((k) => (
              <label key={k} className="flex items-center gap-2 font-mono text-xs">
                <input
                  type="checkbox"
                  checked={features[k]}
                  onChange={(x) => setFeatures({ ...features, [k]: x.target.checked })}
                />{' '}
                {k}
              </label>
            ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="w-56">
            <Input
              label="Add a feature"
              placeholder="e.g. whatsapp_tickets"
              value={newFeature}
              onChange={(x) => setNewFeature(x.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(newFeature.trim())}
            onClick={addFeature}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AuditTab() {
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [applied, setApplied] = useState({ action: '', resourceType: '' });

  const log = useQuery({ queryKey: ['audit-log', applied], queryFn: () => auditApi.list(applied) });

  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'When', look: 'muted', under: 'action', render: (e) => formatDateTime(e.occurredAt) },
    { key: 'action', header: 'Action', look: 'strong', render: (e) => <Badge>{e.action}</Badge> },
    {
      key: 'resource',
      header: 'Resource',
      under: 'action',
      render: (e) => (
        <span className="text-text-muted">
          {e.resourceType}
          {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}…` : ''}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      look: 'muted',
      render: (e) => <span className="font-mono text-xs">{e.actorId ? `${e.actorId.slice(0, 8)}…` : e.actorType}</span>,
    },
    {
      key: 'tenant',
      header: 'Tenant',
      under: 'actor',
      render: (e) =>
        e.tenantId ? (
          <span className="font-mono text-xs">{e.tenantId.slice(0, 8)}…</span>
        ) : (
          <span className="text-text-muted">platform</span>
        ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex items-end gap-3">
        <div className="w-56">
          <Input
            label="Filter by action"
            placeholder="tenant.suspended"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Input
            label="Filter by resource type"
            placeholder="tenant"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
          />
        </div>
        <Button leftIcon={<Search className="h-4 w-4" />} onClick={() => setApplied({ action, resourceType })}>
          Filter
        </Button>
      </div>
      {log.isLoading ? (
        <PageLoader />
      ) : log.isError ? (
        <ErrorState error={log.error} onRetry={log.refetch} />
      ) : log.data?.entries.length ? (
        <Table columns={columns} rows={log.data.entries} />
      ) : (
        <EmptyState title="No audit entries match" icon={<ScrollText className="h-10 w-10" />} />
      )}
    </>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['platform-settings'], queryFn: tenantsApi.platformSettings });
  const [commissionPercent, setCommissionPercent] = useState('');
  const [perBusFee, setPerBusFee] = useState('');
  const [gstRate, setGstRate] = useState('');
  const [commissionGstRate, setCommissionGstRate] = useState('');
  const [smsFee, setSmsFee] = useState('');
  const [whatsappFee, setWhatsappFee] = useState('');

  const save = useMutation({
    mutationFn: () =>
      tenantsApi.setPlatformSettings({
        defaultCommissionPercent: commissionPercent ? Number(commissionPercent) : undefined,
        perBusFeeMinor: perBusFee ? Math.round(Number(perBusFee) * 100) : undefined,
        gstRatePercent: gstRate ? Number(gstRate) : undefined,
        commissionGstRatePercent: commissionGstRate ? Number(commissionGstRate) : undefined,
        smsFeeMinor: smsFee ? Math.round(Number(smsFee) * 100) : undefined,
        whatsappFeeMinor: whatsappFee ? Math.round(Number(whatsappFee) * 100) : undefined,
      }),
    onSuccess: () => {
      toast.success('Platform settings updated');
      setCommissionPercent('');
      setPerBusFee('');
      setGstRate('');
      setCommissionGstRate('');
      setSmsFee('');
      setWhatsappFee('');
      void qc.invalidateQueries({ queryKey: ['platform-settings'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  if (settings.isLoading) return <PageLoader />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={settings.refetch} />;

  return (
    <SectionTabs
      param="part"
      sections={[
        {
          key: 'commission',
          label: 'Commission & GST',
          render: () => (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 font-semibold text-text">
                    <Percent className="h-4 w-4" /> Default commission
                  </div>
                  <p className="text-sm text-text-muted">
                    Charged on every booking fare (excluding GST) unless an operator has a negotiated override (set per-operator
                    from the Operators page). Current: <b className="text-text">{settings.data?.defaultCommissionPercent}%</b>
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label="New default %"
                        type="number"
                        placeholder={String(settings.data?.defaultCommissionPercent)}
                        value={commissionPercent}
                        onChange={(e) => setCommissionPercent(e.target.value)}
                      />
                    </div>
                    <Button size="sm" loading={save.isPending} disabled={!commissionPercent} onClick={() => save.mutate()}>
                      Save
                    </Button>
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 font-semibold text-text">
                    <Percent className="h-4 w-4" /> GST on commission
                  </div>
                  <p className="text-sm text-text-muted">
                    The platform OWN facilitation service is a taxable supply — this is the (standard-rate, typically 18%) GST
                    charged on the platform commission itself, separate from the ticket own GST. Current:{' '}
                    <b className="text-text">{settings.data?.commissionGstRatePercent}%</b>
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label="New rate %"
                        type="number"
                        placeholder={String(settings.data?.commissionGstRatePercent)}
                        value={commissionGstRate}
                        onChange={(e) => setCommissionGstRate(e.target.value)}
                      />
                    </div>
                    <Button size="sm" loading={save.isPending} disabled={!commissionGstRate} onClick={() => save.mutate()}>
                      Save
                    </Button>
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 font-semibold text-text">
                    <Percent className="h-4 w-4" /> Ticket GST rate
                  </div>
                  <p className="text-sm text-text-muted">
                    Government-mandated rate on the passenger fare itself. This amount is collected from the customer and passed
                    straight through to the operator (they remit it) — the platform never keeps it. Current:{' '}
                    <b className="text-text">{settings.data?.gstRatePercent}%</b>
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label="New rate %"
                        type="number"
                        placeholder={String(settings.data?.gstRatePercent)}
                        value={gstRate}
                        onChange={(e) => setGstRate(e.target.value)}
                      />
                    </div>
                    <Button size="sm" loading={save.isPending} disabled={!gstRate} onClick={() => save.mutate()}>
                      Save
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          ),
        },
        {
          key: 'fees',
          label: 'Fees',
          render: () => (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 font-semibold text-text">
                    <IndianRupee className="h-4 w-4" /> Per-bus one-time fee
                  </div>
                  <p className="text-sm text-text-muted">
                    Charged ONCE when an operator registers a new vehicle — the SAME amount for every operator (not negotiable
                    per-operator, unlike commission). Current:{' '}
                    <b className="text-text">{settings.data && formatMoney(settings.data.perBusFeeMinor, 'INR')}</b>
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label="New fee (₹)"
                        type="number"
                        placeholder={settings.data ? String(settings.data.perBusFeeMinor / 100) : ''}
                        value={perBusFee}
                        onChange={(e) => setPerBusFee(e.target.value)}
                      />
                    </div>
                    <Button size="sm" loading={save.isPending} disabled={!perBusFee} onClick={() => save.mutate()}>
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-text-muted">
                    Changing this affects newly-registered vehicles only — buses already charged keep their original amount.
                  </p>
                </CardBody>
              </Card>
              <Card className="lg:col-span-2">
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 font-semibold text-text">
                    <IndianRupee className="h-4 w-4" /> Per-message notification fees
                  </div>
                  <p className="text-sm text-text-muted">
                    Charged to the operator per message sent, plus GST on the fee (the platform own service — same as commission
                    GST). Email is free.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Input
                          label={`SMS fee (₹) — current ${settings.data ? (settings.data.smsFeeMinor / 100).toFixed(2) : ''}`}
                          type="number"
                          step="0.01"
                          placeholder={settings.data ? String(settings.data.smsFeeMinor / 100) : ''}
                          value={smsFee}
                          onChange={(e) => setSmsFee(e.target.value)}
                        />
                      </div>
                      <Button size="sm" loading={save.isPending} disabled={!smsFee} onClick={() => save.mutate()}>
                        Save
                      </Button>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Input
                          label={`WhatsApp fee (₹) — current ${settings.data ? (settings.data.whatsappFeeMinor / 100).toFixed(2) : ''}`}
                          type="number"
                          step="0.01"
                          placeholder={settings.data ? String(settings.data.whatsappFeeMinor / 100) : ''}
                          value={whatsappFee}
                          onChange={(e) => setWhatsappFee(e.target.value)}
                        />
                      </div>
                      <Button size="sm" loading={save.isPending} disabled={!whatsappFee} onClick={() => save.mutate()}>
                        Save
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          ),
        },
        { key: 'promotions', label: 'Promotion rates', render: () => <PromotionRatesCard /> },
        {
          key: 'split',
          label: 'How a booking splits',
          render: () => (
            <Card className="lg:col-span-2">
              <CardBody className="flex flex-col gap-2 text-sm text-text-muted">
                <div className="font-semibold text-text">How a booking splits</div>
                <p>
                  Customer pays: <b className="text-text">fare + ticket GST</b>. The platform takes only{' '}
                  <b className="text-text">commission + GST on that commission</b>, plus any{' '}
                  <b className="text-text">SMS/WhatsApp fees + their GST</b> — everything else (fare + ticket GST) is paid to the
                  operator, who remits the ticket GST themselves as the actual transport supplier.
                </p>
              </CardBody>
            </Card>
          ),
        },
      ]}
    />
  );
}

/**
 * The rate card for the "Prio" sponsored-listing feature — separate query/
 * mutation from the rest of this tab since it hits promotionsApi, not
 * tenantsApi.platformSettings (a different underlying table: individual
 * rate rows, not a single settings object). Operators purchase promotion
 * for their own routes entirely self-service (pick dates, get charged via
 * their own settlement) — nothing here creates or manages promotions on
 * an operator's behalf; this card only sets what they'll be charged.
 */
function PromotionRatesCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const rates = useQuery({ queryKey: ['promotion-rates'], queryFn: promotionsApi.rates });
  const [draft, setDraft] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (input: { billingCycle: 'daily' | 'weekly' | 'monthly'; isMultiRoute: boolean; priceMinor: number }) =>
      promotionsApi.setRate(input),
    onSuccess: () => {
      toast.success('Rate updated');
      void qc.invalidateQueries({ queryKey: ['promotion-rates'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const cycles: { key: 'daily' | 'weekly' | 'monthly'; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ];
  const currentRate = (cycle: string, isMulti: boolean) =>
    rates.data?.rates.find((r) => r.billingCycle === cycle && r.isMultiRoute === isMulti);

  return (
    <Card className="lg:col-span-2">
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 font-semibold text-text">
          <TrendingUp className="h-4 w-4" /> Route promotion rate card ("Prio" sponsored listings)
        </div>
        <p className="text-sm text-text-muted">
          What operators pay to bubble a route into the top of search results, regardless of the customer&apos;s own sort/filter.
          Operators pick their own start/end dates from a calendar — the exact day-count is priced from the best combination of
          these three rates, never rounded up to a full cycle. Billed via the operator&apos;s own settlement, same as commission —
          no separate invoice for this.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[false, true].map((isMulti) => (
            <div key={String(isMulti)} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="text-xs font-medium text-text-muted">
                {isMulti ? 'Multi-route (2+ routes in one purchase)' : 'Single route'}
              </div>
              {cycles.map((c) => {
                const key = `${c.key}:${isMulti}`;
                const current = currentRate(c.key, isMulti);
                return (
                  <div key={key} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        label={`${c.label} rate (₹/route) — current ${current ? (current.priceMinor / 100).toFixed(2) : 'not set'}`}
                        type="number"
                        step="0.01"
                        value={draft[key] ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      />
                    </div>
                    <Button
                      size="sm"
                      loading={save.isPending}
                      disabled={!draft[key]}
                      onClick={() =>
                        save.mutate({
                          billingCycle: c.key,
                          isMultiRoute: isMulti,
                          priceMinor: Math.round(Number(draft[key]) * 100),
                        })
                      }
                    >
                      Save
                    </Button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function PayoutsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const [generatedCsv, setGeneratedCsv] = useState<{
    csv: string;
    count: number;
    totalMinor: number;
    instructionIds: string[];
  } | null>(null);
  const [failingId, setFailingId] = useState<PayoutInstruction | null>(null);
  const [failReason, setFailReason] = useState('');
  const [rejectingChange, setRejectingChange] = useState<BankChangeRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const bankChanges = useQuery({ queryKey: ['bank-changes-pending'], queryFn: payoutsApi.pendingBankChanges });
  const bankPage = usePaged(bankChanges.data?.items ?? []);
  const approveChange = useMutation({
    mutationFn: (id: string) => payoutsApi.approveBankChange(id),
    onSuccess: () => {
      toast.success('Bank account updated — active immediately');
      void qc.invalidateQueries({ queryKey: ['bank-changes-pending'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const rejectChange = useMutation({
    mutationFn: () => payoutsApi.rejectBankChange(rejectingChange!.id, rejectReason),
    onSuccess: () => {
      toast.success('Change request rejected');
      setRejectingChange(null);
      setRejectReason('');
      void qc.invalidateQueries({ queryKey: ['bank-changes-pending'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const pending = useQuery({ queryKey: ['payouts-pending'], queryFn: payoutsApi.pending, enabled: view === 'pending' });
  const all = useQuery({ queryKey: ['payouts-all'], queryFn: payoutsApi.all, enabled: view === 'all' });
  const data = view === 'pending' ? pending : all;

  const generate = useMutation({
    mutationFn: payoutsApi.generateBankFile,
    onSuccess: (res) => {
      if (res.count === 0) {
        toast.success('Nothing pending — every payout is already in a batch');
        return;
      }
      setGeneratedCsv(res);
      void qc.invalidateQueries({ queryKey: ['payouts-pending'] });
      void qc.invalidateQueries({ queryKey: ['payouts-all'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const markSent = useMutation({
    mutationFn: (ids: string[]) => payoutsApi.markSent(ids),
    onSuccess: () => {
      toast.success('Marked as sent to bank');
      setGeneratedCsv(null);
      void qc.invalidateQueries({ queryKey: ['payouts-all'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const markConfirmed = useMutation({
    mutationFn: (id: string) => payoutsApi.markConfirmed(id),
    onSuccess: () => {
      toast.success('Payout confirmed');
      void qc.invalidateQueries({ queryKey: ['payouts-all'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const markFailed = useMutation({
    mutationFn: () => payoutsApi.markFailed(failingId!.id, failReason),
    onSuccess: () => {
      toast.success('Marked as failed');
      setFailingId(null);
      setFailReason('');
      void qc.invalidateQueries({ queryKey: ['payouts-all'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const downloadCsv = () => {
    if (!generatedCsv) return;
    const blob = new Blob([generatedCsv.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ticketly-payout-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<PayoutInstruction>[] = [
    { key: 'when', header: 'Created', look: 'muted', under: 'beneficiary', render: (p) => formatDateTime(p.createdAt) },
    {
      key: 'beneficiary',
      header: 'Beneficiary',
      look: 'strong',
      render: (p) => <span className="font-medium text-text">{p.beneficiaryName}</span>,
    },
    {
      key: 'account',
      header: 'Account',
      under: 'beneficiary',
      render: (p) => (
        <span className="font-mono text-xs text-text-muted">
          ••••{p.bankAccountNumber.slice(-4)} · {p.bankIfsc}
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', look: 'figure', render: (p) => formatMoney(p.amountMinor, p.currency) },
    { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status.replace('_', ' ')}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="flex justify-end gap-2">
          {(p.status === 'sent' || p.status === 'in_batch') && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              loading={markConfirmed.isPending}
              onClick={() => markConfirmed.mutate(p.id)}
            >
              Confirm
            </Button>
          )}
          {p.status !== 'confirmed' && p.status !== 'failed' && (
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setFailingId(p)}>
              Mark failed
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      {!!bankChanges.data?.items.length && (
        <Card className="mb-6 border-warning/40">
          <CardBody className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-text">Bank-account change requests awaiting review</div>
            {bankPage.pageItems.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="text-sm font-medium text-text">{r.tenantName}</div>
                  <div className="text-xs text-text-muted">
                    {r.accountHolder} · ••••{r.accountNumber.slice(-4)} · {r.ifsc}
                    {r.bankName ? ` · ${r.bankName}` : ''}
                  </div>
                  <div className="text-xs text-text-muted">Submitted {formatDateTime(r.createdAt)}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={approveChange.isPending}
                    onClick={() => approveChange.mutate(r.id)}
                  >
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRejectingChange(r)}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
            {bankPage.pager}
          </CardBody>
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setView('pending')}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium',
              view === 'pending' ? 'border-primary bg-surface-muted' : 'border-border',
            )}
          >
            Pending
          </button>
          <button
            onClick={() => setView('all')}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium',
              view === 'all' ? 'border-primary bg-surface-muted' : 'border-border',
            )}
          >
            All history
          </button>
        </div>
        {view === 'pending' && (
          <Button leftIcon={<Download className="h-4 w-4" />} loading={generate.isPending} onClick={() => generate.mutate()}>
            Generate bank file
          </Button>
        )}
      </div>

      {data.isLoading ? (
        <PageLoader />
      ) : data.isError ? (
        <ErrorState error={data.error} onRetry={data.refetch} />
      ) : data.data?.items.length ? (
        <Table columns={columns} rows={data.data.items} />
      ) : (
        <EmptyState title="Nothing here" icon={<Landmark className="h-10 w-10" />} />
      )}

      <Modal
        open={!!rejectingChange}
        onClose={() => setRejectingChange(null)}
        title={`Reject change — ${rejectingChange?.tenantName ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectingChange(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={rejectChange.isPending}
              disabled={!rejectReason}
              onClick={() => rejectChange.mutate()}
            >
              Reject
            </Button>
          </>
        }
      >
        <Input
          label="Reason"
          placeholder="Could not verify account ownership"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      <Modal
        open={!!generatedCsv}
        onClose={() => setGeneratedCsv(null)}
        title="Bank file ready"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGeneratedCsv(null)}>
              Close
            </Button>
            <Button loading={markSent.isPending} onClick={() => generatedCsv && markSent.mutate(generatedCsv.instructionIds)}>
              Uploaded — mark as sent
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            <b className="text-text">{generatedCsv?.count}</b> payouts, totalling{' '}
            <b className="text-text">{generatedCsv && formatMoney(generatedCsv.totalMinor, 'INR')}</b>. Download this CSV and
            upload it to your bank corporate-netbanking bulk-payment feature (NEFT/IMPS/RTGS) — the bank executes the actual
            transfers.
          </p>
          <Button variant="outline" leftIcon={<Download className="h-4 w-4" />} onClick={downloadCsv}>
            Download CSV
          </Button>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface-muted p-3 text-xs">
            {generatedCsv?.csv}
          </pre>
          <p className="text-xs text-text-muted">
            These are marked "in batch" now — click "mark as sent" once you've actually uploaded the file to the bank, so they
            don't get pulled into the next batch by mistake.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!failingId}
        onClose={() => setFailingId(null)}
        title={`Mark payout as failed — ${failingId?.beneficiaryName ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFailingId(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={markFailed.isPending} disabled={!failReason} onClick={() => markFailed.mutate()}>
              Mark failed
            </Button>
          </>
        }
      >
        <Input
          label="Reason"
          placeholder="Bounced — wrong account number"
          value={failReason}
          onChange={(e) => setFailReason(e.target.value)}
        />
      </Modal>
    </>
  );
}
