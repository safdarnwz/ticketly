import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileUp, Send, Undo2 } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageLoader,
  Select,
  statusTone,
  usePaged,
  useToast,
} from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { fleetApi, type VehicleDetail, type VehicleDocument } from '@/lib/api/fleet';
import { masterDataApi } from '@/lib/api/masterData';
import { todayLocal } from '@/lib/utils';
import { SectionTabs } from '@/components/common/SectionTabs';
import { MaintenanceCard, PhotosCard } from './VehicleExtras';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const FUEL = ['diesel', 'cng', 'electric', 'petrol', 'hybrid', 'lng'];
const VERIFICATION_LABEL: Record<string, string> = {
  draft: 'not submitted',
  submitted: 'waiting for platform',
  under_review: 'being reviewed',
  approved: 'verified',
  rejected: 'rejected',
  suspended: 'suspended',
};
const DETAIL_KEY: Record<string, string> = {
  make: 'make',
  model: 'model',
  'manufacture year': 'manufactureYear',
  'chassis number': 'chassisNo',
  'engine number': 'engineNo',
  'fuel type': 'fuelType',
  'registered owner': 'registeredOwner',
};

/**
 * One bus: its RC details, the documents the platform must verify (upload,
 * expiry, status), and submitting it for verification — a bus runs trips
 * only once verified. The page says exactly what is still missing.
 */
export function VehicleDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => fleetApi.vehicle(id),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const [uploading, setUploading] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vehicle', id] });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  };
  const submit = useMutation({
    mutationFn: () => fleetApi.submitVehicle(id),
    onSuccess: () => {
      toast.success('Sent to the platform for verification');
      refresh();
    },
    onError: (e) => toast.error(errText(e, 'Could not submit')),
  });
  const withdraw = useMutation({
    mutationFn: () => fleetApi.withdrawVehicle(id),
    onSuccess: () => {
      toast.success('Pulled back to draft — make your changes and submit again');
      refresh();
    },
    onError: (e) => toast.error(errText(e, 'Could not withdraw')),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState
        title="Bus not found"
        action={
          <Link to="/fleet">
            <Button variant="outline">All buses</Button>
          </Link>
        }
      />
    ) : (
      <ErrorState error={q.error} onRetry={q.refetch} />
    );
  const d = q.data!;
  const v = d.vehicle;
  const vs = v.verificationStatus ?? 'draft';
  const editable = vs === 'draft' || vs === 'rejected';

  return (
    <>
      <PageHeader
        title={v.registrationNo}
        subtitle={[v.make, v.model, v.manufactureYear].filter(Boolean).join(' · ') || 'Bus details'}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={vs === 'approved' ? 'success' : vs === 'rejected' || vs === 'suspended' ? 'danger' : 'warning'}>
              {VERIFICATION_LABEL[vs] ?? vs}
            </Badge>
            {editable && (
              <Button
                leftIcon={<Send className="h-4 w-4" />}
                loading={submit.isPending}
                disabled={!d.canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
              >
                Submit for verification
              </Button>
            )}
            {vs === 'submitted' && (
              <Button
                variant="outline"
                leftIcon={<Undo2 className="h-4 w-4" />}
                loading={withdraw.isPending}
                onClick={() => withdraw.mutate()}
              >
                Withdraw
              </Button>
            )}
          </div>
        }
      />

      {vs === 'rejected' && v.verificationReason && (
        <p role="alert" className="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          Rejected by the platform: {v.verificationReason}
        </p>
      )}
      {editable && (d.approvalBlockers.length > 0 || d.missingDetails.length > 0) ? (
        <Card className="mb-4 border-warning/40">
          <CardBody className="flex gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <div>
              <div className="font-semibold text-text">Before you can submit</div>
              <ul className="mt-1 list-disc pl-5 text-text-muted">
                {d.missingDetails.length > 0 && <li>Fill in: {d.missingDetails.join(', ')}</li>}
                {d.approvalBlockers.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      ) : vs === 'approved' ? (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />
          Verified — this bus can run trips
          {d.compliance.expiringSoon.length
            ? `. Expiring soon: ${d.compliance.expiringSoon.map((t) => d.docLabels[t] ?? t).join(', ')}`
            : ''}
          .
        </p>
      ) : null}

      <SectionTabs
        sections={[
          {
            key: 'details',
            label: 'Bus details',
            render: () => <DetailsCard detail={d} editable={editable} onSaved={refresh} />,
          },
          {
            key: 'documents',
            label: 'Documents',
            render: () => <DocumentsCard detail={d} canUpload={editable || vs === 'approved'} onUpload={setUploading} />,
          },
          {
            key: 'maintenance',
            label: 'Maintenance',
            render: () => <MaintenanceCard vehicleId={id} retired={v.status === 'retired'} />,
          },
          { key: 'photos', label: 'Photos', render: () => <PhotosCard vehicleId={id} retired={v.status === 'retired'} /> },
        ]}
      />

      {uploading && (
        <UploadModal
          vehicleId={id}
          docType={uploading}
          label={d.docLabels[uploading] ?? uploading}
          required={d.requiredDocTypes.includes(uploading)}
          registrationNo={v.registrationNo}
          onClose={() => setUploading(null)}
          onDone={() => {
            setUploading(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function DocumentsCard({
  detail: d,
  canUpload,
  onUpload,
}: {
  detail: VehicleDetail;
  canUpload: boolean;
  onUpload: (type: string) => void;
}) {
  const types = [...d.requiredDocTypes, ...Object.keys(d.docLabels).filter((t) => !d.requiredDocTypes.includes(t))];
  const { pageItems, pager } = usePaged(types);
  return (
    <Card>
      <CardHeader title="Documents" subtitle="PDF, JPG or PNG up to 5 MB. The platform checks each one." />
      <CardBody className="flex flex-col gap-2">
        {pageItems.map((type) => (
          <DocRow
            key={type}
            type={type}
            label={d.docLabels[type] ?? type}
            required={d.requiredDocTypes.includes(type)}
            doc={d.documents.find((x) => x.docType === type)}
            expired={d.compliance.expired.includes(type)}
            canUpload={canUpload}
            onUpload={() => onUpload(type)}
          />
        ))}
        {pager}
      </CardBody>
    </Card>
  );
}

function DocRow({
  type,
  label,
  required,
  doc,
  expired,
  canUpload,
  onUpload,
}: {
  type: string;
  label: string;
  required: boolean;
  doc?: VehicleDocument;
  expired: boolean;
  canUpload: boolean;
  onUpload: () => void;
}) {
  const tone = !doc
    ? required
      ? 'warning'
      : 'neutral'
    : expired
      ? 'danger'
      : statusTone(doc.status === 'verified' ? 'confirmed' : doc.status === 'rejected' ? 'rejected' : 'pending');
  const label2 = !doc
    ? required
      ? 'missing'
      : 'optional'
    : expired
      ? 'expired'
      : doc.status === 'verified'
        ? 'verified'
        : doc.status === 'rejected'
          ? 'rejected'
          : 'awaiting review';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
      data-doc={type}
    >
      <div className="min-w-0">
        <div className="font-medium text-text">
          {label}
          {required && <span className="text-danger"> *</span>}
        </div>
        {doc && (
          <div className="text-xs text-text-muted">
            {doc.documentNo ?? 'No number'} · valid till {doc.expiresOn ?? '—'}
            {doc.fileName ? ` · ${doc.fileName}` : ''}
          </div>
        )}
        {doc?.status === 'rejected' && doc.rejectionReason && <div className="text-xs text-danger">{doc.rejectionReason}</div>}
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{label2}</Badge>
        {canUpload && (
          <Button size="sm" variant="outline" leftIcon={<FileUp className="h-4 w-4" />} onClick={onUpload}>
            {doc ? 'Replace' : 'Upload'}
          </Button>
        )}
      </div>
    </div>
  );
}

function DetailsCard({ detail, editable, onSaved }: { detail: VehicleDetail; editable: boolean; onSaved: () => void }) {
  const toast = useToast();
  const v = detail.vehicle;
  const layouts = useQuery({ queryKey: ['seat-layouts'], queryFn: () => masterDataApi.listSeatLayouts() });
  const initial = {
    seatLayoutId: v.seatLayoutId ?? '',
    make: v.make ?? '',
    model: v.model ?? '',
    manufactureYear: v.manufactureYear ? String(v.manufactureYear) : '',
    chassisNo: v.chassisNo ?? '',
    engineNo: v.engineNo ?? '',
    fuelType: v.fuelType ?? '',
    registeredOwner: v.registeredOwner ?? '',
  };
  const [f, setF] = useState(initial);
  useEffect(() => {
    setF(initial);
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when the bus reloads
  const [tried, setTried] = useState(false);
  const year = Number(f.manufactureYear);
  const thisYear = Number(todayLocal().slice(0, 4));
  const errors: Record<string, string> = {};
  if (f.manufactureYear && (!Number.isInteger(year) || year < 1980 || year > thisYear))
    errors.manufactureYear = `A year from 1980 to ${thisYear}`;
  if (f.chassisNo && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(f.chassisNo.trim()))
    errors.chassisNo = 'A chassis (VIN) number has 17 letters and digits (no I, O or Q)';
  if (f.engineNo && f.engineNo.trim().length < 5) errors.engineNo = 'Enter the full engine number';
  const missing = new Set(detail.missingDetails.map((m) => DETAIL_KEY[m] ?? m));
  const save = useMutation({
    mutationFn: () =>
      fleetApi.updateVehicle(v.id, {
        seatLayoutId: f.seatLayoutId || undefined,
        make: f.make.trim() || undefined,
        model: f.model.trim() || undefined,
        manufactureYear: f.manufactureYear ? year : undefined,
        chassisNo: f.chassisNo.trim().toUpperCase() || undefined,
        engineNo: f.engineNo.trim().toUpperCase() || undefined,
        fuelType: f.fuelType || undefined,
        registeredOwner: f.registeredOwner.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Bus details saved');
      setTried(false);
      onSaved();
    },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  const field = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <Input
      label={`${label}${missing.has(k) ? ' *' : ''}`}
      value={f[k]}
      disabled={!editable}
      onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
      error={tried ? errors[k] : undefined}
      {...extra}
    />
  );
  return (
    <Card>
      <CardHeader
        title="Bus details"
        subtitle={editable ? 'As printed on the RC' : 'Locked while the platform reviews or after verification'}
      />
      <CardBody className="flex flex-col gap-3">
        <Select
          label="Seat layout"
          value={f.seatLayoutId}
          onChange={(e) => setF((x) => ({ ...x, seatLayoutId: e.target.value }))}
          error={!f.seatLayoutId ? 'Needed before this bus can run a trip' : undefined}
          options={[
            { value: '', label: 'Choose…' },
            ...(layouts.data?.items ?? []).map((l) => ({
              value: l.id,
              label: `${l.name}${l.totalSeats ? ` · ${l.totalSeats} seats` : ''}`,
            })),
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          {field('make', 'Make')}
          {field('model', 'Model')}
          {field('manufactureYear', 'Year', { inputMode: 'numeric', maxLength: 4 })}
          <Select
            label={`Fuel${missing.has('fuelType') ? ' *' : ''}`}
            value={f.fuelType}
            disabled={!editable}
            onChange={(e) => setF((x) => ({ ...x, fuelType: e.target.value }))}
            options={[
              { value: '', label: 'Choose…' },
              ...FUEL.map((x) => ({
                value: x,
                label: x.toUpperCase() === 'CNG' || x === 'lng' ? x.toUpperCase() : x[0]!.toUpperCase() + x.slice(1),
              })),
            ]}
          />
        </div>
        {field('chassisNo', 'Chassis number', { maxLength: 17 })}
        {field('engineNo', 'Engine number', { maxLength: 30 })}
        {field('registeredOwner', 'Registered owner', { maxLength: 120 })}
        {(editable || f.seatLayoutId !== (v.seatLayoutId ?? '')) && (
          <Button
            className="self-end"
            loading={save.isPending}
            disabled={save.isPending}
            onClick={() => {
              setTried(true);
              if (!Object.keys(errors).length) save.mutate();
            }}
          >
            Save details
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function UploadModal({
  vehicleId,
  docType,
  label,
  required,
  registrationNo,
  onClose,
  onDone,
}: {
  vehicleId: string;
  docType: string;
  label: string;
  required: boolean;
  registrationNo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  // The RC's number is the bus's registration number.
  const [documentNo, setDocumentNo] = useState(docType === 'rc' ? registrationNo : '');
  const [serverError, setServerError] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [tried, setTried] = useState(false);
  const today = todayLocal();
  const errors: Record<string, string> = {};
  if (!file) errors.file = 'Choose the scanned document';
  else if (!FILE_TYPES.includes(file.type)) errors.file = 'Only PDF, JPG or PNG';
  else if (file.size > MAX_FILE) errors.file = 'The file is over 5 MB';
  if (required && !documentNo.trim()) errors.documentNo = 'Enter the number printed on the document';
  else if (docType === 'rc' && documentNo.replace(/[\s-]/g, '').toUpperCase() !== registrationNo)
    errors.documentNo = `The RC number must be this bus's registration (${registrationNo})`;
  if (!expiresOn) errors.expiresOn = 'Enter the expiry date';
  else if (expiresOn < today) errors.expiresOn = 'This document has already expired';
  if (validFrom && expiresOn && validFrom >= expiresOn) errors.validFrom = 'Must be before the expiry date';
  if (validFrom && validFrom > today) errors.validFrom = 'Cannot start in the future';
  const upload = useMutation({
    mutationFn: async () => {
      const { fileId } = await fleetApi.uploadDocumentFile(vehicleId, docType, file!);
      return fleetApi.addDocument(vehicleId, {
        docType,
        documentNo: documentNo.trim() || undefined,
        validFrom: validFrom || undefined,
        expiresOn,
        fileId,
        fileName: file!.name,
      });
    },
    onSuccess: () => {
      toast.success(`${label} uploaded — the platform will review it`);
      onDone();
    },
    onError: (e) => {
      const m = errText(e, 'Upload failed');
      setServerError(m);
      toast.error(m);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Upload ${label}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={upload.isPending}>
            Close
          </Button>
          <Button
            loading={upload.isPending}
            disabled={upload.isPending}
            onClick={() => {
              setTried(true);
              setServerError('');
              if (!Object.keys(errors).length) upload.mutate();
            }}
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {serverError && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-danger">
            {serverError}
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-text">File</span>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            aria-label="Document file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {tried && errors.file && (
            <span role="alert" className="text-xs text-danger">
              {errors.file}
            </span>
          )}
        </label>
        <Input
          label={`Document number${required ? ' *' : ''}`}
          value={documentNo}
          maxLength={60}
          onChange={(e) => {
            setDocumentNo(e.target.value.toUpperCase());
            setServerError('');
          }}
          error={tried ? errors.documentNo : undefined}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Valid from"
            type="date"
            value={validFrom}
            max={today}
            onChange={(e) => setValidFrom(e.target.value)}
            error={tried ? errors.validFrom : undefined}
          />
          <Input
            label="Expires on"
            type="date"
            value={expiresOn}
            min={today}
            onChange={(e) => setExpiresOn(e.target.value)}
            error={tried ? errors.expiresOn : undefined}
          />
        </div>
      </div>
    </Modal>
  );
}
