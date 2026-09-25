import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldAlert, Gauge } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Badge, Input, statusTone, PageLoader, ErrorState, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { fraudApi, type RiskSignals, type RiskResult } from '@/lib/api/ops';

const DEFAULT_SIGNALS: RiskSignals = {
  accountAgeDays: 120, bookingsLast24h: 1, amountMinor: 50000, seatCount: 2,
  emailDisposable: false, paymentMethodNew: false, billingCountryMismatch: false, nightBooking: false,
};

export function FraudPage() {
  const [signals, setSignals] = useState<RiskSignals>(DEFAULT_SIGNALS);
  const [result, setResult] = useState<RiskResult | null>(null);

  const assess = useMutation({
    mutationFn: () => fraudApi.assess(signals),
    onSuccess: (r) => setResult(r),
  });

  const queue = useQuery({ queryKey: ['fraud', 'queue'], queryFn: () => fraudApi.reviewQueue() });

  const num = (k: keyof RiskSignals) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSignals((s) => ({ ...s, [k]: Number(e.target.value) }));
  const bool = (k: keyof RiskSignals) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSignals((s) => ({ ...s, [k]: e.target.checked }));

  return (
    <>
      <PageHeader title="Risk & Fraud" subtitle="Score a transaction and review flagged assessments" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Risk scorer</span>} />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Account age (days)" type="number" value={signals.accountAgeDays} onChange={num('accountAgeDays')} />
              <Input label="Bookings last 24h" type="number" value={signals.bookingsLast24h} onChange={num('bookingsLast24h')} />
              <Input label="Amount (minor)" type="number" value={signals.amountMinor} onChange={num('amountMinor')} />
              <Input label="Seat count" type="number" value={signals.seatCount} onChange={num('seatCount')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['emailDisposable', 'Disposable email'],
                ['paymentMethodNew', 'New payment method'],
                ['billingCountryMismatch', 'Billing mismatch'],
                ['nightBooking', 'Night booking'],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={signals[k] as boolean} onChange={bool(k)} className="h-4 w-4 accent-[var(--yb-color-primary)]" />
                  {label}
                </label>
              ))}
            </div>
            <Button onClick={() => assess.mutate()} loading={assess.isPending} leftIcon={<ShieldAlert className="h-4 w-4" />}>
              Assess risk
            </Button>

            {result && (
              <div className="rounded-md border border-border p-4">
                <div className="flex items-center justify-between">
                  <div className="text-3xl font-semibold text-text">{result.score}<span className="text-base text-text-muted">/100</span></div>
                  <div className="flex gap-2">
                    <Badge tone={statusTone(result.band)}>{result.band}</Badge>
                    <Badge tone={statusTone(result.decision)}>{result.decision}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.reasons.map((r) => (
                    <Badge key={r.code} tone="neutral">{r.code} +{r.points}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Review queue" subtitle="Assessments flagged review / deny" />
          <CardBody>
            {queue.isLoading ? <PageLoader /> : queue.isError ? <ErrorState error={queue.error} onRetry={queue.refetch} /> :
              queue.data?.assessments?.length ? (
                <div className="flex flex-col gap-2">
                  {queue.data.assessments.map((a) => (
                    <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-text">PNR {a.pnr}</span>
                          {a.contactPhone && <span className="ml-2 text-xs text-text-muted">{a.contactPhone}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={a.band === 'high' ? 'danger' : a.band === 'medium' ? 'warning' : 'neutral'}>{a.band} · {a.score}</Badge>
                          <Badge tone={statusTone(a.decision)}>{a.decision}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {a.reasons.map((r, i) => <code key={i} className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-text-muted">{r.code} (+{r.points})</code>)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="Queue is clear" description="No transactions need manual review." />}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
