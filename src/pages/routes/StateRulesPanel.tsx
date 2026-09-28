import { useQuery } from '@tanstack/react-query';
import { Landmark, Lock } from 'lucide-react';

import { Modal, PageLoader, ErrorState } from '@/components/ui';
import { categoryLabel, stateNormsApi, type StateRules } from '@/lib/api/stateNorms';

/**
 * The government rules of every state the route passes through, set by the
 * platform. They come from the route's cities, are always ticked and cannot
 * be unticked: passengers see them under the seat map whatever the route.
 */
export function StateRulesList({ states }: { states: StateRules[] }) {
  if (states.length === 0) return <p className="text-xs text-text-muted">Pick the cities to see the state rules this route will carry.</p>;
  return (
    <div className="flex flex-col gap-3">
      {states.map((s) => (
        <fieldset key={s.stateId} className="rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-text">{s.stateName}</legend>
          {s.norms.length === 0 ? <p className="text-xs text-text-muted">No government rules set for this state.</p> : (
            <ul className="flex flex-col gap-2">
              {s.norms.map((n) => (
                <li key={n.id}>
                  <label className="flex cursor-not-allowed items-start gap-2 text-sm" title="Set by the platform for this state — every route through it carries this rule">
                    <input type="checkbox" checked readOnly disabled aria-describedby={`norm-${n.id}`} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-text">{n.title}</span> <span className="text-xs text-text-muted">· {categoryLabel(n.category)}</span>
                      <span id={`norm-${n.id}`} className="block text-xs text-text-muted">{n.body}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ))}
      <p className="flex items-center gap-1 text-xs text-text-muted"><Lock className="h-3 w-3" /> Set by the platform for each state — they cannot be removed, and passengers see them before booking.</p>
    </div>
  );
}

/** While a route is drawn: the rules its cities' states bring. */
export function StateRulesForCities({ cityIds }: { cityIds: string[] }) {
  const ids = [...new Set(cityIds.filter(Boolean))];
  const q = useQuery({ queryKey: ['state-norms-cities', ids.join(',')], queryFn: () => stateNormsApi.forCities(ids), enabled: ids.length > 0 });
  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text"><Landmark className="h-4 w-4" /> Government rules on this route</div>
      {ids.length === 0 ? <StateRulesList states={[]} /> : q.isLoading ? <p className="text-xs text-text-muted">Loading the state rules…</p>
        : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : <StateRulesList states={q.data!.states} />}
    </div>
  );
}

/** For a saved route. */
export function StateRulesModal({ route, onClose }: { route: { id: string; name: string } | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['state-norms-route', route?.id], queryFn: () => stateNormsApi.forRoute(route!.id), enabled: !!route });
  return (
    <Modal open={!!route} onClose={onClose} title={`Government rules — ${route?.name ?? ''}`}>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : <StateRulesList states={q.data?.states ?? []} />}
    </Modal>
  );
}
