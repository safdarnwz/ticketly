import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, PauseCircle, PlayCircle, Copy, ExternalLink, BarChart3, Ticket, XCircle, IndianRupee, Percent, SlidersHorizontal, Download, Mail } from 'lucide-react';

import { Button, Card, CardBody, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { tenantsApi, type TenantRow, type Plan } from '@/lib/api/tenants';
import { formatMoney } from '@/lib/utils';
import { platformAdminApi } from '@/lib/api/platformAdmin';
import { BroadcastModal, OperatorSettingsModal } from './OperatorSettings';

export function TenantsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [suspending, setSuspending] = useState<TenantRow | null>(null);
  const [viewingStats, setViewingStats] = useState<TenantRow | null>(null);
  const [changingPlan, setChangingPlan] = useState<TenantRow | null>(null);
  const [settingCommission, setSettingCommission] = useState<TenantRow | null>(null);
  const [commissionPercent, setCommissionPercent] = useState('');
  const [reason, setReason] = useState('');
  const [settingsFor, setSettingsFor] = useState<TenantRow | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Surfaced right after provisioning — same reason as the operator-approval
  // flow: this is the ONLY host that operator's staff can sign in on.
  const [justCreated, setJustCreated] = useState<{ displayName: string; consoleUrl: string } | null>(null);

  const list = useQuery({ queryKey: ['tenants'], queryFn: tenantsApi.list });
  const plans = useQuery({ queryKey: ['tenant-plans'], queryFn: tenantsApi.plans });
  const stats = useQuery({
    queryKey: ['tenant-stats', viewingStats?.id],
    queryFn: () => tenantsApi.stats(viewingStats!.id),
    enabled: !!viewingStats,
  });
  const platformSettings = useQuery({ queryKey: ['platform-settings-default'], queryFn: tenantsApi.platformSettings });
  const currentCommission = useQuery({
    queryKey: ['tenant-commission', settingCommission?.id],
    queryFn: () => tenantsApi.getCommission(settingCommission!.id),
    enabled: !!settingCommission,
  });

  const [form, setForm] = useState({
    slug: '', legalName: '', displayName: '', contactEmail: '', contactPhone: '', planCode: '',
    ownerName: '', ownerEmail: '', ownerPassword: '',
  });
  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const provision = useMutation({
    mutationFn: () => tenantsApi.provision({
      slug: form.slug, legalName: form.legalName, displayName: form.displayName,
      contactEmail: form.contactEmail, contactPhone: form.contactPhone || undefined,
      planCode: form.planCode || undefined,
      owner: { fullName: form.ownerName, email: form.ownerEmail, password: form.ownerPassword },
    }),
    onSuccess: (res) => {
      setJustCreated({ displayName: form.displayName, consoleUrl: res.consoleUrl });
      toast.success(`${form.displayName} provisioned`);
      setAdding(false);
      setForm({ slug: '', legalName: '', displayName: '', contactEmail: '', contactPhone: '', planCode: '', ownerName: '', ownerEmail: '', ownerPassword: '' });
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Provisioning failed'),
  });

  const suspend = useMutation({
    mutationFn: () => tenantsApi.suspend(suspending!.id, reason),
    onSuccess: () => { toast.success('Operator suspended'); setSuspending(null); setReason(''); void qc.invalidateQueries({ queryKey: ['tenants'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Suspend failed'),
  });
  const activate = useMutation({
    mutationFn: (id: string) => tenantsApi.activate(id),
    onSuccess: () => { toast.success('Operator re-activated'); void qc.invalidateQueries({ queryKey: ['tenants'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Activate failed'),
  });
  const changePlan = useMutation({
    mutationFn: (planId: string) => tenantsApi.changePlan(changingPlan!.id, planId),
    onSuccess: () => { toast.success('Plan updated'); setChangingPlan(null); void qc.invalidateQueries({ queryKey: ['tenants'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const setCommission = useMutation({
    mutationFn: () => tenantsApi.setCommission({ tenantId: settingCommission!.id, model: 'percent', percent: Number(commissionPercent) }),
    onSuccess: () => { toast.success('Commission updated'); setSettingCommission(null); void qc.invalidateQueries({ queryKey: ['tenant-commission'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const columns: Column<TenantRow>[] = [
    { key: 'name', header: 'Operator', render: (r) => <span className="font-medium text-text">{r.displayName}</span> },
    { key: 'email', header: 'Contact', render: (r) => <span className="text-text-muted">{r.contactEmail}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'console', header: 'Console', render: (r) => <a href={r.consoleUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary">{r.consoleUrl}</a> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<BarChart3 className="h-4 w-4" />} onClick={() => setViewingStats(r)}>Stats</Button>
          <Button size="sm" variant="ghost" leftIcon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setSettingsFor(r)}>Settings</Button>
          <Button size="sm" variant="ghost" onClick={() => setChangingPlan(r)}>Plan</Button>
          <Button size="sm" variant="ghost" leftIcon={<Percent className="h-4 w-4" />} onClick={() => { setSettingCommission(r); setCommissionPercent(''); }}>Commission</Button>
          {r.status === 'suspended' ? (
            <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate(r.id)}>Activate</Button>
          ) : (
            <Button size="sm" variant="outline" leftIcon={<PauseCircle className="h-4 w-4" />} onClick={() => setSuspending(r)}>Suspend</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Operators" subtitle="Every operator on the platform — provision, suspend, or re-activate"
        action={(
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={<Download className="h-4 w-4" />} loading={exporting} disabled={exporting}
              onClick={() => { setExporting(true); platformAdminApi.exportOperators().catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Export failed')).finally(() => setExporting(false)); }}>Export CSV</Button>
            <Button variant="outline" leftIcon={<Mail className="h-4 w-4" />} onClick={() => setBroadcasting(true)}>Message all</Button>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New operator</Button>
          </div>
        )} />
      {settingsFor && <OperatorSettingsModal tenantId={settingsFor.id} name={settingsFor.displayName} onClose={() => setSettingsFor(null)} />}
      {broadcasting && <BroadcastModal onClose={() => setBroadcasting(false)} />}

      {justCreated && (
        <Card className="mb-4 border-success/30 bg-success/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text">{justCreated.displayName} is live</div>
              <div className="text-sm text-text-muted">
                Their staff can sign in ONLY at <span className="font-mono text-text">{justCreated.consoleUrl}</span> — no other URL will work for them.
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" leftIcon={<Copy className="h-4 w-4" />}
                onClick={() => { void navigator.clipboard.writeText(justCreated.consoleUrl); toast.success('Console URL copied'); }}>
                Copy link
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(justCreated.consoleUrl, '_blank')}>Open</Button>
              <Button size="sm" variant="ghost" onClick={() => setJustCreated(null)}>Dismiss</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> :
        (list.data?.items.length ? <Table columns={columns} rows={list.data.items} /> : <EmptyState title="No operators yet" icon={<Building2 className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Provision a new operator" size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button loading={provision.isPending}
              disabled={!form.slug || !form.legalName || !form.displayName || !form.contactEmail || !form.ownerName || !form.ownerEmail || form.ownerPassword.length < 8}
              onClick={() => provision.mutate()}>
              Provision
            </Button>
          </>
        )}>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Slug" hint="app.<slug>.ticketly.com" value={form.slug} onChange={setField('slug')} placeholder="orange-travels" />
          <Select label="Plan" value={form.planCode} onChange={(e) => setForm((f) => ({ ...f, planCode: e.target.value }))}
            options={[{ label: 'None', value: '' }, ...(plans.data?.items.map((p) => ({ label: p.name, value: p.code })) ?? [])]} />
          <div className="col-span-2"><Input label="Legal name" value={form.legalName} onChange={setField('legalName')} /></div>
          <div className="col-span-2"><Input label="Display name" value={form.displayName} onChange={setField('displayName')} /></div>
          <Input label="Contact email" type="email" value={form.contactEmail} onChange={setField('contactEmail')} />
          <Input label="Contact phone" value={form.contactPhone} onChange={setField('contactPhone')} />
          <div className="col-span-2 mt-1 border-t border-border pt-3 text-sm font-semibold text-text">Owner account</div>
          <Input label="Owner name" value={form.ownerName} onChange={setField('ownerName')} />
          <Input label="Owner email" type="email" value={form.ownerEmail} onChange={setField('ownerEmail')} />
          <div className="col-span-2"><Input label="Owner password" type="password" hint="Min. 8 characters" value={form.ownerPassword} onChange={setField('ownerPassword')} /></div>
        </div>
      </Modal>

      <Modal open={!!suspending} onClose={() => { setSuspending(null); setReason(''); }} title={`Suspend ${suspending?.displayName ?? ''}`}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setSuspending(null); setReason(''); }}>Cancel</Button>
            <Button variant="danger" disabled={!reason.trim()} loading={suspend.isPending} onClick={() => suspend.mutate()}>Confirm suspension</Button>
          </>
        )}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for suspension"
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm focus-ring" />
      </Modal>

      <Modal open={!!viewingStats} onClose={() => setViewingStats(null)} title={`${viewingStats?.displayName ?? ''} — bookings`}>
        {stats.isLoading ? <PageLoader /> : stats.isError ? <ErrorState error={stats.error} onRetry={stats.refetch} /> : stats.data && (
          <div className="grid grid-cols-2 gap-3">
            <Card><CardBody className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-text-muted"><Ticket className="h-3.5 w-3.5" /> Total bookings</span>
              <span className="text-2xl font-semibold text-text">{stats.data.totalBookings}</span>
            </CardBody></Card>
            <Card><CardBody className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-text-muted"><Ticket className="h-3.5 w-3.5" /> Today's bookings</span>
              <span className="text-2xl font-semibold text-text">{stats.data.todayBookings}</span>
            </CardBody></Card>
            <Card><CardBody className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-text-muted"><XCircle className="h-3.5 w-3.5" /> Total cancelled</span>
              <span className="text-2xl font-semibold text-danger">{stats.data.totalCancelled}</span>
            </CardBody></Card>
            <Card><CardBody className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-text-muted"><XCircle className="h-3.5 w-3.5" /> Today's cancelled</span>
              <span className="text-2xl font-semibold text-danger">{stats.data.todayCancelled}</span>
            </CardBody></Card>
            <div className="col-span-2">
              <Card><CardBody className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-text-muted"><IndianRupee className="h-3.5 w-3.5" /> Total revenue (confirmed + completed)</span>
                <span className="text-2xl font-semibold text-success">{formatMoney(stats.data.totalRevenueMinor, 'INR')}</span>
              </CardBody></Card>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!changingPlan} onClose={() => setChangingPlan(null)} title={`Change plan — ${changingPlan?.displayName ?? ''}`}>
        <div className="flex flex-col gap-2">
          {(plans.data?.items ?? []).filter((p) => p.isActive).map((p: Plan) => (
            <button key={p.id} type="button" disabled={changePlan.isPending} onClick={() => changePlan.mutate(p.id)}
              className="flex items-center justify-between rounded-md border border-border p-3 text-left text-sm hover:border-primary">
              <span className="font-medium text-text">{p.name}</span>
              <span className="text-text-muted">{formatMoney(p.monthlyPrice, p.currency)}/mo</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={!!settingCommission} onClose={() => setSettingCommission(null)} title={`Commission — ${settingCommission?.displayName ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setSettingCommission(null)}>Cancel</Button><Button loading={setCommission.isPending} disabled={!commissionPercent} onClick={() => setCommission.mutate()}>Save</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Platform default is <b className="text-text">{platformSettings.data?.defaultCommissionPercent ?? '—'}%</b> — this negotiated rate OVERRIDES it for this operator only.
            {currentCommission.data?.override && (
              <> Currently set to <b className="text-text">{currentCommission.data.override.percent}%</b> for this operator.</>
            )}
          </p>
          <Input label="Commission %" type="number" placeholder={String(platformSettings.data?.defaultCommissionPercent ?? 1)}
            value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
