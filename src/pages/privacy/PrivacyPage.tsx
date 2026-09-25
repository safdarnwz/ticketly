import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2 } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { privacyApi } from '@/lib/api/platform';

const PURPOSES: { key: string; label: string; necessary?: boolean }[] = [
  { key: 'transactional', label: 'Transactional (necessary)', necessary: true },
  { key: 'marketing', label: 'Marketing communications' },
  { key: 'personalization', label: 'Personalization' },
  { key: 'analytics', label: 'Product analytics' },
  { key: 'third_party_share', label: 'Third-party sharing' },
];

export function PrivacyPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const consents = useQuery({ queryKey: ['consents'], queryFn: () => privacyApi.myConsents() });

  const setConsent = useMutation({
    mutationFn: ({ purpose, granted }: { purpose: string; granted: boolean }) => privacyApi.setConsent(purpose, granted),
    onSuccess: () => { toast.success('Preference updated'); void qc.invalidateQueries({ queryKey: ['consents'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Update failed'),
  });
  const erasure = useMutation({
    mutationFn: () => privacyApi.requestErasure(),
    onSuccess: (r) => toast.success(`Erasure requested (${r.requestId.slice(0, 8)}…)`),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Request failed'),
  });

  return (
    <>
      <PageHeader title="Privacy (DPDP)" subtitle="Manage consent and your right to be forgotten" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Consent</span>} />
          <CardBody>
            {consents.isLoading ? <PageLoader /> : consents.isError ? <ErrorState error={consents.error} onRetry={consents.refetch} /> : (
              <div className="flex flex-col divide-y divide-border">
                {PURPOSES.map((p) => {
                  const granted = p.necessary || consents.data?.consents?.[p.key] === true;
                  return (
                    <div key={p.key} className="flex items-center justify-between py-3">
                      <span className="text-sm text-text">{p.label}</span>
                      <button
                        disabled={p.necessary || setConsent.isPending}
                        onClick={() => setConsent.mutate({ purpose: p.key, granted: !granted })}
                        className={`relative h-6 w-11 rounded-pill transition ${granted ? 'bg-primary' : 'bg-surface-muted'} ${p.necessary ? 'opacity-60' : ''}`}
                      >
                        <span className={`absolute top-0.5 h-5 w-5 rounded-pill bg-white shadow transition-all ${granted ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Trash2 className="h-4 w-4" /> Right to be forgotten</span>} />
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Request erasure of your personal data. We anonymise your PII while retaining
              financial records (invoices, ledger) as required by law.
            </p>
            <Button variant="danger" onClick={() => erasure.mutate()} loading={erasure.isPending}>Request data erasure</Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
