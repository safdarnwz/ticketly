import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Plus, Trash2, ShieldCheck } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, Modal, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { refundPolicyApi, type RefundTier } from '@/lib/api/refund-policy';

export function RefundPolicyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery({ queryKey: ['refund-policy'], queryFn: refundPolicyApi.get });

  const [tiers, setTiers] = useState<RefundTier[]>([]);
  const [flatFeeMinor, setFlatFeeMinor] = useState('0');
  const [cutoffHours, setCutoffHours] = useState('0');
  const [confirmReset, setConfirmReset] = useState(false);

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
      setConfirmReset(false);
      void qc.invalidateQueries({ queryKey: ['refund-policy'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  if (data.isLoading) return <PageLoader />;
  if (data.isError) return <ErrorState error={data.error} onRetry={data.refetch} />;

  const updateTier = (idx: number, patch: Partial<RefundTier>) =>
    setTiers((cur) => cur.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  const addTier = () => setTiers((cur) => [...cur, { minHoursBeforeDeparture: 0, refundPct: 0 }]);
  const removeTier = (idx: number) => setTiers((cur) => cur.filter((_, i) => i !== idx));

  // Same rules as the API: whole hours 0–720, 0–100 %, each hour count once, and
  // cancelling earlier never refunds less than cancelling later.
  const tierErrors = tiers.map((t) => ({
    hours: !Number.isInteger(t.minHoursBeforeDeparture) || t.minHoursBeforeDeparture < 0 || t.minHoursBeforeDeparture > 720 ? 'Whole hours, 0–720' : tiers.filter((x) => x.minHoursBeforeDeparture === t.minHoursBeforeDeparture).length > 1 ? 'Used twice' : undefined,
    pct: !(t.refundPct >= 0 && t.refundPct <= 100) ? '0–100' : undefined,
  }));
  const sorted = [...tiers].sort((a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture);
  const inversion = sorted.find((t, i) => i > 0 && t.refundPct > sorted[i - 1].refundPct);
  const fee = Number(flatFeeMinor);
  const cutoff = Number(cutoffHours);
  const formError = tiers.length === 0 ? 'Add at least one tier'
    : tiers.length > 10 ? 'At most 10 tiers'
    : inversion ? `Cancelling earlier must never refund less — the ${inversion.minHoursBeforeDeparture}h tier gives more than an earlier one`
    : !(fee >= 0 && fee <= 10_000) ? 'The flat fee is ₹0 to ₹10,000'
    : !(Number.isInteger(cutoff) && cutoff >= 0 && cutoff <= 720) ? 'The cutoff is whole hours, 0–720'
    : undefined;
  const canSave = !formError && tierErrors.every((e) => !e.hours && !e.pct);
  const example = (h: number) => {
    if (h < cutoff) return 'not allowed';
    const tier = sorted.find((t) => h >= t.minHoursBeforeDeparture);
    return tier ? `${tier.refundPct}% back${fee ? ` minus ₹${fee}` : ''}` : 'no refund';
  };

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
                error={tierErrors[idx]?.hours}
                onChange={(e) => updateTier(idx, { minHoursBeforeDeparture: Number(e.target.value) })}
              />
              <Input
                label="Refund %"
                type="number"
                value={tier.refundPct}
                error={tierErrors[idx]?.pct}
                onChange={(e) => updateTier(idx, { refundPct: Number(e.target.value) })}
              />
              <Button variant="ghost" size="sm" disabled={tiers.length === 1} onClick={() => removeTier(idx)} leftIcon={<Trash2 className="h-4 w-4" />}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" disabled={tiers.length >= 10} onClick={addTier} leftIcon={<Plus className="h-4 w-4" />} className="self-start">Add tier</Button>

          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <Input label="Flat cancellation fee (₹, optional)" type="number" value={flatFeeMinor} onChange={(e) => setFlatFeeMinor(e.target.value)} hint="Deducted on top of the tier percentage, per ticket" />
            <Input label="Hard cutoff (hours, optional)" type="number" value={cutoffHours} onChange={(e) => setCutoffHours(e.target.value)} hint="Cancellation blocked entirely within this many hours of departure" />
          </div>

          <div className="rounded-md bg-surface-muted p-3 text-sm">
            <div className="mb-1 text-xs font-semibold text-text-muted">What a passenger gets back if they cancel…</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              {[72, 24, 12, 4, 1].map((h) => <div key={h}><span className="text-text-muted">{h}h before:</span> <b>{example(h)}</b></div>)}
            </div>
          </div>
          {formError && <p className="text-sm text-danger" role="alert">{formError}</p>}

          <div className="mt-2 flex gap-3">
            <Button loading={save.isPending} disabled={!canSave || save.isPending} onClick={() => save.mutate()}>Save policy</Button>
            {data.data?.isCustom && (
              <Button variant="outline" onClick={() => setConfirmReset(true)} leftIcon={<RotateCcw className="h-4 w-4" />}>
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

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Use the platform default policy?"
        footer={<><Button variant="ghost" onClick={() => setConfirmReset(false)} disabled={reset.isPending}>Keep mine</Button><Button loading={reset.isPending} onClick={() => reset.mutate()}>Use the default</Button></>}>
        <p className="text-sm text-text">Your own tiers are removed and the platform default applies to cancellations from now on.</p>
      </Modal>
    </>
  );
}
