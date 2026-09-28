import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2, Wrench } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, PageLoader, Select, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { fleetApi, MAINTENANCE_KINDS } from '@/lib/api/fleet';
import { addDaysIso, cn, formatMoney, todayLocal } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const KIND_LABEL: Record<string, string> = { service: 'Service', repair: 'Repair', inspection: 'Inspection' };
const MAX_PHOTOS = 10;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO = 5 * 1024 * 1024;

/** Maintenance history of one bus, the next service due, and a form to log work that was done. */
export function MaintenanceCard({ vehicleId, retired }: { vehicleId: string; retired: boolean }) {
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['maintenance', vehicleId], queryFn: () => fleetApi.listMaintenance(vehicleId) });
  const today = todayLocal();
  const items = q.data?.items ?? [];
  // Newest first: the latest job that set a next-due date decides when the bus is due again.
  const nextDue = items.find((m) => m.nextDueOn)?.nextDueOn ?? null;
  const spent = items.reduce((s, m) => s + Number(m.costMinor), 0);
  return (
    <Card>
      <CardHeader title="Maintenance" subtitle={items.length ? `${items.length} entries · ${formatMoney(spent, 'INR')} spent` : 'Services, repairs and inspections'}
        action={<Button size="sm" variant="outline" leftIcon={<Wrench className="h-3.5 w-3.5" />} disabled={retired} title={retired ? 'This bus is retired' : undefined} onClick={() => setAdding(true)}>Log work</Button>} />
      <CardBody className="flex flex-col gap-2 text-sm">
        {nextDue && <p className={cn('rounded-md px-3 py-2', nextDue < today ? 'bg-danger/10 text-danger' : nextDue <= addDaysIso(today, 7) ? 'bg-warning/10 text-warning' : 'bg-surface-muted text-text-muted')}>
          {nextDue < today ? `Service overdue since ${nextDue}` : `Next service due ${nextDue}`}</p>}
        {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? <EmptyState title="No maintenance logged yet" /> : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {items.map((m, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0"><div className="flex items-center gap-2"><Badge>{KIND_LABEL[m.kind] ?? m.kind}</Badge><span className="text-text">{m.description}</span></div>
                  <div className="text-xs text-text-muted">{m.performedOn}{m.odometerKm != null ? ` · ${Number(m.odometerKm).toLocaleString('en-IN')} km` : ''}{m.nextDueOn ? ` · next due ${m.nextDueOn}` : ''}</div></div>
                <span className="shrink-0 text-text">{Number(m.costMinor) ? formatMoney(Number(m.costMinor), 'INR') : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {adding && <LogMaintenanceModal vehicleId={vehicleId} lastOdometer={items.find((m) => m.odometerKm != null)?.odometerKm ?? null} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function LogMaintenanceModal({ vehicleId, lastOdometer, onClose }: { vehicleId: string; lastOdometer: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayLocal();
  const [f, setF] = useState({ kind: 'service', description: '', performedOn: today, nextDueOn: '', odometerKm: '', cost: '' });
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const errors: Record<string, string> = {};
  if (f.description.trim().length < 3) errors.description = 'Say what was done';
  if (!f.performedOn) errors.performedOn = 'When was it done?';
  else if (f.performedOn > today) errors.performedOn = 'Log work once it is done — not a future date';
  if (f.nextDueOn && f.performedOn && f.nextDueOn <= f.performedOn) errors.nextDueOn = 'Must be after the day the work was done';
  const km = Number(f.odometerKm);
  if (f.odometerKm && (!Number.isInteger(km) || km < 0 || km > 5_000_000)) errors.odometerKm = 'Whole kilometres';
  const cost = Number(f.cost);
  if (f.cost && (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000)) errors.cost = '₹0 to ₹1 crore';
  const odometerWarning = f.odometerKm && lastOdometer != null && km < Number(lastOdometer) && !errors.odometerKm ? `Lower than the last reading (${Number(lastOdometer).toLocaleString('en-IN')} km) — check the number` : undefined;
  const save = useMutation({
    mutationFn: () => fleetApi.addMaintenance(vehicleId, {
      kind: f.kind, description: f.description.trim(), performedOn: f.performedOn, nextDueOn: f.nextDueOn || undefined,
      odometerKm: f.odometerKm ? km : undefined, costMinor: f.cost ? Math.round(cost * 100) : 0,
    }),
    onSuccess: () => { toast.success('Maintenance logged'); void qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] }); onClose(); },
    onError: (e) => { setServerErrors(e instanceof ApiError ? e.fieldErrors : {}); toast.error(errText(e, 'Could not save')); },
  });
  const err = (k: string) => (tried ? errors[k] : undefined) ?? serverErrors[k];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setServerErrors({}); };
  return (
    <Modal open onClose={onClose} title="Log maintenance"
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (Object.keys(errors).length === 0) save.mutate(); }}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Select label="Kind" value={f.kind} onChange={set('kind')} options={MAINTENANCE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))} />
        <Input label="What was done" value={f.description} maxLength={500} onChange={set('description')} error={err('description')} placeholder="e.g. Engine oil and filters changed" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Done on" type="date" max={today} value={f.performedOn} onChange={set('performedOn')} error={err('performedOn')} />
          <Input label="Next due (optional)" type="date" min={f.performedOn || today} value={f.nextDueOn} onChange={set('nextDueOn')} error={err('nextDueOn')} />
          <Input label="Odometer (km)" type="number" min={0} value={f.odometerKm} onChange={set('odometerKm')} error={err('odometerKm')} hint={odometerWarning} />
          <Input label="Cost (₹)" type="number" min={0} value={f.cost} onChange={set('cost')} error={err('cost') ?? err('costMinor')} />
        </div>
      </div>
    </Modal>
  );
}

/** Bus photos shown to travellers: up to 10 JPG/PNG/WEBP images; the first is the cover. */
export function PhotosCard({ vehicleId, retired }: { vehicleId: string; retired: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [fileError, setFileError] = useState('');
  const q = useQuery({ queryKey: ['vehicle-media', vehicleId], queryFn: () => fleetApi.listMedia(vehicleId) });
  const photos = (q.data?.items ?? []).filter((m) => m.kind === 'photo');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['vehicle-media', vehicleId] }); void qc.invalidateQueries({ queryKey: ['vehicles'] }); };
  const add = useMutation({
    mutationFn: (file: File) => fleetApi.addPhoto(vehicleId, file, caption.trim() || undefined),
    onSuccess: () => { toast.success('Photo added'); setCaption(''); refresh(); },
    onError: (e) => { const m = errText(e, 'Upload failed'); setFileError(m); toast.error(m); },
  });
  const remove = useMutation({
    mutationFn: (mediaId: string) => fleetApi.removePhoto(vehicleId, mediaId),
    onSuccess: () => { toast.success('Photo removed'); refresh(); },
    onError: (e) => toast.error(errText(e, 'Could not remove')),
  });
  const full = photos.length >= MAX_PHOTOS;
  const pick = (file: File | undefined) => {
    setFileError('');
    if (!file) return;
    if (file.type.startsWith('video/')) return setFileError('Videos are not supported — add photos');
    if (!PHOTO_TYPES.includes(file.type)) return setFileError('Only JPG, PNG or WEBP images');
    if (file.size > MAX_PHOTO) return setFileError('The photo is over 5 MB');
    add.mutate(file);
  };
  return (
    <Card>
      <CardHeader title="Photos" subtitle={`${photos.length} of ${MAX_PHOTOS} · the first one is the cover travellers see`} />
      <CardBody className="flex flex-col gap-3 text-sm">
        {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : photos.length === 0 ? <EmptyState title="No photos yet" description="Buses with photos get more bookings." /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((p, i) => (
              <figure key={p.id} className="relative overflow-hidden rounded-md border border-border">
                {p.url ? <img src={p.url} alt={p.caption ?? `Bus photo ${i + 1}`} className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center text-text-muted">No preview</div>}
                <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-xs">
                  <span className="truncate text-text-muted">{i === 0 ? 'Cover · ' : ''}{p.caption ?? ''}</span>
                  <Button size="sm" variant="ghost" aria-label="Remove photo" loading={remove.isPending && remove.variables === p.id} disabled={remove.isPending}
                    onClick={() => { if (window.confirm('Remove this photo?')) remove.mutate(p.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {retired ? <p className="text-text-muted">A retired bus takes no new photos.</p> : full ? <p className="text-text-muted">Ten photos is the most — remove one to add another.</p> : (
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Caption (optional)" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
            <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-2 font-medium text-text hover:bg-surface-muted', add.isPending && 'pointer-events-none opacity-60')}>
              <ImagePlus className="h-4 w-4" /> {add.isPending ? 'Uploading…' : 'Add photo'}
              <input type="file" className="sr-only" aria-label="Photo file" accept="image/jpeg,image/png,image/webp" disabled={add.isPending} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
        )}
        {fileError && <p role="alert" className="text-danger">{fileError}</p>}
      </CardBody>
    </Card>
  );
}
