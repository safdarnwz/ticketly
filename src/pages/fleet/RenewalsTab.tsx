import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';

import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageLoader, Select } from '@/components/ui';
import { fleetApi } from '@/lib/api/fleet';

const DOC_LABEL: Record<string, string> = { permit: 'Permit', insurance: 'Insurance', fitness: 'Fitness certificate', puc: 'PUC', rc: 'RC', road_tax: 'Road tax' };
const due = (daysLeft: number | null) =>
  daysLeft === null ? <Badge tone="danger">not on file</Badge>
    : daysLeft < 0 ? <Badge tone="danger">expired {-daysLeft} day{daysLeft === -1 ? '' : 's'} ago</Badge>
      : daysLeft === 0 ? <Badge tone="danger">expires today</Badge>
        : <Badge tone={daysLeft <= 7 ? 'warning' : 'neutral'}>in {daysLeft} day{daysLeft === 1 ? '' : 's'}</Badge>;

/** Everything that must be renewed soon: bus documents (a bus with an expired one is taken off the road) and driver licences. */
export function RenewalsTab() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['renewals', days], queryFn: () => fleetApi.renewals(days) });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <Select label="Due within" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[7, 15, 30, 60, 90].map((d) => ({ value: String(d), label: `${d} days` }))} />
        <p className="text-sm text-text-muted">A bus whose document has expired is suspended automatically and cannot run trips.</p>
      </div>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Bus documents" subtitle={`${q.data!.documents.length} due`} />
            <CardBody>
              {q.data!.documents.length === 0 ? <EmptyState title="Nothing due" icon={<CalendarClock className="h-10 w-10" />} /> : (
                <ul className="divide-y divide-border text-sm">
                  {q.data!.documents.map((d) => (
                    <li key={`${d.vehicleId}-${d.docType}`} className="flex items-center justify-between gap-2 py-2">
                      <div><Link className="font-medium text-primary hover:underline" to={`/fleet/vehicles/${d.vehicleId}`}>{d.registrationNo}</Link>
                        <div className="text-xs text-text-muted">{DOC_LABEL[d.docType] ?? d.docType}{d.documentNo ? ` · ${d.documentNo}` : ''} · {d.expiresOn}</div></div>
                      {due(d.daysLeft)}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Driver licences" subtitle={`${q.data!.licences.length} to sort out`} />
            <CardBody>
              {q.data!.licences.length === 0 ? <EmptyState title="Nothing due" icon={<CalendarClock className="h-10 w-10" />} /> : (
                <ul className="divide-y divide-border text-sm">
                  {q.data!.licences.map((l) => (
                    <li key={l.crewId} className="flex items-center justify-between gap-2 py-2">
                      <div><div className="font-medium text-text">{l.fullName}</div>
                        <div className="text-xs text-text-muted">{l.licenceNo ?? 'No licence number'}{l.expiresOn ? ` · ${l.expiresOn}` : ''}</div></div>
                      {due(l.daysLeft)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-text-muted">Update a licence under Crew & Duties → Crew → Edit. A driver whose licence ends before a duty cannot be given it.</p>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
