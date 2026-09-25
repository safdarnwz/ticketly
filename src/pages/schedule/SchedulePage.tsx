import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar, PlayCircle, PauseCircle, RefreshCw, Bus, XCircle } from 'lucide-react';

import { Button, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { schedulingApi, tripOpsApi, type ServiceRow, type TripRow } from '@/lib/api/scheduling';
import { masterDataApi } from '@/lib/api/masterData';
import { cn } from '@/lib/utils';

const WEEKDAYS = [{ v: 1, l: 'Sun' }, { v: 2, l: 'Mon' }, { v: 3, l: 'Tue' }, { v: 4, l: 'Wed' }, { v: 5, l: 'Thu' }, { v: 6, l: 'Fri' }, { v: 7, l: 'Sat' }];

export function SchedulePage() {
  const [view, setView] = useState<'services' | 'trips'>('services');
  return (
    <>
      <PageHeader title="Schedule" subtitle="Recurring services and individual trip operations" />
      <div className="mb-6 flex gap-2 border-b border-border">
        {([{ key: 'services', label: 'Services', icon: Calendar }, { key: 'trips', label: 'Trips', icon: Bus }] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setView(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', view === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {view === 'services' ? <ServicesTab /> : <TripsTab />}
    </>
  );
}

function ServicesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  const services = useQuery({ queryKey: ['services'], queryFn: schedulingApi.listServices });
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes('published') });
  const types = useQuery({ queryKey: ['vehicle-types'], queryFn: () => masterDataApi.listVehicleTypes() });

  const [form, setForm] = useState({ code: '', routeId: '', vehicleTypeId: '', startTime: '06:00' });
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([2, 3, 4, 5, 6]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));

  const toggleWeekday = (v: number) => setWeekdays((arr) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]));

  const create = useMutation({
    mutationFn: () => schedulingApi.createService({
      ...form,
      recurrence: { frequency, weekdays: frequency === 'weekly' ? weekdays : undefined, startDate, endDate },
    }),
    onSuccess: () => { toast.success('Service created — activate it to materialise trips'); setAdding(false); void qc.invalidateQueries({ queryKey: ['services'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create service'),
  });

  const activate = useMutation({
    mutationFn: (id: string) => schedulingApi.activate(id),
    onSuccess: (res) => { toast.success(`Activated — ${res.trips ?? 0} trips created`); void qc.invalidateQueries({ queryKey: ['services'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Activate failed'),
  });
  const pause = useMutation({
    mutationFn: (id: string) => schedulingApi.pause(id),
    onSuccess: () => { toast.success('Service paused'); void qc.invalidateQueries({ queryKey: ['services'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Pause failed'),
  });
  const materialise = useMutation({
    mutationFn: (id: string) => schedulingApi.materialise(id),
    onSuccess: (res) => toast.success(`${res.trips ?? 0} more trips materialised`),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const columns: Column<ServiceRow>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          {r.status !== 'active' ? (
            <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate(r.id)}>Activate</Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" />} loading={materialise.isPending} onClick={() => materialise.mutate(r.id)}>Materialise more</Button>
              <Button size="sm" variant="outline" leftIcon={<PauseCircle className="h-4 w-4" />} loading={pause.isPending} onClick={() => pause.mutate(r.id)}>Pause</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const canCreate = form.code && form.routeId && form.vehicleTypeId && (frequency === 'daily' || weekdays.length > 0);

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New service</Button></div>

      {services.isLoading ? <PageLoader /> : services.isError ? <ErrorState error={services.error} onRetry={services.refetch} /> :
        (services.data?.services.length ? <Table columns={columns} rows={services.data.services} /> : <EmptyState title="No services yet" description="Publish a route first, then schedule a service on it." icon={<Calendar className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Create a recurring service" size="lg"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!canCreate} onClick={() => create.mutate()}>Create</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Service code" placeholder="DEL-JAI-0600" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            <Input label="Start time" type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            <Select label="Route (published only)" value={form.routeId} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}
              options={[{ label: 'Select…', value: '' }, ...(routes.data?.items.map((r) => ({ label: r.name, value: r.id })) ?? [])]} />
            <Select label="Vehicle type" value={form.vehicleTypeId} onChange={(e) => setForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
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
                  <button key={d.v} type="button" onClick={() => toggleWeekday(d.v)}
                    className={cn('h-9 w-11 rounded-md border text-xs font-medium', weekdays.includes(d.v) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted')}>{d.l}</button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="From" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <Input label="To" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function TripsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<TripRow | null>(null);
  const [reason, setReason] = useState('');

  const trips = useQuery({ queryKey: ['trips'], queryFn: schedulingApi.listTrips });

  const cancel = useMutation({
    mutationFn: () => tripOpsApi.cancel(cancelling!.id, reason),
    onSuccess: (res) => {
      toast.success(`Trip cancelled — ${res.cancelledBookings} booking(s) refunded${res.failed > 0 ? `, ${res.failed} need manual follow-up` : ''}`);
      setCancelling(null); setReason('');
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const stopSales = useMutation({
    mutationFn: (tripId: string) => tripOpsApi.stopSales(tripId),
    onSuccess: () => { toast.success('Sales stopped for this trip'); void qc.invalidateQueries({ queryKey: ['trips'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const resumeSales = useMutation({
    mutationFn: (tripId: string) => tripOpsApi.resumeSales(tripId),
    onSuccess: () => { toast.success('Sales resumed for this trip'); void qc.invalidateQueries({ queryKey: ['trips'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const columns: Column<TripRow>[] = [
    { key: 'route', header: 'Route', render: (t) => <span className="font-medium text-text">{t.routeName}</span> },
    { key: 'departs', header: 'Departs', render: (t) => new Date(t.departsAt).toLocaleString() },
    { key: 'occupancy', header: 'Occupancy', render: (t) => `${t.occupancyPct}%` },
    { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
    {
      key: 'actions', header: '', render: (t) => (
        <div className="flex justify-end gap-2">
          {t.status === 'open' && <Button size="sm" variant="outline" leftIcon={<PauseCircle className="h-4 w-4" />} loading={stopSales.isPending} onClick={() => stopSales.mutate(t.id)}>Stop sales</Button>}
          {(t.status === 'closed' || t.status === 'scheduled') && <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={resumeSales.isPending} onClick={() => resumeSales.mutate(t.id)}>Resume sales</Button>}
          {t.status !== 'departed' && t.status !== 'cancelled' && <Button size="sm" variant="ghost" className="text-danger" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => setCancelling(t)}>Cancel trip</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      {trips.isLoading ? <PageLoader /> : trips.isError ? <ErrorState error={trips.error} onRetry={trips.refetch} /> :
        (trips.data?.items.length ? <Table columns={columns} rows={trips.data.items} /> : <EmptyState title="No upcoming trips" description="Activate a service to materialise trips." icon={<Bus className="h-10 w-10" />} />)}

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel trip — ${cancelling?.routeName ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setCancelling(null)}>Keep trip</Button><Button variant="danger" loading={cancel.isPending} disabled={!reason.trim()} onClick={() => cancel.mutate()}>Cancel trip & refund everyone</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Every passenger currently booked on this trip will be automatically cancelled and refunded — exactly as if they cancelled it themselves. This cannot be undone.</p>
          <Input label="Reason" placeholder="Bus breakdown" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
