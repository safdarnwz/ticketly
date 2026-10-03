import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Lightbulb } from 'lucide-react';

import { Button, Card, CardBody, Input, Select, useToast, usePaged } from '@/components/ui';
import { masterDataApi } from '@/lib/api/masterData';
import { serviceAdminApi, type ExtraTripSuggestion } from '@/lib/api/scheduling';
import { addDaysIso, dayDiff, formatDateTime, todayLocal } from '@/lib/utils';

/** Days a route does not run (strike, road closure). Trips without bookings on those days are cancelled. */
export function RouteBlackouts() {
  const qc = useQueryClient();
  const toast = useToast();
  const routes = useQuery({ queryKey: ['routes', 'published'], queryFn: () => masterDataApi.listRoutes('published') });
  const [routeId, setRouteId] = useState('');
  const today = todayLocal();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const list = useQuery({
    queryKey: ['blackouts', routeId],
    queryFn: () => serviceAdminApi.blackouts(routeId),
    enabled: !!routeId,
  });
  const listPage = usePaged(list.data?.items ?? []);
  const e: Record<string, string> = {};
  if (!from || from < today) e.from = 'From today on';
  if (!to || to < from) e.to = 'On or after the first day';
  else if (dayDiff(from, to) >= 60) e.to = 'At most 60 days at once';
  if (reason.trim().length < 3) e.reason = 'Say why';
  const dates = () => {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
    return out;
  };
  const add = useMutation({
    mutationFn: () => serviceAdminApi.addBlackouts(routeId, dates(), reason.trim()),
    onSuccess: (r) => {
      toast.success(
        `Blocked ${r.dates.length} day(s) — ${r.tripsCancelled} unsold trip(s) cancelled` +
          (r.tripsWithBookings.length ? `; ${r.tripsWithBookings.length} trip(s) have bookings — handle them from Trips` : ''),
      );
      setReason('');
      void qc.invalidateQueries({ queryKey: ['blackouts', routeId] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (x) => toast.error(x instanceof Error ? x.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (d: string) => serviceAdminApi.removeBlackouts(routeId, [d]),
    onSuccess: () => {
      toast.success('Date opened again — trips come back at the next top-up');
      void qc.invalidateQueries({ queryKey: ['blackouts', routeId] });
    },
    onError: (x) => toast.error(x instanceof Error ? x.message : 'Failed'),
  });
  return (
    <Card>
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-2 font-semibold text-text">
          <CalendarOff className="h-4 w-4" /> Days a route does not run
        </div>
        <div className="w-72">
          <Select
            label="Route"
            value={routeId}
            onChange={(x) => setRouteId(x.target.value)}
            options={[
              { label: 'Choose a route…', value: '' },
              ...(routes.data?.items ?? []).map((r) => ({ label: r.name, value: r.id })),
            ]}
          />
        </div>
        {routeId && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Input label="From" type="date" min={today} value={from} error={e.from} onChange={(x) => setFrom(x.target.value)} />
              <Input label="To" type="date" min={from} value={to} error={e.to} onChange={(x) => setTo(x.target.value)} />
              <div className="w-64">
                <Input
                  label="Reason"
                  value={reason}
                  error={reason ? e.reason : undefined}
                  placeholder="e.g. Bharat bandh"
                  onChange={(x) => setReason(x.target.value)}
                />
              </div>
              <Button loading={add.isPending} disabled={add.isPending || Object.keys(e).length > 0} onClick={() => add.mutate()}>
                Block days
              </Button>
            </div>
            {(list.data?.items.length ?? 0) === 0 ? (
              <p className="text-text-muted">No blocked days ahead.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {listPage.pageItems.map((b) => (
                  <span
                    key={b.date}
                    className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs"
                  >
                    {b.date} · {b.reason}
                    <button
                      className="text-text-muted hover:text-danger"
                      aria-label={`Open ${b.date} again`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(b.date)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {listPage.pager}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Trips in the next week that are nearly full or have people waiting — add an extra bus. */
export function ExtraTripSuggestions({ onAdd }: { onAdd: (s: ExtraTripSuggestion) => void }) {
  const q = useQuery({ queryKey: ['extra-trip-suggestions'], queryFn: serviceAdminApi.suggestions });
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-semibold text-text">
          <Lightbulb className="h-4 w-4 text-warning" /> Busy trips — consider an extra bus
        </div>
        {items.map((s) => (
          <div key={s.tripId} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
            <div>
              <span className="font-medium">{s.routeName}</span>{' '}
              <span className="text-text-muted">
                · {formatDateTime(s.departsAt)} · {s.sold}/{s.totalSeats} sold
                {s.waitingSeats ? ` · ${s.waitingSeats} waiting` : ''}
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => onAdd(s)}>
              Add extra trip
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
