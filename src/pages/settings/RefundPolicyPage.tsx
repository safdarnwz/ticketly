import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Plus, Trash2, ShieldCheck } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { refundPolicyApi, type RefundTier } from '@/lib/api/refund-policy';

export function RefundPolicyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery({ queryKey: ['refund-policy'], queryFn: refundPolicyApi.get });

  const [tiers, setTiers] = useState<RefundTier[]>([]);
  const [flatFeeMinor, setFlatFeeMinor] = useState('0');
  const [cutoffHours, setCutoffHours] = useState('0');

  // Load the current policy (custom or platform default) into the editable
  // form once — after that the form is the source of truth until saved.
  useEffect(() => {
    if (!data.data) return;
    setTiers(data.data.policy.tiers);
    setFlatFeeMinor(String((data.data.policy.flatFeeMinor ?? 0) / 100));
    setCutoffHours(String(data.data.policy.cutoffHours ?? 0));
  }, [data.data]);

  const save = useMutation({
    mutationFn: () => refundPolicyApi.set({
      tiers: [...tiers].sort((a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture),
      flatFeeMinor: Math.round(Number(flatFeeMinor) * 100) || 0,
      cutoffHours: Number(cutoffHours) || 0,
    }),
    onSuccess: () => {
      toast.success('Cancellation policy updated — applies to any cancellation from now on, never retroactively');
      void qc.invalidateQueries({ queryKey: ['refund-policy'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save — check every tier has a valid percentage'),
  });

  const reset = useMutation({
    mutationFn: () => refundPolicyApi.reset(),
    onSuccess: () => {
      toast.success('Reverted to the platform default policy');
      void qc.invalidateQueries({ queryKey: ['refund-policy'] });
    },
  });

  if (data.isLoading) return <PageLoader />;
  if (data.isError) return <ErrorState error={data.error} onRetry={data.refetch} />;

  const updateTier = (idx: number, patch: Partial<RefundTier>) =>
    setTiers((cur) => cur.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const addTier = () => setTiers((cur) => [...cur, { minHoursBeforeDeparture: 0, refundPct: 0 }]);
  const removeTier = (idx: number) => setTiers((cur) => cur.filter((_, i) => i !== idx));

  const canSave = tiers.length > 0 && tiers.every((t) => t.refundPct >= 0 && t.refundPct <= 100 && t.minHoursBeforeDeparture >= 0);

  return (
    <>
      <PageHeader title="Cancellation Policy" subtitle="How much a passenger gets back, based on how long before departure they cancel" />

      {!data.data?.isCustom && (
        <Card className="mb-4 border-primary/30">
          <CardBody className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div className="text-sm text-text-muted">You are currently using the <b className="text-text">platform default</b> policy. Edit and save below to set your own.</div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Refund tiers" subtitle="Highest applicable tier wins — e.g. cancelling 30 hours before departure uses the 24h+ tier" />
        <CardBody className="flex flex-col gap-3">
          {tiers.map((tier, idx) => (
            <div key={idx} className="flex items-end gap-3">
              <Input
                label="Hours before departure (at least)"
                type="number"
                value={tier.minHoursBeforeDeparture}
                onChange={(e) => updateTier(idx, { minHoursBeforeDeparture: Number(e.target.value) })}
              />
              <Input
                label="Refund %"
                type="number"
                value={tier.refundPct}
                onChange={(e) => updateTier(idx, { refundPct: Number(e.target.value) })}
              />
              <Button variant="ghost" size="sm" onClick={() => removeTier(idx)} leftIcon={<Trash2 className="h-4 w-4" />}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addTier} leftIcon={<Plus className="h-4 w-4" />} className="self-start">Add tier</Button>

          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <Input label="Flat cancellation fee (₹, optional)" type="number" value={flatFeeMinor} onChange={(e) => setFlatFeeMinor(e.target.value)} hint="Deducted on top of the tier percentage, per ticket" />
            <Input label="Hard cutoff (hours, optional)" type="number" value={cutoffHours} onChange={(e) => setCutoffHours(e.target.value)} hint="Cancellation blocked entirely within this many hours of departure" />
          </div>

          <div className="mt-2 flex gap-3">
            <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>Save policy</Button>
            {data.data?.isCustom && (
              <Button variant="outline" loading={reset.isPending} onClick={() => reset.mutate()} leftIcon={<RotateCcw className="h-4 w-4" />}>
                Reset to platform default
              </Button>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Changes apply to cancellations made after saving — a booking already cancelled under the old policy is never recalculated.
            This is also what shows to customers on the <a href="/legal/refund-policy" target="_blank" className="text-primary underline">Cancellation &amp; Refund Policy</a> page — keep the two in sync manually for now.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
