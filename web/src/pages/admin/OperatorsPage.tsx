import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, X, Copy, ExternalLink, PauseCircle, RotateCcw, FileText } from 'lucide-react';

import { Button, Card, CardBody, Badge, statusTone, Select, Table, type Column, PageLoader, ErrorState, EmptyState, Modal, useToast } from '@/components/ui';
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
  const [acting, setActing] = useState<{ id: string; kind: 'reject' | 'hold' | 'reopen'; company: string } | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
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
  const columns: Column<Row>[] = [
    { key: 'company', header: 'Company', look: 'strong', render: (r) => <span className="font-medium text-text">{r.companyName}</span> },
    { key: 'applicant', header: 'Applicant', under: 'company', render: (r) => <span>{r.firstName} {r.lastName}<div className="text-xs text-text-muted">{r.email}</div></span> },
    { key: 'location', header: 'Location', look: 'muted', under: 'company', render: (r) => <span className="text-text-muted">{[r.city, r.state].filter(Boolean).join(', ') || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'kyc', header: 'KYC', under: 'status', render: (r) => <KycStatusCell applicationId={r.id} /> },
    {
      key: 'console', header: 'Console', optional: true, render: (r) => r.consoleUrl ? (
        <a href={r.consoleUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary">{r.consoleUrl}</a>
      ) : <span className="text-text-muted">—</span>,
    },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<FileText className="h-4 w-4" />} onClick={() => setViewing(r)}>Details</Button>
          {r.status === 'pending' && <>
            <Button size="sm" variant="ghost" leftIcon={<PauseCircle className="h-4 w-4" />} onClick={() => setActing({ id: r.id, kind: 'hold', company: r.companyName })}>Hold</Button>
            <Button size="sm" variant="outline" onClick={() => setActing({ id: r.id, kind: 'reject', company: r.companyName })} leftIcon={<X className="h-4 w-4" />}>Reject</Button>
            <Button size="sm" onClick={() => approve.mutate(r.id)} loading={approve.isPending && approve.variables === r.id} disabled={approve.isPending} leftIcon={<Check className="h-4 w-4" />}>Approve</Button>
          </>}
          {r.status === 'rejected' && <Button size="sm" variant="outline" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => setActing({ id: r.id, kind: 'reopen', company: r.companyName })}>Reopen</Button>}
        </div>
      ),
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

      {acting && <ReasonModal {...acting} onClose={() => setActing(null)} onDone={() => { setActing(null); void qc.invalidateQueries({ queryKey: ['operator-apps'] }); }} />}
      {viewing && <ApplicationModal row={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

const ACTIONS = {
  reject: { title: 'Reject application', button: 'Reject', ok: 'Application rejected — the applicant is emailed', placeholder: 'Why it is rejected (emailed to the applicant)' },
  hold: { title: 'Put on hold', button: 'Hold', ok: 'On hold — the applicant is emailed what is needed', placeholder: 'What is needed, e.g. a clear copy of the GST certificate' },
  reopen: { title: 'Reopen application', button: 'Reopen', ok: 'Back to pending', placeholder: 'Why it is reopened, e.g. the applicant sent the missing documents' },
} as const;

/** Reject, hold or reopen — each needs a reason the applicant (or the audit trail) sees. */
function ReasonModal({ id, kind, company, onClose, onDone }: { id: string; kind: keyof typeof ACTIONS; company: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const a = ACTIONS[kind];
  const err = reason.trim().length < 10 ? 'At least 10 characters' : undefined;
  const go = useMutation({
    mutationFn: () => (kind === 'reject' ? onboardingApi.reject(id, reason.trim()) : kind === 'hold' ? onboardingApi.hold(id, reason.trim()) : onboardingApi.reopen(id, reason.trim())),
    onSuccess: () => { toast.success(a.ok); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title={`${a.title} — ${company}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={go.isPending}>Cancel</Button><Button variant={kind === 'reject' ? 'danger' : 'primary'} loading={go.isPending} disabled={go.isPending} onClick={() => { setTried(true); if (!err) go.mutate(); }}>{a.button}</Button></>}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text">Reason</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} placeholder={a.placeholder} aria-invalid={tried && !!err}
          className="rounded-input border border-border bg-surface px-3 py-2 text-sm focus-ring" />
        {tried && err && <span role="alert" className="text-xs text-danger">{err}</span>}
      </label>
    </Modal>
  );
}

const FIELDS: [string, string][] = [
  ['company_name', 'Company'], ['company_type', 'Type'], ['gst_number', 'GSTIN'], ['pan_number', 'PAN'], ['registration_number', 'Registration no.'],
  ['official_email', 'Official email'], ['company_mobile', 'Company mobile'], ['website', 'Website'], ['address_line1', 'Address'], ['city', 'City'], ['state', 'State'], ['pin_code', 'PIN'],
  ['bank_account_holder', 'Account holder'], ['bank_name', 'Bank'], ['bank_ifsc', 'IFSC'],
];

/** The whole application: company, bank, business, what blocks approval, and the uploaded documents. */
function ApplicationModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['operator-app', row.id], queryFn: () => onboardingApi.get(row.id) });
  const [opening, setOpening] = useState<string | null>(null);
  const a = q.data as Record<string, unknown> | undefined;
  const docs = Object.keys((a?.documents as Record<string, string> | undefined) ?? {});
  const blockers = (a?.approvalBlockers as string[] | undefined) ?? [];
  const business = (a?.business as Record<string, unknown> | undefined) ?? {};
  const open = async (docType: string) => {
    const win = window.open('', '_blank');
    setOpening(docType);
    try {
      const r = await onboardingApi.documentUrl(row.id, docType);
      if (!r.url) throw new Error('This file cannot be opened from here');
      if (win) win.location.href = r.url; else window.open(r.url, '_blank');
    } catch (e) { win?.close(); toast.error(e instanceof Error ? e.message : 'Could not open the document'); } finally { setOpening(null); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={row.companyName} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : a && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="text-text-muted">{String(a.first_name ?? '')} {String(a.last_name ?? '')} · {String(a.email ?? '')} · {String(a.mobile ?? '')} <Badge tone={statusTone(String(a.status))}>{String(a.status)}</Badge></div>
          {blockers.length > 0 && <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-warning">Before approving: {blockers.join(' · ')}</p>}
          {Boolean(a.rejection_reason || a.review_note) && <p className="text-text-muted">Last note: {String(a.review_note ?? a.rejection_reason)}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {FIELDS.filter(([k]) => a[k]).map(([k, label]) => <div key={k} className="flex justify-between gap-2 border-b border-border py-1"><dt className="text-text-muted">{label}</dt><dd className="text-right">{String(a[k])}</dd></div>)}
            {Object.entries(business).map(([k, v]) => <div key={k} className="flex justify-between gap-2 border-b border-border py-1"><dt className="text-text-muted">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd className="text-right">{Array.isArray(v) ? v.join(', ') : String(v)}</dd></div>)}
          </dl>
          <div>
            <div className="mb-1 font-medium text-text">Documents</div>
            {docs.length === 0 ? <p className="text-text-muted">No documents uploaded.</p> : (
              <div className="flex flex-wrap gap-2">{docs.map((d) => <Button key={d} size="sm" variant="outline" leftIcon={<ExternalLink className="h-3.5 w-3.5" />} loading={opening === d} disabled={opening !== null} onClick={() => void open(d)}>{d.replace(/_/g, ' ')}</Button>)}</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
