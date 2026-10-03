import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Percent, Plus, Receipt, Trash2, Wallet } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionTabs } from '@/components/common/SectionTabs';
import { platformAdminApi, type DataRetention, type GstSlab, type Policies } from '@/lib/api/platformAdmin';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
/** The rates GST law has (the server refuses any other). */
const GST_RATES = [0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28];
const rupees = (minor: number | null) => (minor === null ? '' : String(minor / 100));
const toMinor = (v: string) => Math.round(Number(v) * 100);

/**
 * Platform-wide defaults operators build on (#33, #42, #44, #75): GST slabs,
 * the agent credit an operator may give, how much of a bus OTAs see by
 * default, and how long operational data is kept.
 */
export function BusinessRulesPage() {
  const q = useQuery({ queryKey: ['admin-policies'], queryFn: platformAdminApi.policies });
  return (
    <>
      <PageHeader title="Business rules" subtitle="GST slabs, agent credit, OTA seat release and data retention" />
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <SectionTabs
          sections={[
            { key: 'gst', label: 'GST slabs', render: () => <GstCard slabs={q.data!.gstSlabs} /> },
            { key: 'credit', label: 'Agent credit', render: () => <AgentCreditCard p={q.data!.agentCredit} /> },
            { key: 'ota', label: 'OTA release', render: () => <OtaCard pct={q.data!.otaRelease.defaultReleasePct} /> },
            { key: 'retention', label: 'Data retention', render: () => <RetentionCard p={q.data!.dataRetention} /> },
          ]}
        />
      )}
    </>
  );
}

function useSave<T>(fn: (v: T) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ['admin-policies'] });
    },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
}

function GstCard({ slabs }: { slabs: GstSlab[] }) {
  const [rows, setRows] = useState(slabs.map((s) => ({ ...s, ratePct: String(s.ratePct) })));
  const save = useSave((v: GstSlab[]) => platformAdminApi.setGstSlabs(v), 'GST slabs saved');
  const codes = rows.map((r) => r.code.trim());
  const rowErr = rows.map((r, i) => ({
    code: !/^[a-z][a-z0-9_]{1,39}$/.test(r.code.trim())
      ? 'lower_snake_case'
      : codes.indexOf(r.code.trim()) !== i
        ? 'Used twice'
        : undefined,
    label: r.label.trim().length < 2 ? 'Name it' : undefined,
    rate: !GST_RATES.includes(Number(r.ratePct)) ? GST_RATES.join(' / ') + '%' : undefined,
    applies: r.appliesTo.trim().length < 2 ? 'What it applies to' : undefined,
  }));
  const invalid = rows.length === 0 || rowErr.some((e) => Object.values(e).some(Boolean));
  const set = (i: number, k: keyof (typeof rows)[number], v: string) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> GST slabs
          </span>
        }
        subtitle="Rates used on tickets and platform fees"
      />
      <CardBody className="flex flex-col gap-2 text-sm">
        {/* Wide screens: one row per slab under a header; narrower: each slab as its own labelled group. */}
        <div className="hidden grid-cols-[11rem_minmax(0,1fr)_6rem_10rem_2.5rem] gap-2 text-xs font-medium text-text-muted lg:grid">
          <span>Code</span>
          <span>Name</span>
          <span>Rate %</span>
          <span>Applies to</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-2 items-start gap-2 rounded-md border border-border p-3 lg:grid-cols-[11rem_minmax(0,1fr)_6rem_10rem_2.5rem] lg:border-0 lg:p-0"
          >
            {(
              [
                ['code', 'Code', 'code', rowErr[i].code],
                ['label', 'Name', 'Name', rowErr[i].label],
                ['ratePct', 'Rate %', '', rowErr[i].rate],
                ['appliesTo', 'Applies to', 'ticket', rowErr[i].applies],
              ] as const
            ).map(([k, label, ph, err]) => (
              <div key={k} className="min-w-0">
                <span className="mb-1 block text-xs text-text-muted lg:hidden">{label}</span>
                <Input
                  aria-label={label}
                  placeholder={ph || undefined}
                  type={k === 'ratePct' ? 'number' : undefined}
                  value={r[k]}
                  error={err}
                  onChange={(e) => set(i, k, e.target.value)}
                />
              </div>
            ))}
            <div className="col-span-2 flex justify-end lg:col-span-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove slab"
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Plus className="h-4 w-4" />}
            disabled={rows.length >= 30}
            onClick={() => setRows([...rows, { code: '', label: '', ratePct: '18', appliesTo: '' }])}
          >
            Add slab
          </Button>
          <Button
            size="sm"
            loading={save.isPending}
            disabled={save.isPending || invalid}
            onClick={() =>
              save.mutate(
                rows.map((r) => ({
                  code: r.code.trim(),
                  label: r.label.trim(),
                  ratePct: Number(r.ratePct),
                  appliesTo: r.appliesTo.trim(),
                })),
              )
            }
          >
            Save slabs
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AgentCreditCard({ p }: { p: Policies['agentCredit'] }) {
  const [def, setDef] = useState(rupees(p.defaultCreditLimitMinor));
  const [max, setMax] = useState(rupees(p.maxCreditLimitMinor));
  const save = useSave((v: Policies['agentCredit']) => platformAdminApi.setAgentCredit(v), 'Agent credit rules saved');
  const e = {
    def: def.trim() === '' || !(Number(def) >= 0) ? 'Enter ₹0 or more' : undefined,
    max:
      max.trim() !== '' && !(Number(max) > 0)
        ? 'More than ₹0, or empty for no cap'
        : max.trim() !== '' && Number(max) < Number(def)
          ? 'Cannot be below the default'
          : undefined,
  };
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Agent credit
          </span>
        }
        subtitle="What a new agent gets, and the most an operator may give"
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Default credit (₹)"
            type="number"
            min={0}
            value={def}
            error={e.def}
            onChange={(x) => setDef(x.target.value)}
          />
          <Input
            label="Cap (₹)"
            type="number"
            min={0}
            value={max}
            error={e.max}
            hint="Empty = no cap"
            onChange={(x) => setMax(x.target.value)}
          />
        </div>
        <Button
          className="self-start"
          size="sm"
          loading={save.isPending}
          disabled={save.isPending || !!e.def || !!e.max}
          onClick={() =>
            save.mutate({ defaultCreditLimitMinor: toMinor(def), maxCreditLimitMinor: max.trim() === '' ? null : toMinor(max) })
          }
        >
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

function OtaCard({ pct }: { pct: number }) {
  const [v, setV] = useState(String(pct));
  const n = Number(v);
  const e = !Number.isInteger(n) || n < 0 || n > 100 ? '0 to 100' : undefined;
  const save = useSave((x: number) => platformAdminApi.setOtaRelease(x), 'Default OTA release saved');
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Percent className="h-4 w-4" /> OTA seat release
          </span>
        }
        subtitle="Share of a bus OTAs may sell unless the operator sets its own"
      />
      <CardBody className="flex items-end gap-3 text-sm">
        <div className="w-40">
          <Input
            label="Default release (%)"
            type="number"
            min={0}
            max={100}
            value={v}
            error={e}
            onChange={(x) => setV(x.target.value)}
          />
        </div>
        <Button size="sm" loading={save.isPending} disabled={save.isPending || !!e} onClick={() => save.mutate(n)}>
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

/** The least each may be kept, as the server enforces (legal / audit needs). */
const RETENTION: { key: keyof DataRetention; label: string; min: number }[] = [
  { key: 'auditLogDays', label: 'Audit log', min: 365 },
  { key: 'notificationDays', label: 'Sent SMS / email / WhatsApp', min: 30 },
  { key: 'gpsPingDays', label: 'GPS positions', min: 7 },
  { key: 'webhookDeliveryDays', label: 'Webhook deliveries', min: 7 },
  { key: 'otpChallengeDays', label: 'OTP codes', min: 1 },
];

function RetentionCard({ p }: { p: DataRetention }) {
  const [f, setF] = useState<Record<keyof DataRetention, string>>(
    () =>
      Object.fromEntries(RETENTION.map(({ key }) => [key, p[key] === null ? '' : String(p[key])])) as Record<
        keyof DataRetention,
        string
      >,
  );
  const save = useSave(
    (v: DataRetention) => platformAdminApi.setDataRetention(v),
    'Retention saved — the nightly job deletes older data',
  );
  const err = (k: keyof DataRetention) => {
    const s = f[k].trim();
    if (s === '') return undefined;
    const n = Number(s);
    const min = RETENTION.find((r) => r.key === k)!.min;
    return !Number.isInteger(n) || n < min || n > 3650 ? `${min} to 3650 days, or empty` : undefined;
  };
  const invalid = RETENTION.some(({ key }) => err(key));
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Archive className="h-4 w-4" /> Data retention
          </span>
        }
        subtitle="Delete old operational data after this many days. Empty = keep."
      />
      <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        {RETENTION.map(({ key, label, min }) => (
          <Input
            key={key}
            label={label}
            type="number"
            min={min}
            hint={`At least ${min}`}
            value={f[key]}
            error={err(key)}
            onChange={(x) => setF({ ...f, [key]: x.target.value })}
          />
        ))}
        <div className="col-span-full">
          <Button
            size="sm"
            loading={save.isPending}
            disabled={save.isPending || invalid}
            onClick={() =>
              save.mutate(
                Object.fromEntries(
                  RETENTION.map(({ key }) => [key, f[key].trim() === '' ? null : Number(f[key])]),
                ) as unknown as DataRetention,
              )
            }
          >
            Save
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
