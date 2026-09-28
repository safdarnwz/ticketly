import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, useToast } from '@/components/ui';
import { waitlistRulesApi } from '@/lib/api/waitlistRules';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const whole = (v: string, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max; };

/**
 * Waitlist rules (#237, #239): how many people may wait for one bus, for how
 * many seats each, when the list closes before departure and when a waiting
 * entry lapses. The platform default applies until the operator sets its own.
 */
export function WaitlistRulesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['waitlist-rules'], queryFn: waitlistRulesApi.get });
  const [f, setF] = useState({ maxPerTrip: '', maxSeatsPerEntry: '', closeMinutesBefore: '', entryExpiryHours: '' });
  useEffect(() => {
    if (!q.data) return;
    const r = q.data.rules;
    setF({ maxPerTrip: String(r.maxPerTrip), maxSeatsPerEntry: String(r.maxSeatsPerEntry), closeMinutesBefore: String(r.closeMinutesBefore), entryExpiryHours: r.entryExpiryHours === null ? '' : String(r.entryExpiryHours) });
  }, [q.data]);
  const e = {
    maxPerTrip: !whole(f.maxPerTrip, 1, 500) ? '1 to 500' : undefined,
    maxSeatsPerEntry: !whole(f.maxSeatsPerEntry, 1, 10) ? '1 to 10' : undefined,
    closeMinutesBefore: !whole(f.closeMinutesBefore, 0, 1440) ? '0 to 1440 minutes' : undefined,
    entryExpiryHours: f.entryExpiryHours.trim() !== '' && !whole(f.entryExpiryHours, 1, 720) ? '1 to 720 hours, or empty' : undefined,
  };
  const done = (msg: string) => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['waitlist-rules'] }); };
  const save = useMutation({
    mutationFn: () => waitlistRulesApi.set({
      maxPerTrip: Number(f.maxPerTrip), maxSeatsPerEntry: Number(f.maxSeatsPerEntry), closeMinutesBefore: Number(f.closeMinutesBefore),
      entryExpiryHours: f.entryExpiryHours.trim() === '' ? null : Number(f.entryExpiryHours),
    }),
    onSuccess: () => done('Waitlist rules saved — they apply to new entries and the next seats freed'),
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  const reset = useMutation({
    mutationFn: waitlistRulesApi.reset,
    onSuccess: () => done('Back to the platform default'),
    onError: (x) => toast.error(errText(x, 'Could not reset')),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">Waitlist rules <Badge tone={q.data!.isCustom ? 'info' : 'neutral'}>{q.data!.isCustom ? 'your own' : 'platform default'}</Badge></span>}
        subtitle="When a bus is full, passengers can wait. When seats free up, those waiting are told first-come, first-served." />
      <CardBody className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Most people waiting for one bus" type="number" value={f.maxPerTrip} error={e.maxPerTrip} onChange={(x) => setF({ ...f, maxPerTrip: x.target.value })} />
          <Input label="Most seats one person may wait for" type="number" value={f.maxSeatsPerEntry} error={e.maxSeatsPerEntry} onChange={(x) => setF({ ...f, maxSeatsPerEntry: x.target.value })} />
          <Input label="Close the list (minutes before departure)" type="number" value={f.closeMinutesBefore} error={e.closeMinutesBefore} hint="No one joins or is told about seats after this" onChange={(x) => setF({ ...f, closeMinutesBefore: x.target.value })} />
          <Input label="A waiting entry lapses after (hours)" type="number" value={f.entryExpiryHours} error={e.entryExpiryHours} hint="Empty = waits until the list closes" onChange={(x) => setF({ ...f, entryExpiryHours: x.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button loading={save.isPending} disabled={save.isPending || Object.values(e).some(Boolean)} onClick={() => save.mutate()}>Save</Button>
          {q.data!.isCustom && <Button variant="ghost" loading={reset.isPending} disabled={reset.isPending} onClick={() => reset.mutate()}>Use the platform default</Button>}
        </div>
      </CardBody>
    </Card>
  );
}
