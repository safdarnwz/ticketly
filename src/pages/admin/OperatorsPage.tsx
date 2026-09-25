import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, X, Copy, ExternalLink } from 'lucide-react';

import { Button, Card, CardBody, Badge, statusTone, Select, Table, type Column, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { onboardingApi } from '@/lib/api/onboarding';
import { kycApi } from '@/lib/api/kyc';

interface Row { id: string; status: string; firstName: string; lastName: string; email: string; companyName: string; city?: string; state?: string; createdAt?: string; consoleUrl?: string }

/** Fetched per-row (react-query caches by applicationId, so re-renders don't re-fetch) — a reviewer deciding whether to approve should see this without leaving the list. */
function KycStatusCell({ applicationId }: { applicationId: string }) {
  const kyc = useQuery({ queryKey: ['kyc-status', applicationId], queryFn: () => kycApi.status(applicationId), staleTime: 30_000 });
  if (kyc.isLoading) return <span className="text-xs text-text-muted">…</span>;
  if (kyc.isError || !kyc.data) return <span className="text-xs text-text-muted">—</span>;

  const latestFor = (type: string) => kyc.data.find((v) => v.documentType === type);
  const badge = (type: string, label: string) => {
    const v = latestFor(type);
    if (!v) return <Badge key={type} tone="neutral">{label}: not started</Badge>;
    const tone = v.status === 'verified' ? 'success' : v.status === 'failed' ? 'danger' : 'warning';
    return <Badge key={type} tone={tone}>{label}: {v.status}</Badge>;
  };
  return (
    <div className="flex flex-wrap gap-1">
      {badge('pan', 'PAN')}
      {badge('aadhaar', 'Aadhaar')}
      {badge('bank_account', 'Bank')}
    </div>
  );
}

export function OperatorsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // The operator's own login URL, surfaced right after approval — this is the
  // ONLY host that operator's staff can sign in on, so it needs to be handed
  // to them (or copied into your own notes) immediately.
  const [justApproved, setJustApproved] = useState<{ companyName: string; consoleUrl: string } | null>(null);

  const list = useQuery({ queryKey: ['operator-apps', status], queryFn: () => onboardingApi.list(status || undefined) });

  const approve = useMutation({
    mutationFn: (id: string) => onboardingApi.approve(id),
    onSuccess: (res, id) => {
      const row = (list.data?.applications as Row[] | undefined)?.find((r) => r.id === id);
      setJustApproved({ companyName: row?.companyName ?? 'Operator', consoleUrl: res.consoleUrl });
      toast.success(`Approved — console: ${res.consoleUrl}`);
      void qc.invalidateQueries({ queryKey: ['operator-apps'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Approve failed'),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => onboardingApi.reject(id, reason),
    onSuccess: () => { toast.success('Application rejected'); setRejecting(null); setReason(''); void qc.invalidateQueries({ queryKey: ['operator-apps'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Reject failed'),
  });

  const columns: Column<Row>[] = [
    { key: 'company', header: 'Company', render: (r) => <span className="font-medium text-text">{r.companyName}</span> },
    { key: 'applicant', header: 'Applicant', render: (r) => <span>{r.firstName} {r.lastName}<div className="text-xs text-text-muted">{r.email}</div></span> },
    { key: 'location', header: 'Location', render: (r) => <span className="text-text-muted">{[r.city, r.state].filter(Boolean).join(', ') || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'kyc', header: 'KYC', render: (r) => <KycStatusCell applicationId={r.id} /> },
    {
      key: 'console', header: 'Console', render: (r) => r.consoleUrl ? (
        <a href={r.consoleUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary underline">{r.consoleUrl}</a>
      ) : <span className="text-text-muted">—</span>,
    },
    {
      key: 'actions', header: '', render: (r) => r.status === 'pending' ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setRejecting(r.id)} leftIcon={<X className="h-4 w-4" />}>Reject</Button>
          <Button size="sm" onClick={() => approve.mutate(r.id)} loading={approve.isPending} leftIcon={<Check className="h-4 w-4" />}>Approve</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Operator applications" subtitle="Review 'Become an Operator' submissions — approve or reject" />

      {justApproved && (
        <Card className="mb-4 border-success/30 bg-success/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text">{justApproved.companyName} is live</div>
              <div className="text-sm text-text-muted">
                Their staff can sign in ONLY at{' '}
                <span className="font-mono text-text">{justApproved.consoleUrl}</span> — no other URL will work for them.
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" leftIcon={<Copy className="h-4 w-4" />}
                onClick={() => { void navigator.clipboard.writeText(justApproved.consoleUrl); toast.success('Console URL copied'); }}>
                Copy link
              </Button>
              <Button size="sm" variant="ghost" leftIcon={<ExternalLink className="h-4 w-4" />}
                onClick={() => window.open(justApproved.consoleUrl, '_blank')}>
                Open
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setJustApproved(null)}>Dismiss</Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="mb-4 max-w-xs">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' }, { label: 'Rejected', value: 'rejected' }, { label: 'All', value: '' }]} />
      </div>

      {list.isLoading ? <PageLoader /> : list.isError ? <ErrorState error={list.error} onRetry={list.refetch} /> :
        ((list.data?.applications as Row[])?.length ? (
          <Table columns={columns} rows={list.data!.applications as Row[]} />
        ) : <EmptyState title="No applications" icon={<Building2 className="h-10 w-10" />} />)}

      {rejecting && (
        <Card className="mt-4 border-danger/30">
          <CardBody className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-text">Reject application</div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for rejection (emailed to the applicant)"
              className="rounded-input border border-border bg-surface px-3 py-2 text-sm focus-ring" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setRejecting(null); setReason(''); }}>Cancel</Button>
              <Button variant="danger" disabled={!reason.trim()} loading={reject.isPending} onClick={() => reject.mutate({ id: rejecting, reason })}>Confirm rejection</Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}
