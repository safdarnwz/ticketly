import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar, PlayCircle, PauseCircle, RefreshCw, Bus, Settings2 } from 'lucide-react';

import { Button, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { normaliseServiceCode, schedulingApi, SERVICE_CODE_RE, type ServiceRow } from '@/lib/api/scheduling';
import { masterDataApi } from '@/lib/api/masterData';
import { ExtraTripSuggestions, RouteBlackouts } from './ScheduleExtras';
import { ServiceManageModal, type ManageTab } from './ServiceManageModal';
import { addDaysIso, cn, dayDiff, idempotencyKey, todayLocal } from '@/lib/utils';

// ISO weekdays, as the backend's recurrence rule counts them (1 = Monday … 7 = Sunday).
const WEEKDAYS = [{ v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 7, l: 'Sun' }];
const hhmm = (m?: number) => (m === undefined ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
function runsOn(r: ServiceRow['recurrence']): string {
  if (!r) return '—';
  if (r.frequency === 'daily') return 'Every day';
  const days = [...(r.weekdays ?? [])].sort();
  if (days.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (days.join() === '6,7') return 'Weekends';
  return days.map((d) => WEEKDAYS.find((w) => w.v === d)?.l).join(', ');
}

export function SchedulePage() {
  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Recurring services — each creates its daily trips ahead of time"
      />
      <ServicesTab />
    </>
  );
}

function ServicesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<{ service: ServiceRow; tab?: ManageTab; date?: string } | null>(null);

  const services = useQuery({ queryKey: ['services'], queryFn: schedulingApi.listServices });
  const routes = useQuery({ queryKey: ['routes', 'published'], queryFn: () => masterDataApi.listRoutes('published') });
  const allRoutes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });
  const types = useQuery({ queryKey: ['vehicle-types'], queryFn: () => masterDataApi.listVehicleTypes() });

  const [form, setForm] = useState({ code: '', routeId: '', vehicleTypeId: '', startTime: '06:00' });
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState(addDaysIso(todayLocal(), 90));
  const [tried, setTried] = useState(false);
  // One key per service being created: a double click or a retry makes one service, not -A and -B.
  const [createKey, setCreateKey] = useState(() => idempotencyKey('service'));

  // With no code typed, the service is named from its route and time (DEL-PAT-1500);
  // show that name — and any -A / -B it causes — before saving.
  const autoName = !form.code.trim();
  const preview = useQuery({
    queryKey: ['service-code-preview', form.routeId, form.startTime],
    queryFn: () => schedulingApi.codePreview(form.routeId, form.startTime),
    enabled: adding && autoName && !!form.routeId && /^\d{2}:\d{2}$/.test(form.startTime),
    retry: false,
  });

  const toggleWeekday = (v: number) => setWeekdays((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));

  const create = useMutation({
    mutationFn: () => schedulingApi.createService({
      ...form,
      code: autoName ? undefined : normaliseServiceCode(form.code),
      recurrence: { frequency, weekdays: frequency === 'weekly' ? weekdays : undefined, startDate, endDate },
    }, createKey),
    onSuccess: (res) => {
      toast.success(`${res.code} created${res.renamed ? ` — ${res.renamed.from} is now ${res.renamed.to}` : ''}. Activate it to create its trips.`);
      setAdding(false); setTried(false); setCreateKey(idempotencyKey('service'));
      setForm({ code: '', routeId: '', vehicleTypeId: '', startTime: '06:00' });
      void qc.invalidateQueries({ queryKey: ['services'] });
      void qc.invalidateQueries({ queryKey: ['service-code-preview'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create service'),
  });

  const activate = useMutation({
    mutationFn: (id: string) => schedulingApi.activate(id),
    onSuccess: (res) => { toast.success(`Activated — ${res.trips ?? 0} trips created`); void qc.invalidateQueries({ queryKey: ['services'] }); void qc.invalidateQueries({ queryKey: ['trips'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Activate failed'),
  });
  const pause = useMutation({
    mutationFn: (id: string) => schedulingApi.pause(id),
    onSuccess: () => { toast.success('Service paused'); void qc.invalidateQueries({ queryKey: ['services'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Pause failed'),
  });
  const materialise = useMutation({
    mutationFn: (id: string) => schedulingApi.materialise(id),
    onSuccess: (res) => { toast.success(res.trips ? `${res.trips} more trips created` : 'Trips are already created up to the booking horizon'); void qc.invalidateQueries({ queryKey: ['trips'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const routeName = (id: string) => allRoutes.data?.items.find((r) => r.id === id)?.name ?? '—';
  const typeName = (id: string) => types.data?.items.find((t) => t.id === id)?.name ?? '—';
  const columns: Column<ServiceRow>[] = [
    { key: 'code', header: 'Code', look: 'key', render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.code}</span> },
    { key: 'route', header: 'Route', look: 'strong', render: (r) => <span className="font-medium text-text">{routeName(r.routeId)}</span> },
    { key: 'time', header: 'Departs', under: 'code', render: (r) => hhmm(r.startMinute) },
    { key: 'runs', header: 'Runs', under: 'route', render: (r) => <span className="text-text-muted">{runsOn(r.recurrence)}{r.recurrence ? ` · till ${r.recurrence.endDate}` : ''}</span> },
    { key: 'type', header: 'Bus type', look: 'muted', under: 'route', render: (r) => <span className="text-text-muted">{typeName(r.vehicleTypeId)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<Settings2 className="h-4 w-4" />} onClick={() => setManaging({ service: r })}>Manage</Button>
          {r.status !== 'active' ? (
            r.status !== 'ended' && <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={activate.isPending && activate.variables === r.id} disabled={activate.isPending} onClick={() => activate.mutate(r.id)}>Activate</Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" />} loading={materialise.isPending && materialise.variables === r.id} disabled={materialise.isPending} onClick={() => materialise.mutate(r.id)}>Create upcoming trips</Button>
              <Button size="sm" variant="outline" leftIcon={<PauseCircle className="h-4 w-4" />} loading={pause.isPending && pause.variables === r.id} disabled={pause.isPending} onClick={() => pause.mutate(r.id)}>Pause</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const today = todayLocal();
  const errors: Record<string, string> = {};
  if (!autoName && !SERVICE_CODE_RE.test(normaliseServiceCode(form.code))) errors.code = 'Use 2–40 letters, digits and single dashes, like DEL-PAT-1500';
  else if (!autoName && services.data?.services.some((x) => x.code === normaliseServiceCode(form.code))) errors.code = 'You already have a service with this code';
  if (!form.routeId) errors.routeId = routes.data?.items.length === 0 ? 'Publish a route first' : 'Choose a route';
  if (!form.vehicleTypeId) errors.vehicleTypeId = 'Choose a bus type';
  if (!/^\d{2}:\d{2}$/.test(form.startTime)) errors.startTime = 'Pick a time';
  if (frequency === 'weekly' && weekdays.length === 0) errors.weekdays = 'Pick at least one day';
  if (!startDate) errors.startDate = 'Pick a start date';
  else if (startDate < today) errors.startDate = 'Cannot start in the past';
  if (!endDate) errors.endDate = 'Pick an end date';
  else if (startDate && endDate < startDate) errors.endDate = 'Must be on or after the start date';
  else if (startDate && dayDiff(startDate, endDate) > 366) errors.endDate = 'At most one year at a time';
  const canCreate = Object.keys(errors).length === 0;
  const err = (k: string) => (tried ? errors[k] : undefined);

  return (
    <>
      <div className="mb-4 flex justify-end gap-2"><Link to="/trips"><Button variant="outline" leftIcon={<Bus className="h-4 w-4" />}>Trips & charts</Button></Link><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New service</Button></div>
      <div className="mb-4 flex flex-col gap-4">
        <ExtraTripSuggestions onAdd={(s) => { const svc = services.data?.services.find((x) => x.id === s.serviceId); if (svc) setManaging({ service: svc, tab: 'extra', date: s.journeyDate }); }} />
      </div>

      {services.isLoading ? <PageLoader /> : services.isError ? <ErrorState error={services.error} onRetry={services.refetch} /> :
        (services.data?.services.length ? <Table columns={columns} rows={services.data.services} /> : <EmptyState title="No services yet" description="Publish a route first, then schedule a service on it." icon={<Calendar className="h-10 w-10" />} />)}

      <div className="mt-4"><RouteBlackouts /></div>
      {managing && <ServiceManageModal service={managing.service} routeName={routeName(managing.service.routeId)} initialTab={managing.tab} initialDate={managing.date} onClose={() => setManaging(null)} />}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a recurring service" size="lg"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending} onClick={() => { setTried(true); if (canCreate) create.mutate(); }}>Create</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input label="Service code (optional)" placeholder={preview.data?.code ?? 'Named from route and time'} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} error={err('code') ?? (autoName ? undefined : errors.code)} />
              {autoName && (
                <p className="mt-1 text-xs text-text-muted" aria-live="polite">
                  {!form.routeId ? 'Leave empty to name it from the route and time, like DEL-PAT-1500.'
                    : preview.isFetching ? 'Working out the name…'
                    : preview.isError ? <span className="text-danger">{preview.error instanceof Error ? preview.error.message : 'Could not work out a name — type one'}</span>
                    : preview.data ? <>Will be named <b className="font-mono text-text">{preview.data.code}</b>{preview.data.renames && <> — your other {form.startTime} service <span className="font-mono">{preview.data.renames.from}</span> becomes <b className="font-mono text-text">{preview.data.renames.to}</b></>}</> : null}
                </p>
              )}
            </div>
            <Input label="Start time" type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} error={err('startTime')} />
            <Select label="Route (published only)" error={err('routeId')} value={form.routeId} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}
              options={[{ label: 'Select…', value: '' }, ...(routes.data?.items.map((r) => ({ label: r.name, value: r.id })) ?? [])]} />
            <Select label="Bus type" error={err('vehicleTypeId')} value={form.vehicleTypeId} onChange={(e) => setForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
              options={[{ label: 'Select…', value: '' }, ...(types.data?.items.map((t) => ({ label: t.name, value: t.id })) ?? [])]} />
          </div>

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-semibold text-text">Recurrence</div>
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => setFrequency('daily')} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', frequency === 'daily' ? 'border-primary bg-surface-muted' : 'border-border')}>Every day</button>
              <button type="button" onClick={() => setFrequency('weekly')} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', frequency === 'weekly' ? 'border-primary bg-surface-muted' : 'border-border')}>Specific weekdays</button>
            </div>
            {frequency === 'weekly' && (
              <div className="mb-2 flex gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button key={d.v} type="button" aria-pressed={weekdays.includes(d.v)} onClick={() => toggleWeekday(d.v)}
                    className={cn('h-9 w-11 rounded-md border text-xs font-medium', weekdays.includes(d.v) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted')}>{d.l}</button>
                ))}
              </div>
            )}
            {err('weekdays') && <p role="alert" className="mb-2 text-xs text-danger">{err('weekdays')}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} error={err('startDate')} />
              <Input label="To" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} error={err('endDate')} />
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
