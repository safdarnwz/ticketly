import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Bus, Users, LayoutGrid, ListChecks, Upload, CalendarClock } from 'lucide-react';

import { Button, Card, CardBody, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast, TabBar } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { masterDataApi, type VehicleType, type Amenity, type SeatLayoutRow } from '@/lib/api/masterData';
import { fleetApi, type Vehicle } from '@/lib/api/fleet';
import { SeatLayoutsTab } from './SeatLayoutsTab';
import { CrewTab } from './CrewTab';
import { RenewalsTab } from './RenewalsTab';
import { isRegistration, normReg } from '@/lib/vehicle';
import { useTabParam } from '@/lib/useTabParam';
import { parseCsv } from '@/lib/csv';

type Tab = 'vehicles' | 'layouts' | 'setup' | 'crew' | 'renewals';

export function FleetPage() {
  const [tab, setTab] = useTabParam<Tab>(['vehicles', 'layouts', 'setup', 'crew', 'renewals'], 'vehicles');
  const tabs: { key: Tab; label: string; icon: typeof Bus }[] = [
    { key: 'vehicles', label: 'Vehicles', icon: Bus },
    { key: 'layouts', label: 'Seat Layouts', icon: LayoutGrid },
    { key: 'setup', label: 'Vehicle Types & Amenities', icon: ListChecks },
    { key: 'crew', label: 'Crew & Duties', icon: Users },
    { key: 'renewals', label: 'Renewals', icon: CalendarClock },
  ];

  return (
    <>
      <PageHeader title="Fleet" subtitle="Buses, seat layouts, vehicle classes, and crew" />
      <TabBar className="mb-6" value={tab} onChange={setTab} items={tabs} />
      {tab === 'vehicles' && <VehiclesTab />}
      {tab === 'layouts' && <SeatLayoutsTab />}
      {tab === 'setup' && <SetupTab />}
      {tab === 'crew' && <CrewTab />}
      {tab === 'renewals' && <RenewalsTab />}
    </>
  );
}

// ── Vehicles ──────────────────────────────────────────────────────────────
function VehiclesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('registrationNo,vehicleTypeId,make,model\n');
  const [importResult, setImportResult] = useState<{ imported: number; failed: { row: number; error: string }[] } | null>(null);
  const [editingNote, setEditingNote] = useState<Vehicle | null>(null);
  const [noteForm, setNoteForm] = useState({ photoUrl: '', serviceNote: '' });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [form, setForm] = useState({ registrationNo: '', vehicleTypeId: '', seatLayoutId: '', make: '', model: '' });

  const vehicles = useQuery({ queryKey: ['vehicles', search, statusFilter, page], queryFn: () => fleetApi.listVehicles({ search: search || undefined, status: statusFilter || undefined, page, pageSize }) });
  const types = useQuery({ queryKey: ['vehicle-types'], queryFn: () => masterDataApi.listVehicleTypes() });
  const layouts = useQuery({ queryKey: ['seat-layouts'], queryFn: () => masterDataApi.listSeatLayouts() });

  const create = useMutation({
    mutationFn: () => fleetApi.createVehicle({
      registrationNo: normReg(form.registrationNo),
      vehicleTypeId: form.vehicleTypeId,
      seatLayoutId: form.seatLayoutId || undefined,
      make: form.make.trim() || undefined,
      model: form.model.trim() || undefined,
    }),
    onSuccess: () => { toast.success('Vehicle added'); setAdding(false); setTriedVehicle(false); setForm({ registrationNo: '', vehicleTypeId: '', seatLayoutId: '', make: '', model: '' }); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add vehicle'),
  });
  const [triedVehicle, setTriedVehicle] = useState(false);
  const vehicleErrors = {
    reg: !form.registrationNo.trim() ? 'Enter the registration number' : isRegistration(normReg(form.registrationNo)) ? '' : 'Enter a registration number like RJ14PA1234',
    type: form.vehicleTypeId ? '' : 'Choose the vehicle type',
  };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'maintenance' | 'retired' }) => fleetApi.setVehicleStatus(id, status),
    onSuccess: () => { toast.success('Status updated'); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const setPermitType = useMutation({
    mutationFn: ({ id, permitType }: { id: string; permitType: 'aitp' | 'stage_carriage' | 'state_tourist_permit' | 'contract_carriage' }) => fleetApi.setVehiclePermitType(id, permitType),
    onSuccess: () => { toast.success('Permit type updated'); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const saveNote = useMutation({
    mutationFn: () => fleetApi.setVehiclePhotoNote(editingNote!.id, noteForm),
    onSuccess: () => { toast.success('Saved'); setEditingNote(null); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const bulkImport = useMutation({
    mutationFn: () => fleetApi.bulkImportVehicles(parseCsv(importText) as never),
    onSuccess: (res) => { setImportResult(res); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const columns: Column<Vehicle>[] = [
    {
      key: 'reg', header: 'Registration', look: 'key', render: (r) => (
        <div className="flex items-center gap-2">
          {r.photoUrl && <img src={r.photoUrl} alt="" className="h-8 w-8 rounded object-cover" />}
          <Link to={`/fleet/vehicles/${r.id}`} className="font-mono text-sm font-medium text-primary hover:underline">{r.registrationNo}</Link>
        </div>
      ),
    },
    { key: 'model', header: 'Make/Model', under: 'reg', render: (r) => <span className="text-text-muted">{[r.make, r.model].filter(Boolean).join(' ') || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'verification', header: 'Platform check', under: 'status', render: (r) => <Badge tone={r.verificationStatus === 'approved' ? 'success' : r.verificationStatus === 'rejected' ? 'danger' : 'warning'}>{r.verificationStatus === 'approved' ? 'verified' : r.verificationStatus === 'draft' ? 'not submitted' : r.verificationStatus ?? '—'}</Badge> },
    {
      key: 'permitType', header: 'Permit type', look: 'muted',
      render: (r) => (
        <Select value={r.permitType ?? ''} onChange={(e) => setPermitType.mutate({ id: r.id, permitType: e.target.value as 'aitp' | 'stage_carriage' | 'state_tourist_permit' | 'contract_carriage' })}
          options={[
            { label: 'Not recorded', value: '' },
            { label: 'All India Tourist Permit (AITP)', value: 'aitp' },
            { label: 'Stage Carriage', value: 'stage_carriage' },
            { label: 'State/Regional Tourist Permit', value: 'state_tourist_permit' },
            { label: 'Contract Carriage (not eligible for seat-sale)', value: 'contract_carriage' },
          ]} />
      ),
    },
    { key: 'note', header: 'Service note', look: 'note', optional: true, render: (r) => <span className="text-xs text-text-muted">{r.serviceNote ?? '—'}</span> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-1 whitespace-nowrap">
          {r.status !== 'active' && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: 'active' })}>Activate</Button>}
          {r.status !== 'maintenance' && <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: r.id, status: 'maintenance' })}>Maintenance</Button>}
          {r.status !== 'retired' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setStatus.mutate({ id: r.id, status: 'retired' })}>Retire</Button>}
          <Button size="sm" variant="ghost" onClick={() => { setEditingNote(r); setNoteForm({ photoUrl: r.photoUrl ?? '', serviceNote: r.serviceNote ?? '' }); }}>Photo/note</Button>
        </div>
      ),
    },
  ];

  const total = vehicles.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <Input label="Search reg/make/model" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="RJ14…" />
          <Select label="Status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            options={[{ label: 'All', value: '' }, { label: 'Active', value: 'active' }, { label: 'Maintenance', value: 'maintenance' }, { label: 'Retired', value: 'retired' }]} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" leftIcon={<Upload className="h-4 w-4" />} onClick={() => { setImporting(true); setImportResult(null); }}>Bulk import</Button>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add vehicle</Button>
        </div>
      </div>

      {vehicles.isLoading ? <PageLoader /> : vehicles.isError ? <ErrorState error={vehicles.error} onRetry={vehicles.refetch} /> :
        (vehicles.data?.items.length ? (
          <Table columns={columns} rows={vehicles.data.items}
            server={{ page, total, hasNext: page < totalPages, loading: vehicles.isFetching, onPage: setPage }} />
        ) : <EmptyState title="No vehicles yet" icon={<Bus className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a vehicle"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={create.isPending} onClick={() => { setTriedVehicle(true); if (!vehicleErrors.reg && !vehicleErrors.type) create.mutate(); }}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Input label="Registration number" placeholder="RJ14PA1234" value={form.registrationNo} onChange={(e) => setForm((f) => ({ ...f, registrationNo: e.target.value.toUpperCase() }))} error={triedVehicle ? vehicleErrors.reg : undefined} /></div>
          <Select label="Vehicle type" error={triedVehicle ? vehicleErrors.type : undefined} value={form.vehicleTypeId} onChange={(e) => setForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
            options={[{ label: 'Select…', value: '' }, ...(types.data?.items.map((t: VehicleType) => ({ label: t.name, value: t.id })) ?? [])]} />
          <Select label="Seat layout" value={form.seatLayoutId} onChange={(e) => setForm((f) => ({ ...f, seatLayoutId: e.target.value }))}
            options={[{ label: 'None', value: '' }, ...(layouts.data?.items.map((l: SeatLayoutRow) => ({ label: l.name, value: l.id })) ?? [])]} />
          <Input label="Make" value={form.make} onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))} />
          <Input label="Model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
        </div>
      </Modal>

      <Modal open={!!editingNote} onClose={() => setEditingNote(null)} title={`Photo & service note — ${editingNote?.registrationNo ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setEditingNote(null)}>Cancel</Button><Button loading={saveNote.isPending} onClick={() => saveNote.mutate()}>Save</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="Photo URL" value={noteForm.photoUrl} onChange={(e) => setNoteForm((f) => ({ ...f, photoUrl: e.target.value }))} placeholder="https://…" />
          <Input label="Service history note" value={noteForm.serviceNote} onChange={(e) => setNoteForm((f) => ({ ...f, serviceNote: e.target.value }))} placeholder="Brake pads replaced 12 Jan" />
        </div>
      </Modal>

      <Modal open={importing} onClose={() => setImporting(false)} title="Bulk import vehicles" size="lg"
        footer={<><Button variant="ghost" onClick={() => setImporting(false)}>Close</Button><Button loading={bulkImport.isPending} onClick={() => bulkImport.mutate()}>Import</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">CSV — first row is the header. vehicleTypeId must be a valid type ID (see Setup tab). Each row imports independently.</p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10}
            className="w-full rounded-md border border-border bg-surface-muted p-3 font-mono text-xs text-text" spellCheck={false} />
          {importResult && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-success">{importResult.imported} imported</p>
              {importResult.failed.length > 0 && (
                <div className="mt-2 text-xs text-danger">{importResult.failed.map((f) => <div key={f.row}>Row {f.row}: {f.error}</div>)}</div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

// ── Seat Layouts (grid builder) ────────────────────────────────────────────
// ── Vehicle Types & Amenities ───────────────────────────────────────────────
function SetupTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useQuery({ queryKey: ['vehicle-types'], queryFn: () => masterDataApi.listVehicleTypes() });
  const amenities = useQuery({ queryKey: ['amenities'], queryFn: () => masterDataApi.listAmenities() });
  const layouts = useQuery({ queryKey: ['seat-layouts'], queryFn: () => masterDataApi.listSeatLayouts() });

  const [typeForm, setTypeForm] = useState({ name: '', code: '', isAc: true, seatLayoutId: '', amenityIds: [] as string[] });
  const [amenityForm, setAmenityForm] = useState({ name: '', code: '' });

  const createType = useMutation({
    mutationFn: () => masterDataApi.createVehicleType({ ...typeForm, seatLayoutId: typeForm.seatLayoutId || undefined }),
    onSuccess: () => { toast.success('Vehicle type created'); setTypeForm({ name: '', code: '', isAc: true, seatLayoutId: '', amenityIds: [] }); void qc.invalidateQueries({ queryKey: ['vehicle-types'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const createAmenity = useMutation({
    mutationFn: () => masterDataApi.createAmenity(amenityForm),
    onSuccess: () => { toast.success('Amenity created'); setAmenityForm({ name: '', code: '' }); void qc.invalidateQueries({ queryKey: ['amenities'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="font-semibold text-text">Vehicle types</div>
          {(types.data?.items ?? []).map((t: VehicleType) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <span>{t.name}</span><Badge tone={t.isAc ? 'success' : 'neutral'}>{t.isAc ? 'AC' : 'Non-AC'}</Badge>
            </div>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <Input label="Name" placeholder="AC Sleeper 2+1" value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} />
            <Input label="Code" placeholder="AC_SLP_2_1" value={typeForm.code} onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value }))} />
            <Select label="Seat layout" value={typeForm.seatLayoutId} onChange={(e) => setTypeForm((f) => ({ ...f, seatLayoutId: e.target.value }))}
              options={[{ label: 'None', value: '' }, ...(layouts.data?.items.map((l: SeatLayoutRow) => ({ label: l.name, value: l.id })) ?? [])]} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={typeForm.isAc} onChange={(e) => setTypeForm((f) => ({ ...f, isAc: e.target.checked }))} /> AC</label>
            {(amenities.data?.items ?? []).length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-muted">Amenities on this vehicle type — shown to customers on search results</span>
                <div className="flex flex-wrap gap-3">
                  {(amenities.data?.items ?? []).map((a: Amenity) => (
                    <label key={a.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={typeForm.amenityIds.includes(a.id)}
                        onChange={(e) => setTypeForm((f) => ({
                          ...f, amenityIds: e.target.checked ? [...f.amenityIds, a.id] : f.amenityIds.filter((id) => id !== a.id),
                        }))} />
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <Button size="sm" loading={createType.isPending} disabled={!typeForm.name || !typeForm.code} onClick={() => createType.mutate()}>Create type</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="font-semibold text-text">Amenities</div>
          <div className="flex flex-wrap gap-2">
            {(amenities.data?.items ?? []).map((a: Amenity) => <Badge key={a.id}>{a.name}</Badge>)}
          </div>
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <Input label="Name" placeholder="Charging Point" value={amenityForm.name} onChange={(e) => setAmenityForm((f) => ({ ...f, name: e.target.value }))} />
            <Input label="Code" placeholder="charging_point" value={amenityForm.code} onChange={(e) => setAmenityForm((f) => ({ ...f, code: e.target.value }))} />
            <Button size="sm" loading={createAmenity.isPending} disabled={!amenityForm.name || !amenityForm.code} onClick={() => createAmenity.mutate()}>Create amenity</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
