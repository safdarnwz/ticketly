import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MapPin, Route as RouteIcon, Trash2, CheckCircle2, Archive, Copy, PauseCircle, PlayCircle, Upload, IndianRupee, Landmark } from 'lucide-react';

import { PointChargesModal } from './PointChargesModal';
import { StateRulesForCities, StateRulesModal } from './StateRulesPanel';

import { Button, Card, CardBody, Badge, statusTone, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast, TabBar } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { masterDataApi, type RouteRow, type City, type Stop } from '@/lib/api/masterData';
import { parseCsv } from '@/lib/csv';

interface StopDraft { stopId: string; stopName: string; sequence: number; distanceFromOriginM: number; departOffsetMin: number; cityId?: string }

export function RoutesPage() {
  const [view, setView] = useState<'routes' | 'stops'>('routes');
  return (
    <>
      <PageHeader title="Routes & Stops" subtitle="Your network — origins, destinations, and boarding/dropping points" />
      <TabBar className="mb-6" value={view} onChange={setView} items={[{ key: 'routes', label: 'Routes', icon: RouteIcon }, { key: 'stops', label: 'Stops', icon: MapPin }] as const} />
      {view === 'routes' ? <RoutesTab /> : <StopsTab />}
    </>
  );
}

function RoutesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [duplicating, setDuplicating] = useState<RouteRow | null>(null);
  const [charging, setCharging] = useState<RouteRow | null>(null);
  const [rulesFor, setRulesFor] = useState<RouteRow | null>(null);
  const [dupCode, setDupCode] = useState('');
  const [dupName, setDupName] = useState('');

  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });

  // ── route form state ──
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('06:00');
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [origin, setOrigin] = useState<City | null>(null);
  const [dest, setDest] = useState<City | null>(null);
  const [originResults, setOriginResults] = useState<City[]>([]);
  const [destResults, setDestResults] = useState<City[]>([]);
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [stopCityQuery, setStopCityQuery] = useState('');
  const [stopCity, setStopCity] = useState<City | null>(null);
  const [stopCityResults, setStopCityResults] = useState<City[]>([]);
  const [cityStops, setCityStops] = useState<Stop[]>([]);
  const [newStopName, setNewStopName] = useState('');

  const searchOrigin = async (q: string) => { setOriginQuery(q); setOrigin(null); if (q.length >= 2) setOriginResults((await masterDataApi.searchCities(q)).items); };
  const searchDest = async (q: string) => { setDestQuery(q); setDest(null); if (q.length >= 2) setDestResults((await masterDataApi.searchCities(q)).items); };
  const searchStopCity = async (q: string) => { setStopCityQuery(q); if (q.length >= 2) setStopCityResults((await masterDataApi.searchCities(q)).items); };

  const pickStopCity = async (c: City) => {
    setStopCity(c); setStopCityQuery(c.name); setStopCityResults([]);
    setCityStops((await masterDataApi.stopsForCity(c.id)).items);
  };

  const createStop = useMutation({
    mutationFn: () => masterDataApi.createStop({ cityId: stopCity!.id, name: newStopName, kind: 'both' }),
    onSuccess: async () => { toast.success('Stop created'); setNewStopName(''); setCityStops((await masterDataApi.stopsForCity(stopCity!.id)).items); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create stop'),
  });

  const addStopToRoute = (s: Stop) => {
    if (stops.some((x) => x.stopId === s.id)) return;
    const seq = stops.length;
    setStops((arr) => {
      const prev = arr[arr.length - 1];
      return [...arr, {
        stopId: s.id, stopName: s.name, sequence: seq, cityId: s.cityId ?? stopCity?.id,
        distanceFromOriginM: prev ? prev.distanceFromOriginM + 50_000 : 0,
        departOffsetMin: prev ? prev.departOffsetMin + 60 : 0,
      }];
    });
  };
  const removeStop = (stopId: string) => setStops((arr) => arr.filter((s) => s.stopId !== stopId).map((s, i) => ({ ...s, sequence: i })));
  const updateStop = (stopId: string, patch: Partial<StopDraft>) => setStops((arr) => arr.map((s) => (s.stopId === stopId ? { ...s, ...patch } : s)));

  const resetForm = () => {
    setCode(''); setName(''); setStartTime('06:00'); setOrigin(null); setDest(null); setOriginQuery(''); setDestQuery('');
    setStops([]); setStopCity(null); setStopCityQuery(''); setCityStops([]); setTried(false);
  };

  const createRoute = useMutation({
    mutationFn: () => masterDataApi.createRoute({
      code, name, originCityId: origin!.id, destCityId: dest!.id, startTime,
      stops: stops.map((s) => ({ stopId: s.stopId, sequence: s.sequence, distanceFromOriginM: s.distanceFromOriginM, departOffsetMin: s.departOffsetMin })),
    }),
    onSuccess: () => { toast.success('Route created (draft — publish to make it schedulable)'); setAdding(false); resetForm(); void qc.invalidateQueries({ queryKey: ['routes'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create route'),
  });

  const publish = useMutation({
    mutationFn: (id: string) => masterDataApi.publishRoute(id),
    onSuccess: () => { toast.success('Route published'); void qc.invalidateQueries({ queryKey: ['routes'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Publish failed'),
  });
  const archive = useMutation({
    mutationFn: (id: string) => masterDataApi.archiveRoute(id),
    onSuccess: () => { toast.success('Route archived'); void qc.invalidateQueries({ queryKey: ['routes'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Archive failed'),
  });
  const duplicate = useMutation({
    mutationFn: () => masterDataApi.duplicateRoute(duplicating!.id, dupCode, dupName),
    onSuccess: () => { toast.success('Route duplicated as a new draft'); setDuplicating(null); setDupCode(''); setDupName(''); void qc.invalidateQueries({ queryKey: ['routes'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not duplicate'),
  });

  const columns: Column<RouteRow>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', header: 'Route', render: (r) => <span className="font-medium text-text">{r.name}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          {r.status === 'draft' && <Button size="sm" variant="outline" leftIcon={<CheckCircle2 className="h-4 w-4" />} loading={publish.isPending && publish.variables === r.id} disabled={publish.isPending} onClick={() => publish.mutate(r.id)}>Publish</Button>}
          {r.status === 'published' && <Button size="sm" variant="ghost" leftIcon={<Archive className="h-4 w-4" />} loading={archive.isPending && archive.variables === r.id} disabled={archive.isPending} onClick={() => archive.mutate(r.id)}>Archive</Button>}
          {r.status !== 'archived' && <Button size="sm" variant="ghost" leftIcon={<IndianRupee className="h-4 w-4" />} onClick={() => setCharging(r)}>Point charges</Button>}
          <Button size="sm" variant="ghost" leftIcon={<Landmark className="h-4 w-4" />} onClick={() => setRulesFor(r)}>State rules</Button>
          <Button size="sm" variant="ghost" leftIcon={<Copy className="h-4 w-4" />} onClick={() => { setDuplicating(r); setDupCode(`${r.code}-COPY`); setDupName(`${r.name} (copy)`); }}>Duplicate</Button>
        </div>
      ),
    },
  ];

  const [tried, setTried] = useState(false);
  const formErrors: Record<string, string> = {};
  if (!/^[A-Za-z0-9-]{2,30}$/.test(code.trim())) formErrors.code = 'Use 2–30 letters, digits or dashes';
  if (name.trim().length < 3) formErrors.name = 'Give the route a name';
  if (!origin) formErrors.origin = originQuery ? 'Pick the city from the list' : 'Choose the origin city';
  if (!dest) formErrors.dest = destQuery ? 'Pick the city from the list' : 'Choose the destination city';
  if (origin && dest && origin.id === dest.id) formErrors.dest = 'Destination must differ from the origin';
  if (stops.length < 2) formErrors.stops = 'Add at least 2 stops — the first is where the bus starts, the last where it ends';
  stops.forEach((st, i) => {
    const prev = stops[i - 1];
    if (i === 0 && (st.distanceFromOriginM !== 0 || st.departOffsetMin !== 0)) formErrors[`stop${i}`] = 'The first stop is at 0 km, 0 min';
    else if (prev && st.distanceFromOriginM < prev.distanceFromOriginM) formErrors[`stop${i}`] = 'Distance cannot go down';
    else if (prev && st.departOffsetMin <= prev.departOffsetMin) formErrors[`stop${i}`] = 'Must leave later than the stop before';
  });
  const canCreate = Object.keys(formErrors).length === 0;
  const submitRoute = () => { setTried(true); if (canCreate) createRoute.mutate(); };

  return (
    <>
      <div className="mb-4 flex justify-end"><Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New route</Button></div>

      {routes.isLoading ? <PageLoader /> : routes.isError ? <ErrorState error={routes.error} onRetry={routes.refetch} /> :
        (routes.data?.items.length ? <Table columns={columns} rows={routes.data.items} /> : <EmptyState title="No routes yet" icon={<RouteIcon className="h-10 w-10" />} />)}

      <Modal open={adding} onClose={() => { setAdding(false); resetForm(); }} title="Create a route" size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setAdding(false); resetForm(); }}>Cancel</Button>
            <Button loading={createRoute.isPending} disabled={createRoute.isPending} onClick={submitRoute}>Create route (draft)</Button>
          </>
        )}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Route code" placeholder="DEL-JAI-01" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={tried ? formErrors.code : undefined} />
            <Input label="Departure time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <Input label="Route name" placeholder="Delhi – Jaipur Express" value={name} onChange={(e) => setName(e.target.value)} error={tried ? formErrors.name : undefined} />

          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Input label="Origin city" value={originQuery} onChange={(e) => void searchOrigin(e.target.value)} leftIcon={<MapPin className="h-4 w-4" />} error={tried ? formErrors.origin : undefined} />
              {originResults.length > 0 && !origin && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                  {originResults.map((c) => (
                    <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
                      onClick={() => { setOrigin(c); setOriginQuery(c.name); setOriginResults([]); }}>{c.name}{c.state ? `, ${c.state}` : ''}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <Input label="Destination city" value={destQuery} onChange={(e) => void searchDest(e.target.value)} leftIcon={<MapPin className="h-4 w-4" />} error={tried ? formErrors.dest : undefined} />
              {destResults.length > 0 && !dest && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                  {destResults.map((c) => (
                    <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
                      onClick={() => { setDest(c); setDestQuery(c.name); setDestResults([]); }}>{c.name}{c.state ? `, ${c.state}` : ''}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-semibold text-text">Stops (min. 2 — first is boarding, last is dropping)</div>
            {tried && formErrors.stops && <p role="alert" className="mb-2 text-xs text-danger">{formErrors.stops}</p>}
            {stops.length > 0 && (
              <div className="mb-3 flex flex-col gap-2">
                {stops.map((s, i) => (
                  <div key={s.stopId} className="rounded-md border border-border p-2">
                    <div className="flex items-end gap-2">
                      <span className="mb-2.5 w-6 text-center text-xs text-text-muted">{s.sequence + 1}</span>
                      <span className="mb-2.5 flex-1 text-sm font-medium text-text">{s.stopName}{i === 0 ? ' · start' : i === stops.length - 1 ? ' · end' : ''}</span>
                      <div className="w-28"><Input label="Km from start" inputMode="numeric" value={String(Math.round(s.distanceFromOriginM / 1000))} disabled={i === 0}
                        onChange={(e) => updateStop(s.stopId, { distanceFromOriginM: (Number(e.target.value.replace(/\D/g, '')) || 0) * 1000 })} /></div>
                      <div className="w-32"><Input label="Leaves after (min)" inputMode="numeric" value={String(s.departOffsetMin)} disabled={i === 0}
                        onChange={(e) => updateStop(s.stopId, { departOffsetMin: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></div>
                      <button type="button" aria-label={`Remove ${s.stopName}`} onClick={() => removeStop(s.stopId)} className="mb-2.5 text-danger"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    {tried && formErrors[`stop${i}`] && <p role="alert" className="mt-1 text-xs text-danger">{formErrors[`stop${i}`]}</p>}
                  </div>
                ))}
              </div>
            )}

            <div className="relative mb-2">
              <Input label="Find a city to add its stops" value={stopCityQuery} onChange={(e) => void searchStopCity(e.target.value)} leftIcon={<MapPin className="h-4 w-4" />} />
              {stopCityResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                  {stopCityResults.map((c) => (
                    <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted" onClick={() => void pickStopCity(c)}>{c.name}</button>
                  ))}
                </div>
              )}
            </div>

            {stopCity && (
              <Card className="mb-2">
                <CardBody className="flex flex-col gap-2">
                  <div className="text-xs font-semibold text-text-muted">Stops in {stopCity.name}</div>
                  <div className="flex flex-wrap gap-2">
                    {cityStops.map((s) => (
                      <button key={s.id} type="button" onClick={() => addStopToRoute(s)}
                        className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary">{s.name}</button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1"><Input label="New stop name" value={newStopName} onChange={(e) => setNewStopName(e.target.value)} placeholder="Kashmere Gate" /></div>
                    <Button size="sm" disabled={!newStopName.trim()} loading={createStop.isPending} onClick={() => createStop.mutate()}>Add stop</Button>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
          {/* From the cities, not chosen: every state the bus passes through brings its rules. */}
          <StateRulesForCities cityIds={[origin?.id ?? '', ...stops.map((st) => st.cityId ?? ''), dest?.id ?? '']} />
        </div>
      </Modal>

      <PointChargesModal route={charging} onClose={() => setCharging(null)} />
      <StateRulesModal route={rulesFor} onClose={() => setRulesFor(null)} />

      <Modal open={!!duplicating} onClose={() => setDuplicating(null)} title={`Duplicate — ${duplicating?.name ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setDuplicating(null)}>Cancel</Button><Button loading={duplicate.isPending} disabled={!dupCode || !dupName} onClick={() => duplicate.mutate()}>Duplicate as draft</Button></>}>
        <div className="flex flex-col gap-3">
          <Input label="New route code" value={dupCode} onChange={(e) => setDupCode(e.target.value)} />
          <Input label="New route name" value={dupName} onChange={(e) => setDupName(e.target.value)} />
          <p className="text-xs text-text-muted">Same stops, distances, and timing — starts as a draft so you can tweak it before publishing.</p>
        </div>
      </Modal>
    </>
  );
}

function StopsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Stop | null>(null);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('cityId,name,kind,landmark,address,pincode\n');
  const [importResult, setImportResult] = useState<{ imported: number; failed: { row: number; error: string }[] } | null>(null);
  const [form, setForm] = useState({ cityId: '', name: '', kind: 'both', landmark: '', address: '', pincode: '' });
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<City[]>([]);
  const [pickedCity, setPickedCity] = useState<City | null>(null);

  const stops = useQuery({ queryKey: ['all-stops'], queryFn: () => masterDataApi.listAllStops() });

  const searchCity = async (q: string) => { setCityQuery(q); if (q.length >= 2) setCityResults((await masterDataApi.searchCities(q)).items); };

  const create = useMutation({
    mutationFn: () => masterDataApi.createStop({ ...form, cityId: pickedCity!.id }),
    onSuccess: () => { toast.success('Stop created'); setAdding(false); setForm({ cityId: '', name: '', kind: 'both', landmark: '', address: '', pincode: '' }); setPickedCity(null); setCityQuery(''); void qc.invalidateQueries({ queryKey: ['all-stops'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const update = useMutation({
    mutationFn: () => masterDataApi.updateStop(editing!.id, form),
    onSuccess: () => { toast.success('Stop updated'); setEditing(null); void qc.invalidateQueries({ queryKey: ['all-stops'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const activate = useMutation({
    mutationFn: (id: string) => masterDataApi.activateStop(id),
    onSuccess: () => { toast.success('Stop activated'); void qc.invalidateQueries({ queryKey: ['all-stops'] }); },
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => masterDataApi.deactivateStop(id),
    onSuccess: () => { toast.success('Stop deactivated — hidden from customer search'); void qc.invalidateQueries({ queryKey: ['all-stops'] }); },
  });
  const bulkImport = useMutation({
    mutationFn: () => masterDataApi.bulkImportStops(parseCsv(importText) as never),
    onSuccess: (res) => { setImportResult(res); void qc.invalidateQueries({ queryKey: ['all-stops'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const openEdit = (s: Stop) => { setEditing(s); setForm({ cityId: s.cityId ?? '', name: s.name, kind: s.kind, landmark: s.landmark ?? '', address: s.address ?? '', pincode: s.pincode ?? '' }); };

  const columns: Column<Stop>[] = [
    { key: 'name', header: 'Stop', render: (s) => <button className="font-medium text-text decoration-dotted" onClick={() => openEdit(s)}>{s.name}</button> },
    { key: 'kind', header: 'Type', render: (s) => <Badge>{s.kind}</Badge> },
    { key: 'landmark', header: 'Landmark', render: (s) => s.landmark ?? '—' },
    { key: 'pincode', header: 'Pincode', render: (s) => s.pincode ?? '—' },
    { key: 'status', header: 'Status', render: (s) => <Badge tone={s.isActive === false ? 'neutral' : 'success'}>{s.isActive === false ? 'Inactive' : 'Active'}</Badge> },
    {
      key: 'actions', header: '', render: (s) => (
        <div className="flex justify-end gap-2">
          {s.isActive === false
            ? <Button size="sm" variant="outline" leftIcon={<PlayCircle className="h-4 w-4" />} loading={activate.isPending} onClick={() => activate.mutate(s.id)}>Activate</Button>
            : <Button size="sm" variant="ghost" leftIcon={<PauseCircle className="h-4 w-4" />} loading={deactivate.isPending} onClick={() => deactivate.mutate(s.id)}>Deactivate</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <Button variant="outline" leftIcon={<Upload className="h-4 w-4" />} onClick={() => { setImporting(true); setImportResult(null); }}>Bulk import</Button>
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>New stop</Button>
      </div>

      {stops.isLoading ? <PageLoader /> : stops.isError ? <ErrorState error={stops.error} onRetry={stops.refetch} /> :
        (stops.data?.items.length ? <Table columns={columns} rows={stops.data.items} /> : <EmptyState title="No stops yet" icon={<MapPin className="h-10 w-10" />} />)}

      <Modal open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? `Edit — ${editing.name}` : 'New stop'}
        footer={<><Button variant="ghost" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</Button><Button loading={create.isPending || update.isPending} disabled={editing ? !form.name : !form.name || !pickedCity} onClick={() => (editing ? update.mutate() : create.mutate())}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="flex flex-col gap-3">
          {!editing && (
            <div className="relative">
              <Input label="City" value={cityQuery} onChange={(e) => void searchCity(e.target.value)} placeholder="Search city…" />
              {cityResults.length > 0 && !pickedCity && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
                  {cityResults.map((c) => (
                    <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
                      onClick={() => { setPickedCity(c); setCityQuery(c.name); setCityResults([]); }}>{c.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Input label="Stop name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Kashmere Gate" />
          <Select label="Type" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            options={[{ label: 'Both', value: 'both' }, { label: 'Boarding only', value: 'boarding' }, { label: 'Dropping only', value: 'dropping' }]} />
          <Input label="Landmark" value={form.landmark} onChange={(e) => setForm((f) => ({ ...f, landmark: e.target.value }))} placeholder="Near Metro station" />
          <Input label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <Input label="Pincode" value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} />
        </div>
      </Modal>

      <Modal open={importing} onClose={() => setImporting(false)} title="Bulk import stops" size="lg"
        footer={<><Button variant="ghost" onClick={() => setImporting(false)}>Close</Button><Button loading={bulkImport.isPending} onClick={() => bulkImport.mutate()}>Import</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">CSV format — first row is the header. Each row imports independently; a bad row is skipped and reported, not the whole batch.</p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10}
            className="w-full rounded-md border border-border bg-surface-muted p-3 font-mono text-xs text-text" spellCheck={false} />
          {importResult && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-success">{importResult.imported} imported</p>
              {importResult.failed.length > 0 && (
                <div className="mt-2 text-xs text-danger">
                  {importResult.failed.map((f) => <div key={f.row}>Row {f.row}: {f.error}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
