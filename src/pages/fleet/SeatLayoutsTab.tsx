import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Copy, Trash2, Wand2, History, Eye, RotateCcw, Pencil, Plus } from 'lucide-react';

import { Button, Badge, Table, type Column, Modal, PageLoader, ErrorState, EmptyState, useToast } from '@/components/ui';
import { SeatMap } from '@/components/customer/SeatMap';
import { masterDataApi, type SeatLayoutRow, type SeatLayoutVersion } from '@/lib/api/masterData';
import { FIXTURE_LABEL, LAYOUT_TEMPLATES, fromPayload, toPayload, type LayoutDraft } from '@/lib/seat-layout';
import { formatDateTime } from '@/lib/utils';

/** A saved layout drawn exactly as passengers see it. */
function LayoutPreview({ draft }: { draft: LayoutDraft }) {
  const m = toPayload(draft);
  const seats = m.seats.filter((x) => x.type !== 'crew');
  return (
    <SeatMap legend="none" map={{
      tripStatus: 'open', total: seats.length, available: seats.length,
      layout: { decks: m.decks, rows: m.rows, columns: m.columns, grids: m.deckGrids, fixtures: m.fixtures },
      seats: seats.map((x) => ({
        seatNumber: x.number, seatType: x.type, available: x.bookable !== false, ladiesOnly: Boolean(x.ladiesOnly), accessible: Boolean(x.accessible),
        deck: x.deck, row: x.row, column: x.column, rowSpan: x.rowSpan ?? 1, colSpan: x.colSpan ?? 1, position: x.position ?? null,
      })),
    }} />
  );
}

export function SeatLayoutsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [deletingLayout, setDeletingLayout] = useState<SeatLayoutRow | null>(null);
  const [viewingVersionsOf, setViewingVersionsOf] = useState<SeatLayoutRow | null>(null);
  const [previewing, setPreviewing] = useState<{ name: string; draft: LayoutDraft } | null>(null);

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

  const openPreview = async (row: SeatLayoutRow) => {
    try {
      const full = await masterDataApi.getSeatLayout(row.id);
      setPreviewing({ name: row.name, draft: fromPayload(full.seatMap) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the layout');
    }
  };

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
    { key: 'name', header: 'Layout name', render: (r) => <button className="font-medium text-text decoration-dotted" onClick={() => navigate(`/fleet/seat-layouts/${r.id}`)}>{r.name}</button> },
    { key: 'decks', header: 'Decks', render: (r) => r.decks ?? '—' },
    { key: 'seats', header: 'Total seats', render: (r) => r.totalSeats ?? '—' },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" leftIcon={<Eye className="h-4 w-4" />} onClick={() => void openPreview(r)}>Preview</Button>
          <Button size="sm" variant="ghost" leftIcon={<Wand2 className="h-4 w-4" />} loading={autoMark.isPending && autoMark.variables === r.id} disabled={autoMark.isPending}
            title="Mark every window and aisle seat from the grid — saved as a new version you can undo from History" onClick={() => autoMark.mutate(r.id)}>Auto window/aisle</Button>
          <Button size="sm" variant="ghost" leftIcon={<History className="h-4 w-4" />} onClick={() => setViewingVersionsOf(r)}>History</Button>
          <Button size="sm" variant="ghost" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/fleet/seat-layouts/${r.id}`)}>Edit</Button>
          <Button size="sm" variant="ghost" leftIcon={<Copy className="h-4 w-4" />} onClick={() => navigate(`/fleet/seat-layouts/new?copy=${r.id}`)}>Duplicate</Button>
          <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setDeletingLayout(r)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text-muted">Start from a common coach and adjust it — rows, columns, seats, doors, washroom, stairs and seat numbers are all yours to change.</p>
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => navigate('/fleet/seat-layouts/new?template=blank')}>Draw a new layout</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {LAYOUT_TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
            <Button key={t.id} size="sm" variant="outline" title={t.describe} leftIcon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => navigate(`/fleet/seat-layouts/new?template=${t.id}`)}>{t.label}</Button>
          ))}
        </div>
      </div>

      {layouts.isLoading ? <PageLoader /> : layouts.isError ? <ErrorState error={layouts.error} onRetry={layouts.refetch} /> :
        (layouts.data?.items.length ? <Table columns={columns} rows={layouts.data.items} /> : <EmptyState title="No seat layouts yet" description="Start from a template above." icon={<LayoutGrid className="h-10 w-10" />} />)}

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
          <div className="flex flex-col gap-3">
            <LayoutPreview draft={previewing.draft} />
            {previewing.draft.fixtures.length > 0 && (
              <p className="text-center text-xs text-text-muted">Also on this bus: {[...new Set(previewing.draft.fixtures.map((f) => FIXTURE_LABEL[f.kind]))].join(', ')}.</p>
            )}
            <p className="text-center text-xs text-text-muted">This is exactly the map a customer, agent, counter clerk and the crew see for a trip on this bus.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
