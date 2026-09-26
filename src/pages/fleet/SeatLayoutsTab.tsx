import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Copy, Trash2, Wand2, Info, Code2, History, Eye, RotateCcw, Car } from 'lucide-react';

import { Button, Card, CardBody, Badge, Table, type Column, Modal, Input, Select, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { masterDataApi, type SeatLayoutRow, type SeatLayoutVersion } from '@/lib/api/masterData';
import { cn, formatDateTime } from '@/lib/utils';

type SeatType = '' | 'seater' | 'sleeper' | 'semi_sleeper' | 'crew';
type Position = '' | 'front' | 'aisle' | 'window';

interface CellState {
  type: SeatType;
  ladiesOnly?: boolean;
  /** Disability-friendly: kept for passengers who need it. */
  accessible?: boolean;
  bookable?: boolean;
  position?: Position;
  rowSpan?: number;
  colSpan?: number;
  label?: string;
}

const EMPTY_CELL: CellState = { type: '' };
const SEAT_COLOR: Record<SeatType, string> = {
  '': 'bg-surface-muted border-border text-text-muted',
  seater: 'bg-primary/15 border-primary text-primary',
  sleeper: 'bg-accent/15 border-accent text-accent',
  semi_sleeper: 'bg-warning/15 border-warning text-warning',
  crew: 'bg-text/15 border-text/40 text-text',
};

const TEMPLATES: { label: string; decks: 1 | 2; rows: number; columns: number; build: (row: number, col: number) => CellState }[] = [
  { label: '2+2 Seater (single deck)', decks: 1, rows: 10, columns: 5, build: (_r, c) => (c === 2 ? EMPTY_CELL : { type: 'seater', position: c === 0 || c === 4 ? 'window' : 'aisle' }) },
  { label: '2+1 Seater deluxe (single deck)', decks: 1, rows: 10, columns: 4, build: (_r, c) => (c === 2 ? EMPTY_CELL : { type: 'seater', position: c === 0 || c === 3 ? 'window' : 'aisle' }) },
  { label: '1+1 Luxury (single deck)', decks: 1, rows: 12, columns: 3, build: (_r, c) => (c === 1 ? EMPTY_CELL : { type: 'seater', position: 'window' }) },
  { label: '2+2 Sleeper (lower + upper deck)', decks: 2, rows: 7, columns: 5, build: (_r, c) => (c === 2 ? EMPTY_CELL : { type: 'sleeper', position: c === 0 || c === 4 ? 'window' : 'aisle' }) },
  { label: 'Blank grid', decks: 1, rows: 10, columns: 4, build: () => EMPTY_CELL },
];

const NUMBERING_SCHEMES: { label: string; describe: string }[] = [
  { label: 'Sequential', describe: '1, 2, 3, 4… straight through, deck by deck' },
  { label: 'By row (A1, A2…)', describe: 'Row letter + column number — A1, A2, B1, B2…' },
  { label: 'Deck-prefixed', describe: 'Lower deck: L1, L2… Upper deck: U1, U2…' },
];

const cellKey = (d: number, r: number, c: number) => `${d}:${r}:${c}`;

export function SeatLayoutsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id?: string; name: string; decks: 1 | 2; rows: number; columns: number; grid: Record<string, CellState> } | null>(null);
  const [deckIdx, setDeckIdx] = useState<0 | 1>(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [deletingLayout, setDeletingLayout] = useState<SeatLayoutRow | null>(null);
  const [viewingVersionsOf, setViewingVersionsOf] = useState<SeatLayoutRow | null>(null);
  const [previewing, setPreviewing] = useState<{ name: string; decks: number; rows: number; columns: number; grid: Record<string, CellState> } | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const layouts = useQuery({ queryKey: ['seat-layouts'], queryFn: () => masterDataApi.listSeatLayouts() });
  const usage = useQuery({
    queryKey: ['seat-layout-usage', deletingLayout?.id],
    queryFn: () => masterDataApi.seatLayoutUsage(deletingLayout!.id),
    enabled: !!deletingLayout,
  });
  const versions = useQuery({
    queryKey: ['seat-layout-versions', viewingVersionsOf?.id],
    queryFn: () => masterDataApi.listSeatLayoutVersions(viewingVersionsOf!.id),
    enabled: !!viewingVersionsOf,
  });

  const gridToGrid = (map: { decks: number; rows: number; columns: number; seats: Array<{ number: string; deck: number; row: number; column: number; rowSpan?: number; colSpan?: number; type: SeatType; ladiesOnly?: boolean; accessible?: boolean; bookable?: boolean; position?: Position }> }) => {
    const grid: Record<string, CellState> = {};
    for (const s of map.seats) grid[cellKey(s.deck, s.row, s.column)] = { type: s.type, ladiesOnly: s.ladiesOnly, accessible: s.accessible, bookable: s.bookable, position: s.position, rowSpan: s.rowSpan, colSpan: s.colSpan, label: s.number };
    return grid;
  };

  const openNew = (template: (typeof TEMPLATES)[number]) => {
    const grid: Record<string, CellState> = {};
    for (let d = 0; d < template.decks; d++) for (let r = 0; r < template.rows; r++) for (let c = 0; c < template.columns; c++) grid[cellKey(d, r, c)] = template.build(r, c);
    setEditing({ name: '', decks: template.decks, rows: template.rows, columns: template.columns, grid });
    setDeckIdx(0); setSelected(new Set()); setJsonMode(false);
  };

  const openDuplicate = async (row: SeatLayoutRow) => {
    const full = await masterDataApi.getSeatLayout(row.id);
    const map = full.seatMap as any;
    setEditing({ name: `Copy of ${row.name}`, decks: (map.decks as 1 | 2) ?? 1, rows: map.rows, columns: map.columns, grid: gridToGrid(map) });
    setDeckIdx(0); setSelected(new Set()); setJsonMode(false);
  };

  const openEdit = async (row: SeatLayoutRow) => {
    const full = await masterDataApi.getSeatLayout(row.id);
    const map = full.seatMap as any;
    setEditing({ id: row.id, name: row.name, decks: (map.decks as 1 | 2) ?? 1, rows: map.rows, columns: map.columns, grid: gridToGrid(map) });
    setDeckIdx(0); setSelected(new Set()); setJsonMode(false);
  };

  const openPreview = async (row: SeatLayoutRow) => {
    const full = await masterDataApi.getSeatLayout(row.id);
    const map = full.seatMap as any;
    setPreviewing({ name: row.name, decks: map.decks ?? 1, rows: map.rows, columns: map.columns, grid: gridToGrid(map) });
  };

  const toggleSelect = (key: string, additive: boolean) => {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (next.has(key) && additive) next.delete(key); else next.add(key);
      return next;
    });
  };

  const summary = useMemo(() => {
    if (!editing) return null;
    const cells = Object.values(editing.grid).filter((c) => c.type);
    return {
      total: cells.length,
      seater: cells.filter((c) => c.type === 'seater').length,
      sleeper: cells.filter((c) => c.type === 'sleeper').length,
      semi: cells.filter((c) => c.type === 'semi_sleeper').length,
      crew: cells.filter((c) => c.type === 'crew').length,
      ladies: cells.filter((c) => c.ladiesOnly).length,
      accessible: cells.filter((c) => c.accessible).length,
      unbookable: cells.filter((c) => c.bookable === false).length,
    };
  }, [editing]);

  const applyToSelection = (patch: Partial<CellState> | 'clear') => {
    if (!editing) return;
    setEditing((prev) => {
      if (!prev) return prev;
      const grid = { ...prev.grid };
      for (const key of selected) {
        if (patch === 'clear') grid[key] = { type: '' };
        else if (patch.type === 'crew') grid[key] = { ...grid[key], ...patch, bookable: false };
        else grid[key] = { ...grid[key], type: grid[key]?.type || 'seater', ...patch };
      }
      return { ...prev, grid };
    });
  };

  const applyNumberingScheme = (scheme: 'sequential' | 'row' | 'deck') => {
    if (!editing) return;
    setEditing((prev) => {
      if (!prev) return prev;
      const grid = { ...prev.grid };
      let n = 1;
      for (let d = 0; d < prev.decks; d++) {
        for (let r = 0; r < prev.rows; r++) {
          for (let c = 0; c < prev.columns; c++) {
            const key = cellKey(d, r, c);
            const cell = grid[key];
            if (!cell?.type || cell.type === 'crew') continue;
            let label: string;
            if (scheme === 'sequential') label = String(n);
            else if (scheme === 'row') label = `${String.fromCharCode(65 + r)}${c + 1}`;
            else label = `${d === 1 ? 'U' : 'L'}${n}`;
            grid[key] = { ...cell, label };
            n += 1;
          }
        }
      }
      return { ...prev, grid };
    });
    toast.success('Seats renumbered — remember to save');
  };

  const buildSeatMap = (state: { decks: number; rows: number; columns: number; grid: Record<string, CellState> }) => {
    const seats: Array<{ number: string; deck: number; row: number; column: number; rowSpan?: number; colSpan?: number; type: SeatType; ladiesOnly?: boolean; accessible?: boolean; bookable?: boolean; position?: Position }> = [];
    let n = 1;
    for (let d = 0; d < state.decks; d++) {
      for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.columns; c++) {
          const cell = state.grid[cellKey(d, r, c)];
          if (!cell?.type) continue;
          seats.push({
            number: cell.label?.trim() || `${d === 1 ? 'U' : ''}${n}`,
            deck: d, row: r, column: c,
            rowSpan: cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined,
            colSpan: cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined,
            type: cell.type, ladiesOnly: cell.ladiesOnly || undefined, accessible: cell.accessible || undefined,
            bookable: cell.type === 'crew' ? false : (cell.bookable === false ? false : undefined),
            position: cell.position || undefined,
          });
          n += 1;
        }
      }
    }
    return { decks: state.decks, rows: state.rows, columns: state.columns, seats };
  };

  const enterJsonMode = () => {
    if (!editing) return;
    setJsonText(JSON.stringify(buildSeatMap(editing), null, 2));
    setJsonError(null);
    setJsonMode(true);
  };
  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as { decks: number; rows: number; columns: number; seats: Array<{ number: string; deck: number; row: number; column: number; rowSpan?: number; colSpan?: number; type: SeatType; ladiesOnly?: boolean; accessible?: boolean; bookable?: boolean; position?: Position }> };
      if (!parsed.decks || !parsed.rows || !parsed.columns || !Array.isArray(parsed.seats)) throw new Error('Expected {decks, rows, columns, seats[]}');
      setEditing((prev) => (prev ? { ...prev, decks: parsed.decks as 1 | 2, rows: parsed.rows, columns: parsed.columns, grid: gridToGrid(parsed) } : prev));
      setJsonMode(false); setJsonError(null); setSelected(new Set());
      toast.success('JSON applied — review the grid, then save');
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const body = { name: editing!.name, layout: buildSeatMap(editing!) };
      if (editing!.id) await masterDataApi.updateSeatLayout(editing!.id, body);
      else await masterDataApi.createSeatLayout(body);
    },
    onSuccess: () => {
      toast.success(`Layout "${editing!.name}" saved with ${summary?.total ?? 0} seats`);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['seat-layouts'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save — check seat positions/count'),
  });

  const remove = useMutation({
    mutationFn: () => masterDataApi.deleteSeatLayout(deletingLayout!.id),
    onSuccess: () => { toast.success('Layout deleted'); setDeletingLayout(null); void qc.invalidateQueries({ queryKey: ['seat-layouts'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const restore = useMutation({
    mutationFn: (versionNumber: number) => masterDataApi.restoreSeatLayoutVersion(viewingVersionsOf!.id, versionNumber),
    onSuccess: () => {
      toast.success('Restored — this is now the active layout');
      setViewingVersionsOf(null);
      void qc.invalidateQueries({ queryKey: ['seat-layouts'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const autoMark = useMutation({
    mutationFn: (id: string) => masterDataApi.autoSeatPositions(id),
    onSuccess: () => { toast.success('Window and aisle seats marked — the previous version is in History'); void qc.invalidateQueries({ queryKey: ['seat-layouts'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not mark seats'),
  });

  const columns: Column<SeatLayoutRow>[] = [
    { key: 'name', header: 'Layout name', render: (r) => <button className="font-medium text-text underline decoration-dotted" onClick={() => void openEdit(r)}>{r.name}</button> },
    { key: 'decks', header: 'Decks', render: (r) => r.decks ?? '—' },
    { key: 'seats', header: 'Total seats', render: (r) => r.totalSeats ?? '—' },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<Eye className="h-4 w-4" />} onClick={() => void openPreview(r)}>Preview</Button>
          <Button size="sm" variant="ghost" leftIcon={<Wand2 className="h-4 w-4" />} loading={autoMark.isPending && autoMark.variables === r.id} disabled={autoMark.isPending}
            title="Mark every window and aisle seat from the grid — saved as a new version you can undo from History" onClick={() => autoMark.mutate(r.id)}>Auto window/aisle</Button>
          <Button size="sm" variant="ghost" leftIcon={<History className="h-4 w-4" />} onClick={() => setViewingVersionsOf(r)}>History</Button>
          <Button size="sm" variant="ghost" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void openDuplicate(r)}>Duplicate</Button>
          <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setDeletingLayout(r)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        {TEMPLATES.map((t) => (
          <Button key={t.label} size="sm" variant="outline" leftIcon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => openNew(t)}>{t.label}</Button>
        ))}
      </div>

      {layouts.isLoading ? <PageLoader /> : layouts.isError ? <ErrorState error={layouts.error} onRetry={layouts.refetch} /> :
        (layouts.data?.items.length ? <Table columns={columns} rows={layouts.data.items} /> : <EmptyState title="No seat layouts yet" description="Start from a template above." icon={<LayoutGrid className="h-10 w-10" />} />)}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit seat layout' : 'New seat layout'} size="lg"
        footer={<>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          {!jsonMode && <Button variant="outline" leftIcon={<Code2 className="h-4 w-4" />} onClick={enterJsonMode}>Edit as JSON</Button>}
          {!jsonMode && <Button loading={save.isPending} disabled={!editing?.name || !summary?.total} onClick={() => save.mutate()}>{editing?.id ? 'Update' : 'Save'} layout {summary ? `(${summary.total} seats)` : ''}</Button>}
          {jsonMode && <Button onClick={applyJson}>Apply JSON to grid</Button>}
        </>}>
        {editing && jsonMode && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-muted">Raw layout JSON — for power users. Applying re-renders the visual grid below; nothing is saved until you click Update/Save layout afterwards.</p>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={18}
              className="w-full rounded-md border border-border bg-surface-muted p-3 font-mono text-xs text-text" spellCheck={false} />
            {jsonError && <p className="text-xs text-danger">{jsonError}</p>}
          </div>
        )}
        {editing && !jsonMode && (
          <div className="flex flex-col gap-3">
            <Input label="Layout name" value={editing.name} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} placeholder="2+2 AC Seater" />

            {editing.decks === 2 && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setDeckIdx(0)} className={cn('rounded-md border px-3 py-1 text-xs', deckIdx === 0 ? 'border-primary bg-surface-muted' : 'border-border')}>Lower deck</button>
                <button type="button" onClick={() => setDeckIdx(1)} className={cn('rounded-md border px-3 py-1 text-xs', deckIdx === 1 ? 'border-primary bg-surface-muted' : 'border-border')}>Upper deck</button>
              </div>
            )}

            <p className="flex items-center gap-1.5 text-xs text-text-muted"><Info className="h-3.5 w-3.5" /> Click a cell to select it (shift-click or drag for many), then use the toolbar below.</p>

            <div
              className="flex select-none flex-col gap-1 overflow-auto rounded-md border border-border p-3"
              onMouseLeave={() => setDragging(false)} onMouseUp={() => setDragging(false)}
            >
              {Array.from({ length: editing.rows }).map((_, r) => (
                <div key={r} className="flex gap-1">
                  {Array.from({ length: editing.columns }).map((_, c) => {
                    const key = cellKey(deckIdx, r, c);
                    const cell = editing.grid[key] ?? EMPTY_CELL;
                    const isSelected = selected.has(key);
                    return (
                      <button
                        key={c} type="button"
                        onMouseDown={(e) => { setDragging(true); toggleSelect(key, e.shiftKey || e.metaKey || e.ctrlKey); }}
                        onMouseEnter={() => { if (dragging) toggleSelect(key, true); }}
                        className={cn(
                          'relative flex h-8 w-8 items-center justify-center rounded border text-[9px] font-medium transition-shadow',
                          SEAT_COLOR[cell.type], isSelected && 'ring-2 ring-offset-1 ring-primary',
                        )}
                        title={cell.label || undefined}
                      >
                        {cell.ladiesOnly && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger" />}
                        {cell.accessible && <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-info" title="Disability-friendly" />}
                        {cell.position === 'window' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-success" />}
                        {cell.type === 'crew' ? <Car className="h-3.5 w-3.5" /> : cell.bookable === false ? '✕' : cell.type ? (cell.label || cell.type[0].toUpperCase()) : ''}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {selected.size > 0 && (
              <Card><CardBody className="flex flex-wrap items-end gap-2">
                <span className="mr-1 text-xs font-medium text-text">{selected.size} selected:</span>
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ type: 'seater' })}>Seater</Button>
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ type: 'sleeper' })}>Sleeper</Button>
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ type: 'semi_sleeper' })}>Semi-sleeper</Button>
                <Button size="sm" variant="outline" leftIcon={<Car className="h-3.5 w-3.5" />} onClick={() => applyToSelection({ type: 'crew' })}>Driver/crew</Button>
                <Button size="sm" variant="ghost" onClick={() => applyToSelection('clear')}>Clear (aisle/gap)</Button>
                <span className="mx-1 h-6 w-px bg-border" />
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ ladiesOnly: true })}>Ladies-only</Button>
                <Button size="sm" variant="ghost" onClick={() => applyToSelection({ ladiesOnly: false })}>Unset ladies-only</Button>
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ accessible: true })}>Disability-friendly</Button>
                <Button size="sm" variant="ghost" onClick={() => applyToSelection({ accessible: false })}>Unset disability-friendly</Button>
                <span className="mx-1 h-6 w-px bg-border" />
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ position: 'window' })}>Window</Button>
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ position: 'aisle' })}>Aisle</Button>
                <Button size="sm" variant="outline" onClick={() => applyToSelection({ position: 'front' })}>Front</Button>
                <Button size="sm" variant="outline" className="text-danger" onClick={() => applyToSelection({ bookable: false })}>Mark unbookable</Button>
                <Button size="sm" variant="ghost" onClick={() => applyToSelection({ bookable: true })}>Mark bookable</Button>
                {selected.size === 1 && (() => {
                  const only = editing.grid[[...selected][0]] ?? EMPTY_CELL;
                  return (
                    <>
                      <span className="mx-1 h-6 w-px bg-border" />
                      <Select label="Position" value={only.position ?? ''} onChange={(e) => applyToSelection({ position: e.target.value as Position })}
                        options={[{ label: 'None', value: '' }, { label: 'Window', value: 'window' }, { label: 'Aisle', value: 'aisle' }, { label: 'Front', value: 'front' }]} />
                      <Input label="Custom label" value={only.label ?? ''} onChange={(e) => applyToSelection({ label: e.target.value })} className="w-24" placeholder="e.g. 1A" />
                      <Input label="Row span" type="number" value={only.rowSpan ?? 1} onChange={(e) => applyToSelection({ rowSpan: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} className="w-16" />
                      <Input label="Col span" type="number" value={only.colSpan ?? 1} onChange={(e) => applyToSelection({ colSpan: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} className="w-16" />
                    </>
                  );
                })()}
              </CardBody></Card>
            )}

            <Card><CardBody className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium text-text">Bulk renumber all seats:</span>
              {(['sequential', 'row', 'deck'] as const).map((scheme, i) => (
                <Button key={scheme} size="sm" variant="outline" title={NUMBERING_SCHEMES[i].describe} onClick={() => applyNumberingScheme(scheme)}>{NUMBERING_SCHEMES[i].label}</Button>
              ))}
            </CardBody></Card>

            {summary && (
              <div className="flex flex-wrap gap-3 text-xs text-text-muted">
                <span><b className="text-text">{summary.total}</b> total</span>
                <span>{summary.seater} seater</span>
                <span>{summary.sleeper} sleeper</span>
                <span>{summary.semi} semi-sleeper</span>
                {summary.crew > 0 && <span className="flex items-center gap-1"><Car className="h-3 w-3" /> {summary.crew} driver/crew</span>}
                {summary.ladies > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" /> {summary.ladies} ladies-only</span>}
                {summary.accessible > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" /> {summary.accessible} disability-friendly</span>}
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-success" /> window</span>
                {summary.unbookable > 0 && <span>{summary.unbookable} unbookable</span>}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!deletingLayout} onClose={() => setDeletingLayout(null)} title={`Delete "${deletingLayout?.name}"?`}
        footer={<><Button variant="ghost" onClick={() => setDeletingLayout(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} disabled={!!usage.data?.vehicleCount} onClick={() => remove.mutate()}>Delete</Button></>}>
        {usage.isLoading ? <PageLoader /> : usage.data?.vehicleCount ? (
          <p className="text-sm text-danger">Still used by {usage.data.vehicleCount} vehicle(s) — reassign them to a different layout first.</p>
        ) : (
          <p className="text-sm text-text-muted">This layout is not used by any vehicle. This cannot be undone (though its version history stays around).</p>
        )}
      </Modal>

      <Modal open={!!viewingVersionsOf} onClose={() => setViewingVersionsOf(null)} title={`Version history — ${viewingVersionsOf?.name ?? ''}`} size="lg">
        {versions.isLoading ? <PageLoader /> : versions.isError ? <ErrorState error={versions.error} onRetry={versions.refetch} /> : (
          <div className="flex flex-col gap-2">
            {(versions.data?.items ?? []).map((v: SeatLayoutVersion, i: number) => (
              <div key={v.versionNumber} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-text">
                    v{v.versionNumber} {i === 0 && <Badge tone="success">Current</Badge>}
                  </div>
                  <div className="text-xs text-text-muted">{v.changeNote ?? 'Edited'} — {formatDateTime(v.createdAt)}</div>
                  <div className="text-xs text-text-muted">{v.summary.totalSeats} seats ({v.summary.seater} seater, {v.summary.sleeper} sleeper, {v.summary.semiSleeper} semi{v.summary.crewSeats ? `, ${v.summary.crewSeats} crew` : ''})</div>
                </div>
                {i !== 0 && <Button size="sm" variant="outline" leftIcon={<RotateCcw className="h-4 w-4" />} loading={restore.isPending} onClick={() => restore.mutate(v.versionNumber)}>Restore</Button>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={!!previewing} onClose={() => setPreviewing(null)} title={`Preview — ${previewing?.name ?? ''}`} size="lg">
        {previewing && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: previewing.decks }).map((_, d) => (
              <div key={d}>
                {previewing.decks === 2 && <div className="mb-2 text-xs font-semibold text-text-muted">{d === 0 ? 'Lower deck' : 'Upper deck'}</div>}
                <div className="flex flex-col gap-1">
                  {Array.from({ length: previewing.rows }).map((_, r) => (
                    <div key={r} className="flex gap-1">
                      {Array.from({ length: previewing.columns }).map((_, c) => {
                        const cell = previewing.grid[cellKey(d, r, c)] ?? EMPTY_CELL;
                        return (
                          <div key={c} className={cn('flex h-9 w-9 items-center justify-center rounded border text-[9px] font-medium', SEAT_COLOR[cell.type])}>
                            {cell.type === 'crew' ? <Car className="h-3.5 w-3.5" /> : cell.type ? (cell.label ?? '') : ''}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1"><span className={cn('h-3 w-3 rounded border', SEAT_COLOR.seater)} /> Seater</span>
              <span className="flex items-center gap-1"><span className={cn('h-3 w-3 rounded border', SEAT_COLOR.sleeper)} /> Sleeper</span>
              <span className="flex items-center gap-1"><span className={cn('h-3 w-3 rounded border', SEAT_COLOR.semi_sleeper)} /> Semi-sleeper</span>
              <span className="flex items-center gap-1"><Car className="h-3 w-3" /> Driver/crew (never sold)</span>
            </div>
            <p className="text-xs text-text-muted">This is exactly the grid a customer sees when picking seats for a trip using this bus.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
