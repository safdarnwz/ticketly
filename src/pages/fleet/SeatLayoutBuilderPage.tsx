import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Eraser, GripVertical, Hash, MousePointer2, RotateCw, Save, Trash2, Wand2, Minus, Plus } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, Select, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { FixtureTile, SeatMap } from '@/components/customer/SeatMap';
import { masterDataApi } from '@/lib/api/masterData';
import {
  DEFAULT_NUMBERING, FIXTURE_LABEL, LAYOUT_TEMPLATES, MAX_COLUMNS, MAX_ROWS, NUMBERING_PRESETS,
  autoNumber, autoPositions, clearCell, deleteLine, fromPayload, insertLine, layoutChecks, moveItem, numberProblems, occupantAt, placeItem, resizeDeck, setDecks, toPayload,
  type Deck, type ItemRef, type FixtureKind, type LayoutDraft, type LayoutSeat, type NumberingOptions, type SeatKind,
} from '@/lib/seat-layout';
import { cn } from '@/lib/utils';

type Tool =
  | { id: 'select' }
  | { id: 'erase' }
  | { id: 'seat'; type: SeatKind; rowSpan: number; colSpan: number }
  | { id: 'fixture'; kind: FixtureKind; rowSpan: number; colSpan: number };

const TOOLS: { key: string; label: string; hint: string; tool: Tool }[] = [
  { key: 'select', label: 'Select', hint: 'Pick a seat to rename or change it', tool: { id: 'select' } },
  { key: 'seater', label: 'Seater', hint: 'One cell', tool: { id: 'seat', type: 'seater', rowSpan: 1, colSpan: 1 } },
  { key: 'semi', label: 'Semi-sleeper', hint: 'Push-back seat, one cell', tool: { id: 'seat', type: 'semi_sleeper', rowSpan: 1, colSpan: 1 } },
  { key: 'berth-v', label: 'Berth ↕', hint: 'Sleeper along the bus — 2 rows', tool: { id: 'seat', type: 'sleeper', rowSpan: 2, colSpan: 1 } },
  { key: 'berth-h', label: 'Berth ↔', hint: 'Sleeper across the bus — 2 columns', tool: { id: 'seat', type: 'sleeper', rowSpan: 1, colSpan: 2 } },
  { key: 'crew', label: 'Crew seat', hint: 'Conductor / cleaner — never sold', tool: { id: 'seat', type: 'crew', rowSpan: 1, colSpan: 1 } },
  { key: 'driver', label: 'Driver', hint: 'Where the steering is — left or right', tool: { id: 'fixture', kind: 'driver', rowSpan: 1, colSpan: 1 } },
  { key: 'door', label: 'Door', hint: 'Front, middle or rear', tool: { id: 'fixture', kind: 'door', rowSpan: 1, colSpan: 1 } },
  { key: 'washroom', label: 'Washroom', hint: 'Choose its size below', tool: { id: 'fixture', kind: 'washroom', rowSpan: 2, colSpan: 2 } },
  { key: 'stairs', label: 'Stairs', hint: 'To the upper deck', tool: { id: 'fixture', kind: 'staircase', rowSpan: 1, colSpan: 1 } },
  { key: 'exit', label: 'Emergency exit', hint: 'Marked in red', tool: { id: 'fixture', kind: 'emergency_exit', rowSpan: 1, colSpan: 1 } },
  { key: 'pantry', label: 'Pantry', hint: 'Water / snacks corner', tool: { id: 'fixture', kind: 'pantry', rowSpan: 1, colSpan: 1 } },
  { key: 'erase', label: 'Erase', hint: 'Clear a cell (aisle / gap)', tool: { id: 'erase' } },
];

const SEAT_TILE: Record<SeatKind, string> = {
  seater: 'border-[#1f9d55] bg-[#ecfdf3] text-[#15803d]',
  semi_sleeper: 'border-[#d97706] bg-[#fffbeb] text-[#b45309]',
  sleeper: 'border-[#7c3aed] bg-[#f5f3ff] text-[#6d28d9]',
  crew: 'border-[#475569] bg-[#f1f5f9] text-[#334155]',
};
const TYPE_LABEL: Record<SeatKind, string> = { seater: 'Seater', semi_sleeper: 'Semi-sleeper', sleeper: 'Sleeper berth', crew: 'Crew seat (not sold)' };

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Build a bus once — rows and columns per deck, every seat, berth, door,
 * washroom and staircase where it really is, seat numbers generated the
 * redBus / Bitla way and changed by hand where the bus differs — and every
 * screen (booking, counter, agent, chart, crew) draws exactly this.
 */
export function SeatLayoutBuilderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const copyOf = params.get('copy');
  const templateId = params.get('template');
  const sourceId = id ?? copyOf;

  const source = useQuery({ queryKey: ['seat-layout', sourceId], queryFn: () => masterDataApi.getSeatLayout(sourceId!), enabled: !!sourceId });
  const usage = useQuery({ queryKey: ['seat-layout-usage', id], queryFn: () => masterDataApi.seatLayoutUsage(id!), enabled: !!id });

  const [name, setName] = useState('');
  const [draft, setDraft] = useState<LayoutDraft | null>(null);
  const [toolKey, setToolKey] = useState('select');
  const [washSize, setWashSize] = useState('2x2');
  const [sel, setSel] = useState<{ deck: Deck; row: number; column: number } | null>(null);
  const [painting, setPainting] = useState(false);
  // What is being dragged: a tool from the palette, or a seat / fixture already placed.
  const [drag, setDrag] = useState<{ toolKey?: string; item?: ItemRef; rowSpan: number; colSpan: number } | null>(null);
  const [hover, setHover] = useState<{ deck: Deck; row: number; column: number } | null>(null);
  const [numbering, setNumbering] = useState<NumberingOptions>(DEFAULT_NUMBERING);
  const [serverError, setServerError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Start from the layout being edited / copied, or a template.
  useEffect(() => {
    if (draft) return;
    if (sourceId) {
      if (!source.data) return;
      setDraft(fromPayload(source.data.seatMap));
      setName(copyOf ? `Copy of ${source.data.name}` : source.data.name);
      return;
    }
    const t = LAYOUT_TEMPLATES.find((x) => x.id === templateId) ?? LAYOUT_TEMPLATES[0];
    setDraft(t.build());
    setName(t.id === 'blank' ? '' : t.label);
  }, [draft, sourceId, source.data, copyOf, templateId]);

  const tool: Tool = useMemo(() => {
    const t = TOOLS.find((x) => x.key === toolKey)!.tool;
    if (t.id === 'fixture' && t.kind === 'washroom') {
      const [r, c] = washSize.split('x').map(Number);
      return { ...t, rowSpan: r, colSpan: c };
    }
    return t;
  }, [toolKey, washSize]);

  const problems = useMemo(() => (draft ? numberProblems(draft) : new Map<number, string>()), [draft]);
  const passengerSeats = draft?.seats.filter((s) => s.type !== 'crew' && s.bookable !== false).length ?? 0;
  const locked = (usage.data?.upcomingTrips ?? 0) > 0;

  const change = (next: { draft: LayoutDraft; error?: string }) => {
    if (next.error) { toast.error(next.error); return false; }
    setDraft(next.draft);
    setTouched(true);
    setServerError(null);
    return true;
  };

  const applyAt = (deck: Deck, row: number, column: number) => {
    if (!draft) return;
    if (tool.id === 'select') { setSel({ deck, row, column }); return; }
    if (tool.id === 'erase') { change({ draft: clearCell(draft, deck, row, column) }); return; }
    const res = tool.id === 'seat'
      ? placeItem(draft, { seat: { type: tool.type, deck, row, column, rowSpan: tool.rowSpan, colSpan: tool.colSpan } })
      : placeItem(draft, { fixture: { kind: tool.kind, deck, row, column, rowSpan: tool.rowSpan, colSpan: tool.colSpan } });
    if (change(res)) setSel({ deck, row, column });
  };

  const toolFor = (key: string): Tool => {
    const t = TOOLS.find((x) => x.key === key)!.tool;
    if (t.id === 'fixture' && t.kind === 'washroom') {
      const [r, c] = washSize.split('x').map(Number);
      return { ...t, rowSpan: r, colSpan: c };
    }
    return t;
  };

  /** A palette tool or a placed item dropped on a cell. */
  const dropAt = (deck: Deck, row: number, column: number) => {
    const d = drag;
    setDrag(null);
    setHover(null);
    if (!draft || !d) return;
    if (d.item) {
      if (change(moveItem(draft, d.item, { deck, row, column }))) setSel({ deck, row, column });
      return;
    }
    const t = toolFor(d.toolKey!);
    if (t.id === 'seat' || t.id === 'fixture') {
      const res = t.id === 'seat'
        ? placeItem(draft, { seat: { type: t.type, deck, row, column, rowSpan: t.rowSpan, colSpan: t.colSpan } })
        : placeItem(draft, { fixture: { kind: t.kind, deck, row, column, rowSpan: t.rowSpan, colSpan: t.colSpan } });
      if (change(res)) { setSel({ deck, row, column }); setToolKey('select'); }
    }
  };

  const selected = draft && sel ? occupantAt(draft, sel.deck, sel.row, sel.column) : null;
  const selSeat = selected?.kind === 'seat' ? draft!.seats[selected.index] : null;
  const selFixture = selected?.kind === 'fixture' ? draft!.fixtures[selected.index] : null;

  const patchSeat = (patch: Partial<LayoutSeat>) => {
    if (!draft || selected?.kind !== 'seat') return;
    change({ draft: { ...draft, seats: draft.seats.map((s, i) => (i === selected.index ? { ...s, ...patch } : s)) } });
  };

  const rotate = () => {
    if (!draft || !selected) return;
    const item = selected.kind === 'seat' ? draft.seats[selected.index] : draft.fixtures[selected.index];
    const turned = { ...item, rowSpan: item.colSpan ?? 1, colSpan: item.rowSpan ?? 1 };
    const without = selected.kind === 'seat'
      ? { ...draft, seats: draft.seats.filter((_, i) => i !== selected.index) }
      : { ...draft, fixtures: draft.fixtures.filter((_, i) => i !== selected.index) };
    const res = selected.kind === 'seat' ? placeItem(without, { seat: turned as LayoutSeat }) : placeItem(without, { fixture: turned as LayoutDraft['fixtures'][number] });
    change(res);
  };

  const save = useMutation({
    mutationFn: async (asNew: boolean) => {
      const body = { name: name.trim(), layout: toPayload(draft!) };
      if (id && !asNew) { await masterDataApi.updateSeatLayout(id, body); return id; }
      return (await masterDataApi.createSeatLayout(body)).id;
    },
    onSuccess: (savedId, asNew) => {
      toast.success(`"${name.trim()}" saved — ${passengerSeats} seats`);
      setTouched(false);
      void qc.invalidateQueries({ queryKey: ['seat-layouts'] });
      void qc.invalidateQueries({ queryKey: ['seat-layout', savedId] });
      if (!id || asNew) navigate(`/fleet/seat-layouts/${savedId}`, { replace: true });
    },
    onError: (e) => setServerError(errText(e, 'Could not save the layout')),
  });

  if (sourceId && source.isLoading) return <PageLoader />;
  if (sourceId && source.isError) return <ErrorState error={source.error} onRetry={source.refetch} />;
  if (!draft) return <PageLoader />;

  const nameError = touched && !name.trim() ? 'Give the layout a name' : undefined;
  const blockers = [
    !name.trim() && 'a name',
    passengerSeats === 0 && 'at least one seat for sale',
    problems.size > 0 && `${problems.size} seat number(s) to fix`,
  ].filter(Boolean) as string[];

  const preview = toPayload(draft);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={id ? `Edit layout — ${source.data?.name ?? ''}` : 'New seat layout'}
        subtitle="Draw the bus once: rows and columns for each deck, every seat and berth, the driver, doors, washroom and stairs. Every screen shows it exactly like this."
        action={<>
          {id && <Button variant="outline" disabled={save.isPending || blockers.length > 0} onClick={() => save.mutate(true)}>Save as new layout</Button>}
          <Button leftIcon={<Save className="h-4 w-4" />} loading={save.isPending && save.variables === false} disabled={save.isPending || blockers.length > 0}
            title={blockers.length ? `Needs ${blockers.join(', ')}` : undefined} onClick={() => save.mutate(false)}>
            {id ? 'Save changes' : 'Save layout'}
          </Button>
        </>}
      />

      {locked && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{usage.data!.upcomingTrips} upcoming trip(s) sell seats from this layout. You can move seats, the washroom, doors and stairs, but not renumber, add, remove or retype seats — use <b>Save as new layout</b> for that and give the copy to the bus.</span>
        </div>
      )}
      {serverError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{serverError}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Input label="Layout name" value={name} error={nameError} maxLength={120} onChange={(e) => { setName(e.target.value); setTouched(true); }} placeholder="e.g. Volvo 9600 2+2 with washroom" />
                <div>
                  <span className="mb-1 block text-sm font-medium text-text">Decks</span>
                  <div className="flex gap-1" role="group" aria-label="Decks">
                    {([1, 2] as const).map((n) => (
                      <button key={n} type="button" aria-pressed={draft.decks === n} onClick={() => change(setDecks(draft, n))}
                        className={cn('rounded-md border px-3 py-2 text-sm', draft.decks === n ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border text-text')}>
                        {n === 1 ? 'Single deck' : 'Lower + upper'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Tools">
                {TOOLS.filter((t) => draft.decks === 2 || t.key !== 'stairs').map((t) => (
                  <button key={t.key} type="button" title={t.tool.id === 'seat' || t.tool.id === 'fixture' ? `${t.hint} — drag onto the bus, or click then click a cell` : t.hint} aria-pressed={toolKey === t.key} onClick={() => setToolKey(t.key)}
                    draggable={t.tool.id === 'seat' || t.tool.id === 'fixture'}
                    onDragStart={(e) => {
                      const tt = toolFor(t.key);
                      e.dataTransfer.setData('text/plain', t.key);
                      e.dataTransfer.effectAllowed = 'copy';
                      setDrag({ toolKey: t.key, rowSpan: 'rowSpan' in tt ? tt.rowSpan : 1, colSpan: 'colSpan' in tt ? tt.colSpan : 1 });
                    }}
                    onDragEnd={() => { setDrag(null); setHover(null); }}
                    className={cn('flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium', toolKey === t.key ? 'border-primary bg-primary text-white' : 'border-border bg-surface text-text hover:bg-surface-muted')}>
                    {t.tool.id === 'select' ? <MousePointer2 className="h-3.5 w-3.5" /> : t.tool.id === 'erase' ? <Eraser className="h-3.5 w-3.5" /> : <GripVertical className="h-3.5 w-3.5 opacity-50" />}
                    {t.label}
                  </button>
                ))}
                {toolKey === 'washroom' && (
                  <select aria-label="Washroom size" value={washSize} onChange={(e) => setWashSize(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
                    <option value="1x1">1 × 1 cell</option><option value="1x2">1 row × 2 columns</option><option value="2x1">2 rows × 1 column</option><option value="2x2">2 × 2 cells</option>
                  </select>
                )}
              </div>
              <p className="text-xs text-text-muted">
                {tool.id === 'select' ? 'Drag a seat, berth, door or washroom from above onto the bus; drag anything already placed to move it (even to the other deck). Click a seat to rename it; click an empty cell to add rows or columns there.' :
                  tool.id === 'erase' ? 'Click or drag over cells to clear them — an empty column is the aisle.' :
                  `Click or drag to place: ${TOOLS.find((t) => t.key === toolKey)!.hint}. Whatever is underneath is replaced.`}
              </p>

              <div className="flex flex-wrap gap-4 overflow-x-auto pb-2" onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
                {draft.grids.slice(0, draft.decks).map((g, deck) => (
                  <DeckEditor key={deck} deck={deck as Deck} draft={draft} problems={problems} sel={sel} drag={drag} hover={hover}
                    onHover={(r, c) => setHover({ deck: deck as Deck, row: r, column: c })}
                    onDrop={(r, c) => dropAt(deck as Deck, r, c)}
                    onPick={(ref) => {
                      const it = ref.kind === 'seat' ? draft.seats[ref.index] : draft.fixtures[ref.index];
                      setDrag({ item: ref, rowSpan: it.rowSpan ?? 1, colSpan: it.colSpan ?? 1 });
                    }}
                    onDragEnd={() => { setDrag(null); setHover(null); }}
                    onResize={(grid) => change(resizeDeck(draft, deck as Deck, grid))}
                    onDown={(r, c) => { setPainting(tool.id !== 'select'); applyAt(deck as Deck, r, c); }}
                    onEnter={(r, c) => { if (painting && tool.id !== 'select' && (tool.id === 'erase' || (tool.rowSpan === 1 && tool.colSpan === 1))) applyAt(deck as Deck, r, c); }}
                    title={draft.decks === 2 ? (deck === 0 ? 'Lower deck' : 'Upper deck') : 'Deck'} grid={g} />
                ))}
              </div>

              {sel && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                  <span className="text-text-muted">Row {sel.row + 1}, column {sel.column + 1}{draft.decks === 2 ? `, ${sel.deck === 0 ? 'lower' : 'upper'} deck` : ''}:</span>
                  <Button size="sm" variant="outline" onClick={() => change(insertLine(draft, sel.deck, 'row', sel.row))}>Insert row before</Button>
                  <Button size="sm" variant="outline" onClick={() => change(insertLine(draft, sel.deck, 'row', sel.row + 1))}>Insert row after</Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (change(deleteLine(draft, sel.deck, 'row', sel.row))) setSel(null); }}>Delete row</Button>
                  <span className="h-5 w-px bg-border" />
                  <Button size="sm" variant="outline" onClick={() => change(insertLine(draft, sel.deck, 'column', sel.column))}>Insert column before</Button>
                  <Button size="sm" variant="outline" onClick={() => change(insertLine(draft, sel.deck, 'column', sel.column + 1))}>Insert column after</Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (change(deleteLine(draft, sel.deck, 'column', sel.column))) setSel(null); }}>Delete column</Button>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Preview — what passengers, agents and crew see" />
            <CardBody>
              {preview.seats.some((s) => s.type !== 'crew') ? (
                <SeatMap legend="none" map={{
                  tripStatus: 'open', total: passengerSeats, available: passengerSeats,
                  layout: { decks: preview.decks, rows: preview.rows, columns: preview.columns, grids: preview.deckGrids, fixtures: preview.fixtures },
                  seats: preview.seats.filter((x) => x.type !== 'crew').map((x) => ({
                    seatNumber: x.number || '?', seatType: x.type, available: x.bookable !== false, ladiesOnly: Boolean(x.ladiesOnly), accessible: Boolean(x.accessible),
                    deck: x.deck, row: x.row, column: x.column, rowSpan: x.rowSpan ?? 1, colSpan: x.colSpan ?? 1, position: x.position ?? null,
                  })),
                }} />
              ) : <p className="text-sm text-text-muted">Place a seat to see the bus.</p>}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={selSeat ? `Seat ${selSeat.number || '(no number)'}` : selFixture ? FIXTURE_LABEL[selFixture.kind] : 'Selected'} />
            <CardBody className="flex flex-col gap-3 text-sm">
              {!selSeat && !selFixture && <p className="text-text-muted">Choose <b>Select</b> and click a seat to rename it, mark it ladies / accessible, or turn a berth.</p>}
              {selSeat && (
                <>
                  <Input label="Seat number" value={selSeat.number} maxLength={6} error={problems.get(selected!.index)}
                    onChange={(e) => patchSeat({ number: e.target.value.toUpperCase().replace(/\s/g, '') })} />
                  <Select label="Type" value={selSeat.type} onChange={(e) => {
                    const type = e.target.value as SeatKind;
                    const shape = type === 'sleeper' ? { rowSpan: selSeat.rowSpan ?? 2, colSpan: selSeat.colSpan } : { rowSpan: 1, colSpan: 1 };
                    const without = { ...draft, seats: draft.seats.filter((_, i) => i !== selected!.index) };
                    change(placeItem(without, { seat: { ...selSeat, ...shape, type } }));
                  }} options={(Object.keys(TYPE_LABEL) as SeatKind[]).map((k) => ({ value: k, label: TYPE_LABEL[k] }))} />
                  {selSeat.type !== 'crew' && (
                    <>
                      <Select label="Position" value={selSeat.position ?? ''} onChange={(e) => patchSeat({ position: (e.target.value || undefined) as LayoutSeat['position'] })}
                        options={[{ value: '', label: '—' }, { value: 'window', label: 'Window' }, { value: 'aisle', label: 'Aisle' }, { value: 'front', label: 'Front' }]} />
                      <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(selSeat.ladiesOnly)} onChange={(e) => patchSeat({ ladiesOnly: e.target.checked })} /> Ladies seat</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(selSeat.accessible)} onChange={(e) => patchSeat({ accessible: e.target.checked })} /> Disability-friendly</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={selSeat.bookable === false} onChange={(e) => patchSeat({ bookable: e.target.checked ? false : undefined })} /> Not for sale (broken, kept back)</label>
                    </>
                  )}
                  {selSeat.type === 'sleeper' && <Button size="sm" variant="outline" leftIcon={<RotateCw className="h-3.5 w-3.5" />} onClick={rotate}>{(selSeat.colSpan ?? 1) > (selSeat.rowSpan ?? 1) ? 'Stand along the bus' : 'Lay across the bus'}</Button>}
                  <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { change({ draft: clearCell(draft, sel!.deck, sel!.row, sel!.column) }); setSel(null); }}>Remove seat</Button>
                </>
              )}
              {selFixture && (
                <>
                  <p className="text-text-muted">{(selFixture.rowSpan ?? 1)} row(s) × {(selFixture.colSpan ?? 1)} column(s)</p>
                  {(selFixture.rowSpan ?? 1) !== (selFixture.colSpan ?? 1) && <Button size="sm" variant="outline" leftIcon={<RotateCw className="h-3.5 w-3.5" />} onClick={rotate}>Turn</Button>}
                  <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { change({ draft: clearCell(draft, sel!.deck, sel!.row, sel!.column) }); setSel(null); }}>Remove</Button>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Seat numbers" subtitle="Generate them the redBus / Bitla way, then change any seat by hand" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Numbering style">
                {NUMBERING_PRESETS.map((p) => (
                  <label key={p.id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border p-2', numbering.preset === p.id ? 'border-primary bg-primary/5' : 'border-border')}>
                    <input type="radio" name="preset" className="mt-1" checked={numbering.preset === p.id} onChange={() => setNumbering({ ...numbering, preset: p.id })} />
                    <span><span className="font-medium text-text">{p.label}</span><span className="block text-xs text-text-muted">{p.example}</span></span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><Select label="Order" value={numbering.direction} onChange={(e) => setNumbering({ ...numbering, direction: e.target.value as 'rows' | 'columns' })}
                  options={[{ value: 'rows', label: 'Across each row (front to back)' }, { value: 'columns', label: 'Down each side (column by column)' }]} /></div>
                <Input label="Start at" type="number" min={0} max={999} value={numbering.start} onChange={(e) => setNumbering({ ...numbering, start: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })} />
                {numbering.preset !== 'continuous' && (
                  <>
                    <Input label="Lower berth prefix" value={numbering.lowerPrefix} maxLength={2} onChange={(e) => setNumbering({ ...numbering, lowerPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                    <Input label="Upper berth prefix" value={numbering.upperPrefix} maxLength={2} onChange={(e) => setNumbering({ ...numbering, upperPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                    <Input label="Seat prefix" value={numbering.seaterPrefix} maxLength={2} placeholder="none" onChange={(e) => setNumbering({ ...numbering, seaterPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                  </>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(numbering.onlyBlank)} onChange={(e) => setNumbering({ ...numbering, onlyBlank: e.target.checked })} /> Only seats without a number (keep the ones I typed)</label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" leftIcon={<Hash className="h-3.5 w-3.5" />} disabled={locked} title={locked ? 'Trips are on sale — Save as new layout to renumber' : undefined}
                  onClick={() => { change({ draft: autoNumber(draft, numbering) }); toast.success('Seats numbered — change any seat by selecting it'); }}>Generate numbers</Button>
                <Button size="sm" variant="outline" leftIcon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => change({ draft: autoPositions(draft) })}>Mark window / aisle</Button>
              </div>
              {problems.size > 0 && <p className="text-xs text-danger">{problems.size} seat(s) need a number fix — shown in red on the grid.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Checklist" subtitle="What passengers, crew and the bus rules expect — shown, not forced" />
            <CardBody>
              <ul className="flex flex-col gap-2 text-sm">
                {layoutChecks(draft).map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                    <span><span className={cn('font-medium', c.ok ? 'text-text' : 'text-warning')}>{c.label}</span>{!c.ok && <span className="block text-xs text-text-muted">{c.detail}</span>}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-wrap gap-2 text-xs">
              <Badge tone="success">{draft.seats.filter((s) => s.type === 'seater').length} seater</Badge>
              <Badge tone="warning">{draft.seats.filter((s) => s.type === 'semi_sleeper').length} semi-sleeper</Badge>
              <Badge tone="info">{draft.seats.filter((s) => s.type === 'sleeper').length} berths</Badge>
              <Badge tone="neutral">{passengerSeats} for sale</Badge>
              {draft.fixtures.filter((f) => f.kind === 'washroom').length > 0 && <Badge tone="info">washroom</Badge>}
              {!draft.fixtures.some((f) => f.kind === 'driver') && <span className="text-text-muted">Tip: place the Driver so passengers see the front of the bus.</span>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** One deck as an editable grid with its own rows and columns. */
function DeckEditor({ deck, draft, grid, title, problems, sel, drag, hover, onResize, onDown, onEnter, onHover, onDrop, onPick, onDragEnd }: {
  deck: Deck; draft: LayoutDraft; grid: { rows: number; columns: number }; title: string; problems: Map<number, string>;
  sel: { deck: Deck; row: number; column: number } | null;
  drag: { rowSpan: number; colSpan: number } | null;
  hover: { deck: Deck; row: number; column: number } | null;
  onResize: (g: { rows: number; columns: number }) => void; onDown: (r: number, c: number) => void; onEnter: (r: number, c: number) => void;
  onHover: (r: number, c: number) => void; onDrop: (r: number, c: number) => void; onPick: (ref: ItemRef) => void; onDragEnd: () => void;
}) {
  // Where the dragged thing would land: its whole footprint, red when it does not fit.
  const landing = drag && hover?.deck === deck ? { ...hover, rowSpan: drag.rowSpan, colSpan: drag.colSpan } : null;
  const fits = landing ? landing.row + landing.rowSpan <= grid.rows && landing.column + landing.colSpan <= grid.columns : true;
  const dropProps = (r: number, c: number) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (hover?.deck !== deck || hover.row !== r || hover.column !== c) onHover(r, c); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); onDrop(r, c); },
  });
  const pickProps = (ref: ItemRef, r: number, c: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', `${ref.kind}:${ref.index}`); e.dataTransfer.effectAllowed = 'move'; onPick(ref); },
    onDragEnd,
    onClick: () => onDown(r, c),
    ...dropProps(r, c),
  });
  const cell = '2.4rem';
  const stepper = (label: string, value: number, max: number, set: (n: number) => void): ReactNode => (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-text-muted">{label}</span>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} className="rounded border border-border p-0.5 disabled:opacity-40" disabled={value <= 1} onClick={() => set(value - 1)}><Minus className="h-3 w-3" /></button>
      <input aria-label={`${title} ${label.toLowerCase()}`} type="number" min={1} max={max} value={value} onChange={(e) => set(Math.max(1, Math.min(max, Number(e.target.value) || 1)))} className="w-10 rounded border border-border bg-surface px-1 py-0.5 text-center" />
      <button type="button" aria-label={`More ${label.toLowerCase()}`} className="rounded border border-border p-0.5 disabled:opacity-40" disabled={value >= max} onClick={() => set(value + 1)}><Plus className="h-3 w-3" /></button>
    </div>
  );
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-surface-muted/40 p-3">
      <header className="mb-2 flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-text">{title}</span>
        <div className="flex flex-wrap gap-3">
          {stepper('Rows', grid.rows, MAX_ROWS, (rows) => onResize({ ...grid, rows }))}
          {stepper('Columns', grid.columns, MAX_COLUMNS, (columns) => onResize({ ...grid, columns }))}
        </div>
      </header>
      <div className="grid select-none gap-1" style={{ gridTemplateColumns: `1.2rem repeat(${grid.columns}, ${cell})`, gridTemplateRows: `1rem repeat(${grid.rows}, ${cell})` }}>
        {Array.from({ length: grid.columns }, (_, c) => <span key={`h${c}`} className="text-center text-[9px] text-text-muted" style={{ gridColumn: c + 2, gridRow: 1 }}>{c + 1}</span>)}
        {Array.from({ length: grid.rows }, (_, r) => <span key={`r${r}`} className="self-center text-right text-[9px] text-text-muted" style={{ gridColumn: 1, gridRow: r + 2 }}>{r + 1}</span>)}
        {Array.from({ length: grid.rows * grid.columns }, (_, i) => {
          const r = Math.floor(i / grid.columns);
          const c = i % grid.columns;
          const isSel = sel?.deck === deck && sel.row === r && sel.column === c;
          return (
            <button key={`c${i}`} type="button" aria-label={`${title} row ${r + 1} column ${c + 1}`}
              onPointerDown={(e) => { e.preventDefault(); onDown(r, c); }} onPointerEnter={() => onEnter(r, c)}
              {...dropProps(r, c)}
              className={cn('rounded border border-dashed border-border/70 bg-surface hover:border-primary', isSel && 'ring-2 ring-primary')}
              style={{ gridColumn: c + 2, gridRow: r + 2 }} />
          );
        })}
        {draft.fixtures.map((f, i) => f.deck === deck && (
          <div key={`f${i}`} role="button" aria-label={`${FIXTURE_LABEL[f.kind]} at row ${f.row + 1} column ${f.column + 1} — drag to move`} className="cursor-grab p-px active:cursor-grabbing"
            {...pickProps({ kind: 'fixture', index: i }, f.row, f.column)}
            style={{ gridColumn: `${f.column + 2} / span ${f.colSpan ?? 1}`, gridRow: `${f.row + 2} / span ${f.rowSpan ?? 1}` }}>
            <FixtureTile kind={f.kind} />
          </div>
        ))}
        {draft.seats.map((s, i) => {
          if (s.deck !== deck) return null;
          const bad = problems.get(i);
          const isSel = sel?.deck === deck && sel.row >= s.row && sel.row < s.row + (s.rowSpan ?? 1) && sel.column >= s.column && sel.column < s.column + (s.colSpan ?? 1);
          return (
            <div key={`s${i}`} title={bad ?? `${TYPE_LABEL[s.type]} ${s.number} — drag to move`} role="button" aria-label={`Seat ${s.number || 'without number'} — drag to move`}
              {...pickProps({ kind: 'seat', index: i }, s.row, s.column)}
              className={cn('flex cursor-grab flex-col active:cursor-grabbing items-center justify-center rounded-md border-2 text-[10px] font-semibold leading-tight',
                SEAT_TILE[s.type], bad && 'border-danger bg-danger/10 text-danger', s.bookable === false && s.type !== 'crew' && 'opacity-50', isSel && 'ring-2 ring-primary ring-offset-1')}
              style={{ gridColumn: `${s.column + 2} / span ${s.colSpan ?? 1}`, gridRow: `${s.row + 2} / span ${s.rowSpan ?? 1}` }}>
              <span>{s.number || '?'}</span>
              {(s.ladiesOnly || s.accessible) && <span className="text-[8px] font-normal">{s.ladiesOnly ? '♀' : ''}{s.accessible ? '♿' : ''}</span>}
            </div>
          );
        })}
        {landing && (
          <div aria-hidden className={cn('pointer-events-none rounded-md border-2 border-dashed', fits ? 'border-primary bg-primary/15' : 'border-danger bg-danger/15')}
            style={{ gridColumn: `${landing.column + 2} / span ${Math.min(landing.colSpan, grid.columns - landing.column)}`, gridRow: `${landing.row + 2} / span ${Math.min(landing.rowSpan, grid.rows - landing.row)}` }} />
        )}
      </div>
    </section>
  );
}
