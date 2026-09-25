import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Select, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { reviewsApi } from '@/lib/api/content';
import { masterDataApi } from '@/lib/api/masterData';

export function ReviewsPage() {
  const toast = useToast();
  const [routeId, setRouteId] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof reviewsApi.forRoute>> | null>(null);
  // A route picked by NAME, not a UUID typed/pasted from somewhere — no
  // one keeps a route's internal id memorized, but everyone on staff
  // knows their own routes by name ("Delhi -> Jaipur").
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });

  const load = useMutation({
    mutationFn: () => reviewsApi.forRoute(routeId),
    onSuccess: (r) => setData(r),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to load reviews'),
  });

  return (
    <>
      <PageHeader title="Reviews & Ratings" subtitle="Verified-traveller reviews, Bayesian-ranked" />
      <Card className="mb-6">
        <CardBody>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Select label="Route" value={routeId} onChange={(e) => setRouteId(e.target.value)}
                options={[{ label: 'Select a route…', value: '' }, ...(routes.data?.items ?? []).map((r) => ({ label: r.name, value: r.id }))]} />
            </div>
            <Button onClick={() => load.mutate()} loading={load.isPending} disabled={!routeId} leftIcon={<Star className="h-4 w-4" />}>Load</Button>
          </div>
        </CardBody>
      </Card>

      {data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="flex flex-col items-center gap-2 py-8">
              <div className="text-5xl font-semibold text-text">{data.summary.average.toFixed(1)}</div>
              <div className="flex text-accent">
                {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="h-5 w-5" fill={i <= Math.round(data.summary.average) ? 'currentColor' : 'none'} />)}
              </div>
              <div className="text-sm text-text-muted">{data.summary.count} reviews · Bayesian {data.summary.bayesian.toFixed(2)}</div>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Recent reviews" />
            <CardBody>
              {data.reviews.length ? (
                <pre className="max-h-96 overflow-auto rounded-md bg-surface-muted p-3 text-xs">{JSON.stringify(data.reviews, null, 2)}</pre>
              ) : <p className="text-sm text-text-muted">No reviews yet.</p>}
            </CardBody>
          </Card>
        </div>
      ) : (
        <EmptyState title="Load a route’s reviews" description="Enter a route ID above." icon={<Star className="h-10 w-10" />} />
      )}
    </>
  );
}
