import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Bus, Users, LayoutGrid, Sparkles, FileWarning, Upload } from 'lucide-react';

import { Button, Card, CardBody, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { masterDataApi, type VehicleType, type Amenity, type SeatLayoutRow } from '@/lib/api/masterData';
import { fleetApi, type Vehicle, type Crew, type Duty } from '@/lib/api/fleet';
import { SeatLayoutsTab } from './SeatLayoutsTab';
import { cn } from '@/lib/utils';

type Tab = 'vehicles' | 'layouts' | 'setup' | 'crew';

export function FleetPage() {
  const [tab, setTab] = useState<Tab>('vehicles');
  const tabs: { key: Tab; label: string; icon: typeof Bus }[] = [
    { key: 'vehicles', label: 'Vehicles', icon: Bus },
    { key: 'layouts', label: 'Seat Layouts', icon: LayoutGrid },
    { key: 'setup', label: 'Vehicle Types & Amenities', icon: Sparkles },
    { key: 'crew', label: 'Crew & Duties', icon: Users },
  ];

  return (
    <>
      <PageHeader title="Fleet" subtitle="Buses, seat layouts, vehicle classes, and crew" />
      <div className="mb-6 flex gap-2 border-b border-border">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium', tab === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text')}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'vehicles' && <VehiclesTab />}
      {tab === 'layouts' && <SeatLayoutsTab />}
      {tab === 'setup' && <SetupTab />}
      {tab === 'crew' && <CrewTab />}
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
  const pageSize = 20;
  const [form, setForm] = useState({ registrationNo: '', vehicleTypeId: '', seatLayoutId: '', make: '', model: '' });

  const vehicles = useQuery({ queryKey: ['vehicles', search, statusFilter, page], queryFn: () => fleetApi.listVehicles({ search: search || undefined, status: statusFilter || undefined, page, pageSize }) });
  const types = useQuery({ queryKey: ['vehicle-types'], queryFn: () => masterDataApi.listVehicleTypes() });
  const layouts = useQuery({ queryKey: ['seat-layouts'], queryFn: () => masterDataApi.listSeatLayouts() });

  const create = useMutation({
    mutationFn: () => fleetApi.createVehicle({ ...form, seatLayoutId: form.seatLayoutId || undefined }),
    onSuccess: () => { toast.success('Vehicle added'); setAdding(false); setForm({ registrationNo: '', vehicleTypeId: '', seatLayoutId: '', make: '', model: '' }); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add vehicle'),
  });
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
    mutationFn: () => {
      const lines = importText.trim().split('\n').filter(Boolean);
      const [header, ...rows] = lines;
      const cols = header.split(',').map((c) => c.trim());
      const parsed = rows.map((line) => {
        const vals = line.split(',').map((v) => v.trim());
        const obj: Record<string, string> = {};
        cols.forEach((c, i) => { obj[c] = vals[i] ?? ''; });
        return obj as never;
      });
      return fleetApi.bulkImportVehicles(parsed);
    },
    onSuccess: (res) => { setImportResult(res); void qc.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const columns: Column<Vehicle>[] = [
    {
      key: 'reg', header: 'Registration', render: (r) => (
        <div className="flex items-center gap-2">
          {r.photoUrl && <img src={r.photoUrl} alt="" className="h-8 w-8 rounded object-cover" />}
          <span className="font-mono text-sm font-medium text-text">{r.registrationNo}</span>
        </div>
      ),
    },
    { key: 'model', header: 'Make/Model', render: (r) => <span className="text-text-muted">{[r.make, r.model].filter(Boolean).join(' ') || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'permitType', header: 'Permit type',
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
    { key: 'note', header: 'Service note', render: (r) => <span className="text-xs text-text-muted">{r.serviceNote ?? '—'}</span> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
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
        (vehicles.data?.items.length ? <Table columns={columns} rows={vehicles.data.items} /> : <EmptyState title="No vehicles yet" icon={<Bus className="h-10 w-10" />} />)}

      {total > pageSize && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-text-muted">Page {page} of {totalPages}</span>
          <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a vehicle"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.registrationNo || !form.vehicleTypeId} onClick={() => create.mutate()}>Add</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Input label="Registration number" placeholder="RJ14PA1234" value={form.registrationNo} onChange={(e) => setForm((f) => ({ ...f, registrationNo: e.target.value }))} /></div>
          <Select label="Vehicle type" value={form.vehicleTypeId} onChange={(e) => setForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
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

// ── Crew & Duties ────────────────────────────────────────────────────────
function CrewTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ role: 'driver', fullName: '', phone: '', licenceNo: '' });

  const crew = useQuery({ queryKey: ['crew'], queryFn: () => fleetApi.listCrew() });
  const duties = useQuery({ queryKey: ['duties'], queryFn: () => fleetApi.listDuties() });

  const create = useMutation({
    mutationFn: () => fleetApi.createCrew(form),
    onSuccess: () => { toast.success('Crew member added'); setAdding(false); setForm({ role: 'driver', fullName: '', phone: '', licenceNo: '' }); void qc.invalidateQueries({ queryKey: ['crew'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const crewColumns: Column<Crew>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-text">{r.fullName}</span> },
    { key: 'role', header: 'Role', render: (r) => <Badge>{r.role}</Badge> },
    { key: 'licence', header: 'Licence', render: (r) => <span className="text-text-muted">{r.licenceNo ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
  ];
  const dutyColumns: Column<Duty>[] = [
    { key: 'crew', header: 'Crew', render: (r) => <span className="font-medium text-text">{r.crewName}</span> },
    { key: 'starts', header: 'Starts', render: (r) => new Date(r.startsAt).toLocaleString() },
    { key: 'ends', header: 'Ends', render: (r) => new Date(r.endsAt).toLocaleString() },
    { key: 'driving', header: 'Driving (min)', render: (r) => r.drivingMinutes },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add crew</Button></div>

      <div className="mb-3 text-sm font-semibold text-text">Crew</div>
      {crew.isLoading ? <PageLoader /> : crew.isError ? <ErrorState error={crew.error} onRetry={crew.refetch} /> :
        (crew.data?.items.length ? <Table columns={crewColumns} rows={crew.data.items} /> : <EmptyState title="No crew yet" icon={<Users className="h-10 w-10" />} />)}

      <div className="mb-3 mt-8 text-sm font-semibold text-text">Upcoming duties</div>
      {duties.isLoading ? <PageLoader /> : duties.isError ? <ErrorState error={duties.error} onRetry={duties.refetch} /> :
        (duties.data?.duties.length ? <Table columns={dutyColumns} rows={duties.data.duties} /> : <EmptyState title="No duties assigned" icon={<FileWarning className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add crew member"
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button loading={create.isPending} disabled={!form.fullName} onClick={() => create.mutate()}>Add</Button></>}>
        <div className="flex flex-col gap-3">
          <Select label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            options={[{ label: 'Driver', value: 'driver' }, { label: 'Conductor', value: 'conductor' }, { label: 'Attendant', value: 'attendant' }]} />
          <Input label="Full name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <Input label="Licence no." value={form.licenceNo} onChange={(e) => setForm((f) => ({ ...f, licenceNo: e.target.value }))} />
        </div>
      </Modal>
    </>
  );
}
