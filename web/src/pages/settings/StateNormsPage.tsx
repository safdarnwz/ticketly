import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageLoader, Select, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { categoryLabel, STATE_NORM_CATEGORIES, stateNormsAdminApi, type StateNorm, type StateNormCategory } from '@/lib/api/stateNorms';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
type Draft = { category: StateNormCategory; title: string; body: string };
const EMPTY: Draft = { category: 'liquor', title: '', body: '' };

function draftErrors(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (d.title.trim().length < 3 || d.title.trim().length > 80) e.title = '3–80 characters';
  if (d.body.trim().length < 3 || d.body.trim().length > 500) e.body = '3–500 characters';
  return e;
}

/**
 * Government rules per state (liquor prohibition, smoking, tobacco…). Every
 * route through a state carries its rules — operators cannot drop them — and
 * passengers see them under the seat map. Rules are switched off, never deleted.
 */
export function StateNormsPage() {
  const states = useQuery({ queryKey: ['admin-states'], queryFn: stateNormsAdminApi.states });
  const [stateId, setStateId] = useState('');
  const norms = useQuery({ queryKey: ['admin-state-norms', stateId], queryFn: () => stateNormsAdminApi.list(stateId || undefined), enabled: states.isSuccess });

  return (
    <>
      <PageHeader title="State rules" subtitle="Government rules per state — every route through the state carries them; operators cannot remove them" />
      {states.isLoading ? <PageLoader /> : states.isError ? <ErrorState error={states.error} onRetry={states.refetch} /> : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="flex flex-wrap items-end gap-3">
              <div className="w-64">
                <Select label="State" value={stateId} onChange={(e) => setStateId(e.target.value)}
                  options={[{ label: 'All states', value: '' }, ...(states.data?.items ?? []).map((s) => ({ label: s.name, value: s.id }))]} />
              </div>
              <p className="pb-2 text-sm text-text-muted">Passengers see the rules of every state their bus passes through, above the operator’s own policies.</p>
            </CardBody>
          </Card>
          {stateId ? <AddRule stateId={stateId} stateName={states.data?.items.find((s) => s.id === stateId)?.name ?? ''} />
            : <p className="text-sm text-text-muted">Choose a state to add a rule to it.</p>}
          {norms.isLoading ? <PageLoader /> : norms.isError ? <ErrorState error={norms.error} onRetry={norms.refetch} /> :
            norms.data!.items.length === 0 ? <EmptyState icon={<Landmark className="h-10 w-10" />} title="No rules yet" description={stateId ? 'This state has no rules. Add the first one above.' : 'No state has rules yet.'} /> : (
              <div className="flex flex-col gap-3">{norms.data!.items.map((n) => <RuleRow key={n.id} norm={n} />)}</div>
            )}
        </div>
      )}
    </>
  );
}

function AddRule({ stateId, stateName }: { stateId: string; stateName: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState<Draft>(EMPTY);
  const [tried, setTried] = useState(false);
  const errors = draftErrors(d);
  const add = useMutation({
    mutationFn: () => stateNormsAdminApi.create({ stateId, category: d.category, title: d.title.trim(), body: d.body.trim() }),
    onSuccess: () => { toast.success(`Rule added — every route through ${stateName} now carries it`); setD(EMPTY); setTried(false); void qc.invalidateQueries({ queryKey: ['admin-state-norms'] }); },
    onError: (e) => toast.error(errText(e, 'Could not add the rule')),
  });
  return (
    <Card>
      <CardHeader title={`Add a rule for ${stateName}`} subtitle="Applies at once to every operator’s routes through this state" />
      <CardBody className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="About" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as StateNormCategory })}
            options={STATE_NORM_CATEGORIES.map((c) => ({ label: c.label, value: c.value }))} />
          <div className="sm:col-span-2"><Input label="Title" placeholder="Liquor prohibited" value={d.title} maxLength={80} onChange={(e) => setD({ ...d, title: e.target.value })} error={tried ? errors.title : undefined} /></div>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          What passengers must know
          <textarea className="min-h-24 rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal" maxLength={500} value={d.body}
            placeholder="Carrying or drinking liquor is an offence under the state’s prohibition law. Bags may be checked at the border."
            onChange={(e) => setD({ ...d, body: e.target.value })} aria-invalid={tried && !!errors.body} />
          <span className={tried && errors.body ? 'text-xs text-danger' : 'text-xs text-text-muted'}>{tried && errors.body ? errors.body : `${d.body.length}/500`}</span>
        </label>
        <div className="flex justify-end">
          <Button leftIcon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={add.isPending}
            onClick={() => { setTried(true); if (Object.keys(errors).length === 0) add.mutate(); }}>Add rule</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function RuleRow({ norm }: { norm: StateNorm }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>({ category: norm.category, title: norm.title, body: norm.body });
  const errors = draftErrors(d);
  const save = useMutation({
    mutationFn: (body: Parameters<typeof stateNormsAdminApi.update>[1]) => stateNormsAdminApi.update(norm.id, body),
    onSuccess: (_r, body) => {
      toast.success(body.isActive === false ? 'Switched off — routes no longer show it' : body.isActive ? 'Switched on again' : 'Rule updated');
      setEditing(false); void qc.invalidateQueries({ queryKey: ['admin-state-norms'] });
    },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        {editing ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="About" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as StateNormCategory })}
                options={STATE_NORM_CATEGORIES.map((c) => ({ label: c.label, value: c.value }))} />
              <div className="sm:col-span-2"><Input label="Title" value={d.title} maxLength={80} onChange={(e) => setD({ ...d, title: e.target.value })} error={errors.title} /></div>
            </div>
            <textarea aria-label="What passengers must know" className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-sm" maxLength={500} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
            {errors.body && <p className="text-xs text-danger">{errors.body}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setEditing(false); setD({ category: norm.category, title: norm.title, body: norm.body }); }}>Cancel</Button>
              <Button loading={save.isPending} disabled={save.isPending || Object.keys(errors).length > 0}
                onClick={() => save.mutate({ category: d.category, title: d.title.trim(), body: d.body.trim() })}>Save</Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text">{norm.title}</span>
                <Badge tone="info">{categoryLabel(norm.category)}</Badge>
                <span className="text-xs text-text-muted">{norm.stateName}</span>
                {!norm.isActive && <Badge tone="neutral">switched off</Badge>}
              </div>
              <p className="mt-1 text-sm text-text-muted">{norm.body}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="outline" loading={save.isPending} disabled={save.isPending}
                onClick={() => save.mutate({ isActive: !norm.isActive })}>{norm.isActive ? 'Switch off' : 'Switch on'}</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
