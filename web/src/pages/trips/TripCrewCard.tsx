import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bus as BusIcon, Phone, Trash2, UserPlus } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, Input, Select, useToast } from '@/components/ui';
import { fleetApi, type Duty } from '@/lib/api/fleet';
import { cn, formatDateTime } from '@/lib/utils';

const MAX_DRIVERS = 3;
const ROLE_LABEL: Record<string, string> = { driver: 'Driver', conductor: 'Conductor', attendant: 'Attendant' };
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * The trip decides who runs it: which bus (any of the operator's verified
 * buses, whatever route it usually runs) and which crew — one to three
 * drivers taking turns, and the conductor / attendants. Passengers get
 * these names and mobiles in the 4-hour and 1-hour reminders; a change made
 * after the 4-hour reminder is sent to them straight away.
 */
export function TripCrewCard({ trip, busLabel, canEdit, onChangeBus }: {
  trip: { id: string; departsAt: string; arrivesAt: string; status: string; hasRun: boolean; vehicleId: string | null };
  busLabel: string | null;
  canEdit: boolean;
  onChangeBus: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const crew = useQuery({ queryKey: ['trip-crew', trip.id], queryFn: () => fleetApi.tripCrew(trip.id) });
  const duties = crew.data?.duties ?? [];
  const drivers = duties.filter((d) => d.crewRole === 'driver' && d.attendance !== 'absent');
  const others = duties.filter((d) => d.crewRole !== 'driver');
  const [adding, setAdding] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['trip-crew', trip.id] }); void qc.invalidateQueries({ queryKey: ['crew'] }); };
  const remove = useMutation({
    mutationFn: (d: Duty) => fleetApi.cancelDuty(d.id),
    onSuccess: (_r, d) => { toast.success(`${d.crewName} taken off this trip`); refresh(); },
    onError: (e) => toast.error(errText(e, 'Could not remove')),
  });
  const editable = canEdit && !trip.hasRun && trip.status !== 'cancelled';

  const row = (d: Duty, label: string) => (
    <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium text-text">{d.crewName}</div>
        <div className="text-xs text-text-muted">{label}{d.crewRole === 'driver' && d.drivingMinutes ? ` · drives ${Math.round(d.drivingMinutes / 6) / 10} h` : ''}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {d.crewPhone && <a href={`tel:${d.crewPhone}`} className="inline-flex items-center gap-1 text-xs text-primary"><Phone className="h-3 w-3" />{d.crewPhone}</a>}
        {d.attendance !== 'pending' && <Badge tone={d.attendance === 'absent' ? 'danger' : 'success'}>{d.attendance}</Badge>}
        {editable && d.attendance === 'pending' && (
          <Button size="sm" variant="ghost" aria-label={`Remove ${d.crewName}`} disabled={remove.isPending}
            onClick={() => { if (window.confirm(`Take ${d.crewName} off this trip?`)) remove.mutate(d); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <Card className="mb-4 print:hidden">
      <CardHeader title="Bus and crew for this trip" subtitle="The trip decides — any verified bus can run any route. Passengers get these in the 4-hour and 1-hour reminders; a later change is sent to them at once." />
      <CardBody className="grid gap-4 lg:grid-cols-3">
        {(() => {
          // The bus and crew are normally settled before the 4-hour reminder,
          // which gives passengers the bus number and the crew's mobiles.
          const reminderAt = Date.parse(trip.departsAt) - 4 * 3_600_000;
          const soon = Date.parse(trip.departsAt) - Date.now() < 6 * 3_600_000 && Date.parse(trip.departsAt) > Date.now();
          const missing = [!trip.vehicleId && 'the bus', !crew.isLoading && drivers.length === 0 && 'a driver'].filter(Boolean) as string[];
          if (!editable || !missing.length) return null;
          return (
            <div role="alert" className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm lg:col-span-3', soon ? 'border-warning/50 bg-warning/10' : 'border-border bg-surface-muted')}>
              <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', soon ? 'text-warning' : 'text-text-muted')} />
              <span className="text-text">Choose {missing.join(' and ')} before {formatDateTime(new Date(reminderAt).toISOString())} — the 4-hour reminder then carries the bus number and the crew&apos;s mobiles.{Date.now() > reminderAt ? ' The reminder has gone out; passengers will be sent the details as soon as you add them.' : ''}</span>
            </div>
          );
        })()}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 text-xs font-semibold text-text-muted">Bus</div>
          <div className="flex items-center justify-between gap-2">
            <span className={cn('flex items-center gap-2 text-sm', busLabel ? 'font-mono font-semibold text-text' : 'text-warning')}><BusIcon className="h-4 w-4" />{busLabel ?? 'No bus yet'}</span>
            {editable && trip.status !== 'departed' && new Date(trip.arrivesAt).getTime() > Date.now() && <Button size="sm" variant="outline" onClick={onChangeBus}>{trip.vehicleId ? 'Change bus' : 'Assign bus'}</Button>}
          </div>
          <p className="mt-2 text-xs text-text-muted">Late or broken down? Until the bus leaves, put another here — passengers keep their seat (or move to the same kind of seat) and are told the new bus number.</p>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-1 flex items-center justify-between text-xs font-semibold text-text-muted">
            <span>Drivers ({drivers.length}/{MAX_DRIVERS})</span>
            {!drivers.length && !crew.isLoading && <span className="normal-case text-warning">none yet</span>}
          </div>
          {crew.isError ? <p className="text-xs text-danger">{errText(crew.error, 'Could not load the crew')}</p> : (
            <ul className="divide-y divide-border">{duties.filter((d) => d.crewRole === 'driver').map((d, i) => row(d, drivers.length > 1 ? `Driver ${i + 1}` : 'Driver'))}</ul>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="mb-1 text-xs font-semibold text-text-muted">Conductor / attendants</div>
          <ul className="divide-y divide-border">{others.map((d) => row(d, ROLE_LABEL[d.crewRole] ?? d.crewRole))}</ul>
          {!others.length && !crew.isLoading && <p className="text-xs text-text-muted">No conductor yet.</p>}
        </div>

        {editable && (
          <div className="lg:col-span-3">
            {adding
              ? <AddCrewForm trip={trip} onTrip={duties} driversFull={drivers.length >= MAX_DRIVERS} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
              : <Button size="sm" variant="outline" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add driver or crew</Button>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AddCrewForm({ trip, onTrip, driversFull, onDone, onCancel }: {
  trip: { id: string; departsAt: string; arrivesAt: string };
  onTrip: Duty[];
  driversFull: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [role, setRole] = useState(driversFull ? 'conductor' : 'driver');
  const [crewId, setCrewId] = useState('');
  const tripMinutes = Math.max(0, Math.round((Date.parse(trip.arrivesAt) - Date.parse(trip.departsAt)) / 60_000));
  const driversNow = onTrip.filter((d) => d.crewRole === 'driver' && d.attendance !== 'absent').length;
  // Drivers share the wheel: by default each drives an equal part of the run.
  const [driveHours, setDriveHours] = useState(() => String(Math.round((tripMinutes / (driversNow + 1) / 60) * 10) / 10));
  const [override, setOverride] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [touched, setTouched] = useState(false);
  const pool = useQuery({ queryKey: ['crew', role, 'active'], queryFn: () => fleetApi.listCrew({ role, status: 'active' }) });
  const already = new Set(onTrip.map((d) => d.crewId));
  const options = (pool.data?.items ?? []).filter((c) => !already.has(c.id));
  const hours = Number(driveHours);
  const errors = {
    crew: crewId ? '' : 'Choose who',
    hours: role !== 'driver' ? '' : !Number.isFinite(hours) || hours < 0 || hours * 60 > tripMinutes + 1 ? `0 to ${Math.round(tripMinutes / 6) / 10} hours` : '',
    override: needsOverride && override.trim().length < 10 ? 'Say why this exception is approved (at least 10 characters)' : '',
    role: role === 'driver' && driversFull ? 'This trip already has 3 drivers' : '',
  };
  const add = useMutation({
    mutationFn: () => fleetApi.assignDuty({
      crewId, tripId: trip.id,
      startsAt: new Date(Date.parse(trip.departsAt) - 30 * 60_000).toISOString(), endsAt: trip.arrivesAt,
      drivingMinutes: role === 'driver' ? Math.round(hours * 60) : 0,
      overrideReason: needsOverride ? override.trim() : undefined,
    }),
    onSuccess: () => { toast.success('Added to the trip'); onDone(); },
    onError: (e) => {
      const msg = errText(e, 'Could not add');
      // Rest / driving-hour rules may be approved with a reason; an overlap never.
      if (/rest|driving|duty length|continuous/i.test(msg) && !/overlap/i.test(msg)) setNeedsOverride(true);
      toast.error(msg);
    },
  });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Role" value={role} error={touched ? errors.role : undefined} onChange={(e) => { setRole(e.target.value); setCrewId(''); }}
          options={[{ value: 'driver', label: 'Driver' }, { value: 'conductor', label: 'Conductor' }, { value: 'attendant', label: 'Attendant' }]} />
        <Select label="Who" value={crewId} error={touched ? errors.crew : undefined} onChange={(e) => setCrewId(e.target.value)}
          options={[{ value: '', label: pool.isLoading ? 'Loading…' : options.length ? 'Choose…' : `No free ${ROLE_LABEL[role]?.toLowerCase()} — add one in Fleet → Crew` },
            ...options.map((c) => ({ value: c.id, label: `${c.fullName}${c.phone ? ` · ${c.phone}` : ''}` }))]} />
        {role === 'driver' && <Input label="Hours at the wheel" type="number" min={0} step={0.5} value={driveHours} error={touched ? errors.hours : undefined} onChange={(e) => setDriveHours(e.target.value)} />}
      </div>
      {needsOverride && <Input label="Approve an exception — reason" value={override} maxLength={300} error={touched ? errors.override : undefined} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. Regular driver ill, no other licensed driver free" />}
      <div className="flex gap-2">
        <Button size="sm" loading={add.isPending} disabled={add.isPending} onClick={() => { setTouched(true); if (!Object.values(errors).some(Boolean)) add.mutate(); }}>Add to trip</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-text-muted">Checked against your rest and driving-hour rules and their other duties. Someone already on another bus at that time cannot be added.</p>
    </div>
  );
}
