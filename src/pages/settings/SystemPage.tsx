import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Construction, Database, FileDown } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi } from '@/lib/api/platformAdmin';
import { formatDateTime, fromAppDateTimeInput, idempotencyKey } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Keeping the platform running (#47, #48, #52, #53, #109, #110, #116):
 * maintenance mode now or in a planned window (operators told in advance),
 * clearing caches after a data fix, and the audit log as a file.
 */
export function SystemPage() {
  return (
    <>
      <PageHeader title="System" subtitle="Maintenance, caches and the audit log" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MaintenanceCard />
        <WindowsCard />
        <CacheCard />
        <AuditCard />
      </div>
    </>
  );
}

function MaintenanceCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['maintenance'], queryFn: platformAdminApi.maintenance });
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const untilErr = until && fromAppDateTimeInput(until) <= Date.now() ? 'Must be in the future' : undefined;
  const set = useMutation({
    mutationFn: (on: boolean) => platformAdminApi.setMaintenance(on, message.trim() || undefined, on && until ? new Date(fromAppDateTimeInput(until)).toISOString() : null),
    onSuccess: (r) => { toast.success(r.enabled ? 'Maintenance mode is ON — bookings and changes are paused' : 'Maintenance mode is off — the platform is open'); void qc.invalidateQueries({ queryKey: ['maintenance'] }); },
    onError: (e) => toast.error(errText(e, 'Could not change it')),
  });
  const on = q.data?.enabled;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Construction className="h-4 w-4" /> Maintenance mode</span>} subtitle="Pauses bookings and every change; reading, webhooks and this console keep working" />
      <CardBody className="flex flex-col gap-3 text-sm">
        {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : on ? (
          <>
            <div className="flex items-center gap-2"><Badge tone="danger">ON</Badge> {q.data!.message || 'No message'}{q.data!.until ? ` · until ${formatDateTime(q.data!.until)}` : ''}</div>
            <Button className="self-start" loading={set.isPending} disabled={set.isPending} onClick={() => set.mutate(false)}>Turn off — open the platform</Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2"><Badge tone="success">off</Badge> The platform is open</div>
            <Input label="Message shown to users (optional)" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="Upgrading our systems — back in 30 minutes" />
            <Input label="Expected back at (optional)" type="datetime-local" value={until} error={untilErr} onChange={(e) => setUntil(e.target.value)} />
            <Button variant="danger" className="self-start" loading={set.isPending} disabled={set.isPending || !!untilErr}
              onClick={() => { if (window.confirm('Pause bookings and changes across every operator now?')) set.mutate(true); }}>Turn on now</Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function WindowsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['maintenance-windows'], queryFn: () => platformAdminApi.maintenanceWindows() });
  const [key, setKey] = useState(() => idempotencyKey('mw'));
  const [f, setF] = useState({ startsAt: '', endsAt: '', message: '', notify: true });
  const [tried, setTried] = useState(false);
  const s = f.startsAt ? fromAppDateTimeInput(f.startsAt) : 0;
  const en = f.endsAt ? fromAppDateTimeInput(f.endsAt) : 0;
  const e = {
    startsAt: !f.startsAt ? 'When does it start?' : s <= Date.now() ? 'Must be in the future' : undefined,
    endsAt: !f.endsAt ? 'When does it end?' : en <= s ? 'Must be after the start' : en - s > 24 * 3_600_000 ? 'At most 24 hours' : undefined,
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['maintenance-windows'] });
  const schedule = useMutation({
    mutationFn: () => platformAdminApi.scheduleMaintenance({ startsAt: new Date(s).toISOString(), endsAt: new Date(en).toISOString(), message: f.message.trim(), notifyOperators: f.notify }, key),
    onSuccess: (r) => {
      toast.success(r.notified ? `Scheduled — ${r.notified.sent} operator${r.notified.sent === 1 ? '' : 's'} told` : 'Scheduled — maintenance turns on by itself at the start');
      setF({ startsAt: '', endsAt: '', message: '', notify: true }); setTried(false); setKey(idempotencyKey('mw')); refresh();
    },
    onError: (x) => toast.error(errText(x, 'Could not schedule')),
  });
  const notify = useMutation({
    mutationFn: (id: string) => platformAdminApi.notifyMaintenance(id),
    onSuccess: (r) => { toast.success(`Told ${r.sent} operator${r.sent === 1 ? '' : 's'}${r.failed ? ` (${r.failed} failed)` : ''}`); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not notify')),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => platformAdminApi.cancelMaintenance(id),
    onSuccess: () => { toast.success('Window cancelled'); refresh(); },
    onError: (x) => toast.error(errText(x, 'Could not cancel')),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Planned maintenance</span>} subtitle="Maintenance mode turns on and off by itself in the window" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Starts" type="datetime-local" value={f.startsAt} error={tried ? e.startsAt : undefined} onChange={(x) => setF({ ...f, startsAt: x.target.value })} />
          <Input label="Ends" type="datetime-local" value={f.endsAt} error={tried ? e.endsAt : undefined} onChange={(x) => setF({ ...f, endsAt: x.target.value })} />
        </div>
        <Input label="Message (optional)" value={f.message} maxLength={300} onChange={(x) => setF({ ...f, message: x.target.value })} placeholder="Database upgrade" />
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.notify} onChange={(x) => setF({ ...f, notify: x.target.checked })} /> Email every operator now</label>
        <Button className="self-start" loading={schedule.isPending} disabled={schedule.isPending} onClick={() => { setTried(true); if (!e.startsAt && !e.endsAt) schedule.mutate(); }}>Schedule</Button>
        <div className="border-t border-border pt-2">
          {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data!.items.length === 0 ? <p className="text-text-muted">Nothing planned.</p> : (
            <ul className="flex flex-col gap-2">
              {q.data!.items.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{formatDateTime(w.startsAt)} → {formatDateTime(w.endsAt)}{w.message ? ` · ${w.message}` : ''} {w.cancelledAt ? <Badge tone="neutral">cancelled</Badge> : w.notifiedAt ? <Badge tone="info">operators told</Badge> : null}</span>
                  {!w.cancelledAt && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="outline" loading={notify.isPending && notify.variables === w.id} disabled={notify.isPending} onClick={() => notify.mutate(w.id)}>{w.notifiedAt ? 'Tell again' : 'Tell operators'}</Button>
                      <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === w.id} disabled={cancel.isPending} onClick={() => { if (window.confirm('Cancel this maintenance window?')) cancel.mutate(w.id); }}>Cancel</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function CacheCard() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['cache-namespaces'], queryFn: platformAdminApi.cacheNamespaces });
  const [picked, setPicked] = useState<string[]>([]);
  const clear = useMutation({
    mutationFn: () => platformAdminApi.clearCache(picked),
    onSuccess: (r) => { const n = Object.values(r.cleared).reduce((a, b) => a + b, 0); toast.success(`Cleared ${n} cached entr${n === 1 ? 'y' : 'ies'}`); setPicked([]); },
    onError: (e) => toast.error(errText(e, 'Could not clear')),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Database className="h-4 w-4" /> Caches</span>} subtitle="After fixing data by hand. Sign-ins, rate limits and payment retries are never touched." />
      <CardBody className="flex flex-col gap-3 text-sm">
        {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
          <div className="flex flex-wrap gap-2">
            {q.data!.namespaces.map((n) => {
              const on = picked.includes(n);
              return <button key={n} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== n) : [...picked, n])}
                className={`rounded-md border px-2 py-1 font-mono text-xs ${on ? 'border-primary bg-primary text-white' : 'border-border'}`}>{n}</button>;
            })}
          </div>
        )}
        <Button className="self-start" variant="outline" loading={clear.isPending} disabled={clear.isPending || q.isLoading}
          onClick={() => { if (picked.length || window.confirm('Clear every cache? Pages are slower for a minute while they refill.')) clear.mutate(); }}>
          {picked.length ? `Clear ${picked.length} selected` : 'Clear all caches'}
        </Button>
      </CardBody>
    </Card>
  );
}

function AuditCard() {
  const toast = useToast();
  const [busy, setBusy] = useState<30 | 90 | null>(null);
  const get = async (days: 30 | 90) => {
    setBusy(days);
    try { await platformAdminApi.exportAuditLog(days); } catch (e) { toast.error(errText(e, 'Could not export')); } finally { setBusy(null); }
  };
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><FileDown className="h-4 w-4" /> Audit log</span>} subtitle="Who did what, across every operator — as a CSV file" />
      <CardBody className="flex gap-2 text-sm">
        <Button variant="outline" loading={busy === 30} disabled={busy !== null} onClick={() => void get(30)}>Last 30 days</Button>
        <Button variant="outline" loading={busy === 90} disabled={busy !== null} onClick={() => void get(90)}>Last 90 days</Button>
      </CardBody>
    </Card>
  );
}
