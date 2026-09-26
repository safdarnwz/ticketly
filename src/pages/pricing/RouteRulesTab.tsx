import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';

import { Button, Card, CardBody, ErrorState, Input, PageLoader, Select, useToast } from '@/components/ui';
import { parseCsv } from '@/lib/csv';
import { masterDataApi } from '@/lib/api/masterData';
import { fareRulesApi, type PeakWindow } from '@/lib/api/pricingAdmin';
import { formatMoney } from '@/lib/utils';

const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHm = (v: string) => { const [h, m] = v.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const rupees = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));
type Row = { start: string; end: string; pct: string; label: string };

/** Per route: the lowest and highest a seat may sell for, and dearer / cheaper departure times. */
export function RouteRulesTab() {
  const routes = useQuery({ queryKey: ['routes'], queryFn: () => masterDataApi.listRoutes() });
  const [routeId, setRouteId] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <div className="w-80"><Select label="Route" value={routeId} onChange={(e) => setRouteId(e.target.value)} options={[{ label: 'Choose a route…', value: '' }, ...(routes.data?.items ?? []).map((r) => ({ label: r.name, value: r.id }))]} /></div>
      {routeId && <RouteRulesEditor key={routeId} routeId={routeId} />}
    </div>
  );
}

function RouteRulesEditor({ routeId }: { routeId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['route-rules', routeId], queryFn: () => fareRulesApi.routeRules(routeId) });
  const [floor, setFloor] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!q.data) return;
    setFloor(q.data.floorMinor != null ? String(q.data.floorMinor / 100) : '');
    setCeiling(q.data.ceilingMinor != null ? String(q.data.ceilingMinor / 100) : '');
    setRows(q.data.peakWindows.map((w) => ({ start: toHm(w.startMinute), end: toHm(w.endMinute), pct: String(w.pct), label: w.label ?? '' })));
  }, [q.data]);
  const e: Record<string, string> = {};
  if (floor && !(Number(floor) >= 0)) e.floor = 'An amount in ₹';
  if (ceiling && !(Number(ceiling) > 0)) e.ceiling = 'An amount in ₹';
  if (floor && ceiling && Number(floor) > Number(ceiling)) e.ceiling = 'Above the floor';
  rows.forEach((r, i) => {
    if (!r.start || !r.end || r.start === r.end) e[`w${i}`] = 'Start and end must differ';
    else if (!(Number(r.pct) >= -50 && Number(r.pct) <= 100) || Number(r.pct) === 0 || r.pct === '') e[`w${i}`] = '−50 to +100 %, not 0';
  });
  const save = useMutation({
    mutationFn: () => fareRulesApi.saveRouteRules(routeId, {
      floorMinor: rupees(floor), ceilingMinor: rupees(ceiling),
      peakWindows: rows.map((r): PeakWindow => ({ startMinute: fromHm(r.start), endMinute: fromHm(r.end), pct: Number(r.pct), label: r.label.trim() || undefined })),
    }),
    onSuccess: () => { toast.success('Route fare rules saved — new quotes use them'); void qc.invalidateQueries({ queryKey: ['route-rules', routeId] }); },
    onError: (x) => toast.error(x instanceof Error ? x.message : 'Failed'),
  });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <Card><CardBody className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-2 gap-3 md:w-2/3">
        <Input label="Lowest fare per seat (₹, before GST)" type="number" value={floor} error={e.floor} hint="Yield and discounts never go below" onChange={(x) => setFloor(x.target.value)} />
        <Input label="Highest fare per seat (₹)" type="number" value={ceiling} error={e.ceiling} hint="Surges never go above" onChange={(x) => setCeiling(x.target.value)} />
      </div>
      <div>
        <div className="mb-2 font-semibold">Departure-time changes</div>
        {rows.length === 0 && <p className="text-text-muted">None — every departure time costs the same.</p>}
        {rows.map((r, i) => (
          <div key={i} className="mb-2 flex flex-wrap items-end gap-2">
            <Input label={i === 0 ? 'From' : undefined} aria-label={`Window ${i + 1} from`} type="time" value={r.start} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, start: x.target.value } : y)))} />
            <Input label={i === 0 ? 'To' : undefined} aria-label={`Window ${i + 1} to`} type="time" value={r.end} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, end: x.target.value } : y)))} />
            <Input label={i === 0 ? 'Change %' : undefined} aria-label={`Window ${i + 1} percent`} type="number" value={r.pct} error={e[`w${i}`]} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, pct: x.target.value } : y)))} />
            <Input label={i === 0 ? 'Name' : undefined} aria-label={`Window ${i + 1} name`} placeholder="Evening peak" value={r.label} maxLength={40} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, label: x.target.value } : y)))} />
            <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        {rows.length < 12 && <Button size="sm" variant="outline" onClick={() => setRows([...rows, { start: '18:00', end: '22:00', pct: '10', label: '' }])}>Add a time window</Button>}
        <p className="mt-1 text-xs text-text-muted">Minus makes off-peak cheaper. A window can cross midnight (22:00 → 06:00). If windows overlap, the bigger change wins.</p>
      </div>
      {(floor || ceiling) && <p className="text-xs text-text-muted">Fares stay between {floor ? formatMoney(Math.round(Number(floor) * 100)) : 'any'} and {ceiling ? formatMoney(Math.round(Number(ceiling) * 100)) : 'any'} per seat.</p>}
      <div className="flex justify-end"><Button loading={save.isPending} disabled={save.isPending || Object.keys(e).length > 0} onClick={() => save.mutate()}>Save route rules</Button></div>
    </CardBody></Card>
  );
}

/** Whole fare sheet of a plan: download, edit in Excel, upload; or change every fare by a percentage. */
export function FareBulkTools({ planId, onChanged }: { planId: string; onChanged: () => void }) {
  const toast = useToast();
  const [pct, setPct] = useState('');
  const [seatType, setSeatType] = useState('');
  const [fileErr, setFileErr] = useState('');
  const exp = useMutation({ mutationFn: () => fareRulesApi.exportCsv(planId), onError: (x) => toast.error(x instanceof Error ? x.message : 'Failed') });
  const imp = useMutation({
    mutationFn: (rows: Parameters<typeof fareRulesApi.importRows>[1]) => fareRulesApi.importRows(planId, rows),
    onSuccess: (r) => { toast.success(`${r.saved} fare(s) saved`); onChanged(); },
    onError: (x) => toast.error(x instanceof Error ? x.message : 'Upload failed — nothing was saved'),
  });
  const adj = useMutation({
    mutationFn: () => fareRulesApi.adjustAll(planId, Number(pct), seatType || undefined),
    onSuccess: (r) => { toast.success(`${r.updated} fare(s) changed by ${pct}%`); setPct(''); onChanged(); },
    onError: (x) => toast.error(x instanceof Error ? x.message : 'Failed'),
  });
  const pick = async (file?: File) => {
    setFileErr('');
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (!rows.length) { setFileErr('The file has no fares'); return; }
    const bad = rows.findIndex((r) => !/^\d+$/.test(r.baseFareMinor ?? '') || Number(r.baseFareMinor) < 100);
    if (bad >= 0) { setFileErr(`Row ${bad + 2}: baseFareMinor must be a whole number of paise, at least 100`); return; }
    imp.mutate(rows.map((r) => ({ fromStopId: r.fromStopId || undefined, toStopId: r.toStopId || undefined, seatType: r.seatType || 'seater', baseFareMinor: Number(r.baseFareMinor), perKmMinor: r.perKmMinor ? Number(r.perKmMinor) : undefined })));
  };
  const pctBad = pct !== '' && !(Number(pct) >= -90 && Number(pct) <= 300 && Number(pct) !== 0);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <div className="font-semibold">Whole fare sheet</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" leftIcon={<Download className="h-3.5 w-3.5" />} loading={exp.isPending} onClick={() => exp.mutate()}>Download sheet</Button>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs"><Upload className="h-3.5 w-3.5" /> Upload edited sheet
          <input type="file" accept=".csv,text/csv" aria-label="Upload edited sheet" className="hidden" disabled={imp.isPending} onChange={(e) => void pick(e.target.files?.[0])} /></label>
        <span className="text-xs text-text-muted">Fares are in paise (₹500 = 50000). Every row is checked first; nothing is saved on an error.</span>
      </div>
      {fileErr && <p role="alert" className="text-xs text-danger">{fileErr}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Change every fare by %" type="number" value={pct} error={pctBad ? '−90 to +300, not 0' : undefined} onChange={(x) => setPct(x.target.value)} />
        <Select label="Seat type" value={seatType} onChange={(x) => setSeatType(x.target.value)} options={[{ label: 'All', value: '' }, { label: 'Seater', value: 'seater' }, { label: 'Sleeper', value: 'sleeper' }, { label: 'Semi-sleeper', value: 'semi_sleeper' }]} />
        <Button size="sm" loading={adj.isPending} disabled={!pct || pctBad || adj.isPending} onClick={() => { if (window.confirm(`Change every ${seatType || ''} fare of this plan by ${pct}%?`)) adj.mutate(); }}>Apply</Button>
      </div>
    </div>
  );
}
