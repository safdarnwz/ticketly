import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bus, CheckCircle2, ExternalLink, Search, XCircle } from 'lucide-react';

import { Badge, Button, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, statusTone, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi, type VehicleDocument, type VehicleQueueRow } from '@/lib/api/platformAdmin';
import { formatDateTime } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const FILTERS = [
  { value: 'submitted', label: 'Waiting for review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'draft', label: 'Draft (not submitted)' },
  { value: '', label: 'All' },
];

/**
 * Buses operators submit for approval: every compliance document is checked
 * (verified or rejected with a reason) before the bus can run; an approved
 * bus can be suspended later.
 */
export function VehicleApprovalsPage() {
  const [filter, setFilter] = useState('submitted');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<VehicleQueueRow | null>(null);
  const q = useQuery({ queryKey: ['admin-vehicles', filter, search], queryFn: () => platformAdminApi.vehicles(filter || undefined, search.trim() || undefined) });
  const columns: Column<VehicleQueueRow>[] = [
    { key: 'reg', header: 'Bus', look: 'key', render: (r) => <span><b className="font-mono">{r.registrationNo}</b> <span className="text-text-muted">{[r.make, r.model, r.manufactureYear].filter(Boolean).join(' ')}</span></span> },
    { key: 'op', header: 'Operator', under: 'reg', render: (r) => r.operatorName },
    { key: 'st', header: 'Review', render: (r) => <Badge tone={statusTone(r.verificationStatus)}>{r.verificationStatus}</Badge> },
    { key: 'docs', header: 'Documents to check', render: (r) => (r.pendingDocuments ? <Badge tone="warning">{r.pendingDocuments}</Badge> : <span className="text-text-muted">—</span>) },
    { key: 'at', header: 'Submitted', look: 'muted', under: 'st', render: (r) => (r.submittedAt ? formatDateTime(r.submittedAt) : '—') },
    { key: 'a', header: '', render: (r) => <Button size="sm" variant="outline" onClick={() => setOpen(r)}>Review</Button> },
  ];
  return (
    <>
      <PageHeader title="Bus approvals" subtitle="Check each bus's documents before it can carry passengers" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56"><Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value)} options={FILTERS} /></div>
        <div className="w-72"><Input label="Search" placeholder="Registration or operator" leftIcon={<Search className="h-4 w-4" />} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data!.items.length === 0 ? (
        <EmptyState title="Nothing here" description={filter === 'submitted' ? 'No bus is waiting for review.' : 'No bus matches.'} icon={<Bus className="h-10 w-10" />} />
      ) : <Table columns={columns} rows={q.data!.items} />}
      {open && <ReviewModal row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReviewModal({ row, onClose }: { row: VehicleQueueRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-vehicle', row.id], queryFn: () => platformAdminApi.vehicle(row.id) });
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<'reject' | 'suspend' | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin-vehicle', row.id] }); void qc.invalidateQueries({ queryKey: ['admin-vehicles'] }); };
  const decide = useMutation({
    mutationFn: (d: 'approve' | 'reject' | 'suspend') => (d === 'approve' ? platformAdminApi.approveVehicle(row.id) : d === 'reject' ? platformAdminApi.rejectVehicle(row.id, reason.trim()) : platformAdminApi.suspendVehicle(row.id, reason.trim())),
    onSuccess: (_, d) => { toast.success(d === 'approve' ? `${row.registrationNo} approved — it can run trips` : d === 'reject' ? `${row.registrationNo} rejected — the operator is told why` : `${row.registrationNo} suspended — removed from future trips`); refresh(); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not save the decision')),
  });
  const v = q.data;
  const status = v?.vehicle.verificationStatus;
  const reasonErr = reason.trim().length < 10 ? 'Say why (at least 10 characters)' : undefined;
  return (
    <Modal open onClose={onClose} size="lg" title={`${row.registrationNo} · ${row.operatorName}`}
      footer={decision ? (
        <><Button variant="ghost" onClick={() => setDecision(null)} disabled={decide.isPending}>Back</Button>
          <Button variant="danger" loading={decide.isPending} disabled={decide.isPending || !!reasonErr} onClick={() => decide.mutate(decision)}>{decision === 'reject' ? 'Reject bus' : 'Suspend bus'}</Button></>
      ) : (
        <><Button variant="ghost" onClick={onClose}>Close</Button>
          {status === 'approved' && <Button variant="outline" className="text-danger" onClick={() => setDecision('suspend')}>Suspend</Button>}
          {status === 'submitted' && <Button variant="outline" className="text-danger" onClick={() => setDecision('reject')}>Reject</Button>}
          {status === 'submitted' && <Button loading={decide.isPending} disabled={decide.isPending || (v?.approvalBlockers.length ?? 1) > 0} title={v?.approvalBlockers.join('; ')} onClick={() => decide.mutate('approve')}>Approve</Button>}</>
      )}>
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : v && (decision ? (
        <Input label={decision === 'reject' ? 'Why is the bus rejected? (the operator sees this)' : 'Why is the bus suspended?'} value={reason} error={reason ? reasonErr : undefined} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-2"><Badge tone={statusTone(v.vehicle.verificationStatus)}>{v.vehicle.verificationStatus}</Badge>{v.vehicle.verificationReason && <span className="text-text-muted">{v.vehicle.verificationReason}</span>}</div>
          {v.approvalBlockers.length > 0 && <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-warning">{v.approvalBlockers.join(' · ')}</p>}
          <div className="flex flex-col divide-y divide-border rounded-md border border-border">
            {v.documents.map((d) => <DocRow key={d.id} vehicleId={row.id} d={d} label={v.docLabels[d.docType] ?? d.docType} required={v.requiredDocTypes.includes(d.docType)} onChange={refresh} />)}
            {v.documents.length === 0 && <p className="p-3 text-text-muted">No documents uploaded.</p>}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function DocRow({ vehicleId, d, label, required, onChange }: { vehicleId: string; d: VehicleDocument; label: string; required: boolean; onChange: () => void }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [opening, setOpening] = useState(false);
  const act = useMutation({
    mutationFn: (ok: boolean) => (ok ? platformAdminApi.verifyDocument(vehicleId, d.id) : platformAdminApi.rejectDocument(vehicleId, d.id, reason.trim())),
    onSuccess: (_, ok) => { toast.success(`${label} ${ok ? 'verified' : 'rejected'}`); setRejecting(false); onChange(); },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  const view = async () => {
    const win = window.open('', '_blank');
    setOpening(true);
    try {
      const blob = await platformAdminApi.documentFile(vehicleId, d.id);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else window.open(url, '_blank');
    } catch (e) { win?.close(); toast.error(errText(e, 'Could not open the file')); } finally { setOpening(false); }
  };
  const expired = d.expiresOn ? new Date(d.expiresOn).getTime() < Date.now() : false;
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <b>{label}</b>{required && <span className="text-text-muted"> · required</span>} <Badge tone={statusTone(d.status)}>{d.status}</Badge>
          <span className="block text-xs text-text-muted">{d.documentNo ?? 'no number'}{d.expiresOn ? ` · valid till ${d.expiresOn}` : ''}{expired ? ' · EXPIRED' : ''}{d.rejectionReason ? ` · ${d.rejectionReason}` : ''}</span>
        </span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" leftIcon={<ExternalLink className="h-3.5 w-3.5" />} loading={opening} disabled={!d.hasFile || opening} onClick={() => void view()}>View</Button>
          {d.status !== 'verified' && <Button size="sm" variant="outline" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={act.isPending && act.variables === true} disabled={act.isPending || expired || !d.hasFile} title={expired ? 'Expired — the operator must upload a new one' : undefined} onClick={() => act.mutate(true)}>Verify</Button>}
          {d.status !== 'rejected' && <Button size="sm" variant="ghost" className="text-danger" leftIcon={<XCircle className="h-3.5 w-3.5" />} disabled={act.isPending} onClick={() => setRejecting((x) => !x)}>Reject</Button>}
        </span>
      </div>
      {rejecting && (
        <div className="flex items-start gap-2">
          <div className="flex-1"><Input aria-label={`Why is the ${label} rejected`} placeholder="e.g. Photo is blurred — upload a clear copy" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></div>
          <Button size="sm" variant="danger" loading={act.isPending && act.variables === false} disabled={act.isPending || reason.trim().length < 10} title={reason.trim().length < 10 ? 'At least 10 characters' : undefined} onClick={() => act.mutate(false)}>Reject</Button>
        </div>
      )}
    </div>
  );
}
