import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bus, CalendarClock, CheckCircle2 } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, PageLoader, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { crewAppApi, type CrewDuty } from '@/lib/api/crewApp';
import { formatDateTime, formatTime, localDateOf, todayLocal } from '@/lib/utils';

const ATT = { pending: ['neutral', 'Not marked'], present: ['success', 'Present'], late: ['warning', 'Late'], absent: ['danger', 'Absent'] } as const;
/** Attendance opens this long before a duty (the depot's rule). */
const ATTENDANCE_OPENS_MS = 6 * 3_600_000;

/** A conductor's / driver's day: today's duties first (two means a double duty), then the next ones. */
export function CrewHomePage() {
  const q = useQuery({ queryKey: ['crew-me'], queryFn: crewAppApi.me, refetchInterval: 60_000 });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { crew, duties } = q.data!;
  const today = todayLocal();
  const todays = duties.filter((d) => localDateOf(d.startsAt) <= today && Date.parse(d.endsAt) > Date.now() - 12 * 3_600_000 && localDateOf(d.startsAt) === today);
  const later = duties.filter((d) => !todays.includes(d));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Namaste, ${crew.fullName.split(' ')[0]}`} subtitle={`${crew.role}${crew.employeeCode ? ` · ${crew.employeeCode}` : ''}`} />
      <h2 className="mb-2 font-semibold text-text">Today{todays.length > 1 ? ` · ${todays.length} duties (double duty)` : ''}</h2>
      {todays.length === 0 ? <EmptyState title="No duty today" description={later[0] ? `Next: ${formatDateTime(later[0].startsAt)}` : 'Nothing on your roster yet.'} icon={<CalendarClock className="h-10 w-10" />} /> : (
        <div className="flex flex-col gap-3">{todays.map((d) => <DutyCard key={d.id} d={d} />)}</div>
      )}
      {later.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-semibold text-text">Next duties</h2>
          <div className="flex flex-col gap-3">{later.map((d) => <DutyCard key={d.id} d={d} />)}</div>
        </>
      )}
    </div>
  );
}

function DutyCard({ d }: { d: CrewDuty }) {
  const qc = useQueryClient();
  const toast = useToast();
  const mark = useMutation({
    mutationFn: () => crewAppApi.markPresent(d.id),
    onSuccess: (r) => { toast.success(r.attendance === 'late' ? 'Marked present — late' : 'Marked present'); void qc.invalidateQueries({ queryKey: ['crew-me'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not mark'),
  });
  const opens = Date.parse(d.startsAt) - ATTENDANCE_OPENS_MS;
  const canMark = d.attendance === 'pending' && Date.now() >= opens && Date.parse(d.endsAt) > Date.now();
  const [tone, label] = ATT[d.attendance];
  return (
    <Card>
      <CardBody className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Bus className="h-5 w-5 text-primary" /><span className="font-semibold text-text">{d.routeName ?? 'Depot duty'}</span>{d.serviceCode && <span className="text-text-muted">· {d.serviceCode}</span>}</div>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <div className="text-text-muted">Duty {formatDateTime(d.startsAt)} – {formatTime(d.endsAt)}{d.departsAt ? ` · bus leaves ${formatTime(d.departsAt)}` : ''}{d.bus ? ` · ${d.bus}` : ''}</div>
        {d.tripId && <div className="text-text-muted">{d.seatsSold}{d.seatsTotal ? ` / ${d.seatsTotal}` : ''} seats sold · trip {d.tripStatus}</div>}
        <div className="flex flex-wrap gap-2">
          {d.attendance === 'pending' && (
            <Button size="sm" variant="outline" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={mark.isPending} disabled={!canMark || mark.isPending}
              title={canMark ? undefined : `Opens ${formatDateTime(new Date(opens).toISOString())}`} onClick={() => mark.mutate()}>I am present</Button>
          )}
          {d.tripId && <Link to={`/crew/trips/${d.tripId}`}><Button size="sm">Open trip</Button></Link>}
        </div>
        {d.attendance === 'pending' && !canMark && <p className="text-xs text-text-muted">Attendance opens {formatDateTime(new Date(opens).toISOString())}.</p>}
      </CardBody>
    </Card>
  );
}
