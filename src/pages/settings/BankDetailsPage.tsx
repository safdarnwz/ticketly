import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, ShieldCheck, Clock } from 'lucide-react';

import { Button, Card, CardBody, Input, PageLoader, ErrorState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { bankDetailsApi } from '@/lib/api/payouts';

export function BankDetailsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const details = useQuery({ queryKey: ['bank-details'], queryFn: bankDetailsApi.get });
  const [form, setForm] = useState({ accountHolder: '', accountNumber: '', ifsc: '', bankName: '' });

  const save = useMutation({
    mutationFn: () => bankDetailsApi.set(form),
    onSuccess: () => {
      toast.success('Submitted for review — your CURRENT account keeps receiving payouts until the platform approves this change');
      setForm({ accountHolder: '', accountNumber: '', ifsc: '', bankName: '' });
      void qc.invalidateQueries({ queryKey: ['bank-details'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not submit — check the IFSC format'),
  });

  if (details.isLoading) return <PageLoader />;
  if (details.isError) return <ErrorState error={details.error} onRetry={details.refetch} />;

  const canSave = form.accountHolder.trim() && form.accountNumber.trim() && form.ifsc.trim().length === 11;
  const pending = details.data?.pendingRequest;

  return (
    <>
      <PageHeader title="Bank Details" subtitle="Where your scheduled payouts (Mon-Wed → Thursday, Thu-Sun → Monday) are sent" />

      {details.data?.onFile && (
        <Card className="mb-4">
          <CardBody className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-success" />
            <div>
              <div className="text-sm font-semibold text-text">{details.data.accountHolder} — {details.data.accountNumberMasked}</div>
              <div className="text-xs text-text-muted">{details.data.bankName ? `${details.data.bankName} · ` : ''}IFSC {details.data.ifsc} — active, receiving payouts</div>
            </div>
          </CardBody>
        </Card>
      )}

      {pending && (
        <Card className="mb-6 border-warning/40">
          <CardBody className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-warning" />
            <div>
              <div className="text-sm font-semibold text-text">Under review: {pending.accountHolder} — {pending.accountNumberMasked}</div>
              <div className="text-xs text-text-muted">Submitted {new Date(pending.submittedAt).toLocaleDateString()} — your CURRENT account above still receives payouts until the platform approves this.</div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-text"><Landmark className="h-4 w-4" /> {details.data?.onFile ? 'Request a change' : 'Add your bank account'}</div>
          <Input label="Account holder name" value={form.accountHolder} onChange={(e) => setForm((f) => ({ ...f, accountHolder: e.target.value }))} placeholder="As per bank records" />
          <Input label="Account number" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))} />
          <Input label="IFSC code" value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} placeholder="HDFC0001234" maxLength={11} />
          <Input label="Bank name (optional)" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
          <Button className="mt-1 self-start" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>{details.data?.onFile ? 'Submit for review' : 'Save'}</Button>
          <p className="text-xs text-text-muted">
            {details.data?.onFile
              ? "For security, a change to your payout account needs platform approval before it takes effect — your current account keeps working in the meantime."
              : 'Double-check these carefully before submitting.'}
          </p>
        </CardBody>
      </Card>
    </>
  );
}
