import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RotateCcw, Search } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageLoader, useToast } from '@/components/ui';
import { CityInput } from '@/components/customer/CityInput';
import { connectionRulesApi, connectionsApi } from '@/lib/api/connections';
import { addDaysIso, formatMoney, formatTime, minutesToHm, todayLocal } from '@/lib/utils';

/**
 * Connecting journeys: a traveller changes buses at a hub city. The platform
 * finds them from the routes on offer; here the operator decides whether its
 * buses take part and how long a change onto its bus must (and may) take — and
 * previews the connections its own network makes.
 */
export function ConnectionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['connection-rules'], queryFn: connectionRulesApi.get });
  const [f, setF] = useState({ enabled: true, min: '120', max: '1440' });
  useEffect(() => {
    if (q.data) setF({ enabled: q.data.rules.enabled, min: String(q.data.rules.minLayoverMin), max: String(q.data.rules.maxLayoverMin) });
  }, [q.data]);
  const min = Number(f.min);
  const max = Number(f.max);
  const errors: Record<string, string> = {};
  if (!Number.isInteger(min) || min < 15 || min > 720) errors.min = '15 to 720 minutes';
  if (!Number.isInteger(max) || max < 30 || max > 1440) errors.max = '30 to 1440 minutes (24 h)';
  else if (!errors.min && max <= min) errors.max = 'Must be more than the shortest change';
  const refresh = () => void qc.invalidateQueries({ queryKey: ['connection-rules'] });
  const save = useMutation({
    mutationFn: () => connectionRulesApi.set({ enabled: f.enabled, minLayoverMin: min, maxLayoverMin: max }),
    onSuccess: () => { toast.success('Connection rules saved — searches use them from now on'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });
  const reset = useMutation({
    mutationFn: connectionRulesApi.reset,
    onSuccess: () => { toast.success('Back to the platform default'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Connection rules" subtitle="For travellers who change onto one of your buses at a hub city" action={q.data?.isCustom ? <Badge tone="info">Your own rules</Badge> : <Badge>Platform default</Badge>} />
        <CardBody className="flex flex-col gap-3 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} aria-label="Sell my buses as part of connecting journeys" />
            <span><span className="font-medium text-text">Sell my buses as part of connecting journeys</span><br />
              <span className="text-xs text-text-muted">{f.enabled ? 'Your trips can be the first or second bus of a two-bus journey.' : 'Your trips are never offered as part of a connection — direct bookings only.'}</span></span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Shortest change (minutes)" type="number" min={15} max={720} value={f.min} disabled={!f.enabled} onChange={(e) => setF({ ...f, min: e.target.value })} error={errors.min}
              hint="Travellers can never be given less time than this to reach your bus" />
            <Input label="Longest wait (minutes)" type="number" min={30} max={1440} value={f.max} disabled={!f.enabled} onChange={(e) => setF({ ...f, max: e.target.value })} error={errors.max}
              hint={Number.isInteger(max) && max > 0 ? `${minutesToHm(max)} — longer waits are not offered` : undefined} />
          </div>
          <div className="flex gap-2">
            <Button loading={save.isPending} disabled={save.isPending || Object.keys(errors).length > 0} onClick={() => save.mutate()}>Save rules</Button>
            {q.data?.isCustom && <Button variant="outline" leftIcon={<RotateCcw className="h-4 w-4" />} loading={reset.isPending} disabled={reset.isPending} onClick={() => reset.mutate()}>Reset to platform default</Button>}
          </div>
        </CardBody>
      </Card>
      <Preview />
    </div>
  );
}

/** The two-bus journeys your own network makes between two cities on a day. */
function Preview() {
  const [from, setFrom] = useState<{ id: string; name: string } | null>(null);
  const [to, setTo] = useState<{ id: string; name: string } | null>(null);
  const [date, setDate] = useState(addDaysIso(todayLocal(), 1));
  const [asked, setAsked] = useState<{ from: string; to: string; date: string } | null>(null);
  const same = from && to && from.id === to.id;
  const r = useQuery({
    queryKey: ['connections-preview', asked],
    queryFn: () => connectionsApi.search(asked!.from, asked!.to, asked!.date),
    enabled: !!asked,
  });
  const options = r.data?.options ?? [];
  return (
    <Card>
      <CardHeader title="Your connections" subtitle="Two-bus journeys between two cities that your own buses make, with the rules above" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
          <CityInput label="From" value={from?.name ?? ''} onSelect={(c) => setFrom({ id: c.id, name: c.name })} onClear={() => setFrom(null)} />
          <CityInput label="To" value={to?.name ?? ''} onSelect={(c) => setTo({ id: c.id, name: c.name })} onClear={() => setTo(null)} error={same ? 'Pick a different city' : undefined} />
          <Input label="Date" type="date" min={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
          <Button leftIcon={<Search className="h-4 w-4" />} disabled={!from || !to || !!same || !date} onClick={() => setAsked({ from: from!.id, to: to!.id, date })}>Show connections</Button>
        </div>
        {!asked ? null : r.isLoading ? <PageLoader /> : r.isError ? <ErrorState error={r.error} onRetry={r.refetch} /> : options.length === 0 ? (
          <EmptyState title="No connections that day" description="No pair of your buses meets at a hub within your change window. Widen the window or check the timetables." />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {options.map((o, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span>{formatTime(o.leg1.departsAt)} {o.leg1.fromStopName}</span><ArrowRight className="h-3.5 w-3.5 text-text-muted" />
                <span className="font-medium">{o.connectionCityName}</span>
                <Badge tone="info">change {minutesToHm(o.layoverMinutes)}</Badge><ArrowRight className="h-3.5 w-3.5 text-text-muted" />
                <span>{o.leg2.toStopName} {formatTime(o.leg2.arrivesAt)}</span>
                <span className="ml-auto text-text-muted">{formatMoney(o.leg1.baseFareMinor + o.leg2.baseFareMinor, 'INR')} · {Math.min(o.leg1.availableSeats, o.leg2.availableSeats)} seats</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
