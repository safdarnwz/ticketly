import { Accessibility, CircleDot } from 'lucide-react';

import type { SeatCell, SeatMapResponse } from '@/lib/api/booking-flow';
import { SEAT_TYPE_LABEL, cn, formatMoney } from '@/lib/utils';

const CELL_REM = 2.6;

/**
 * The bus as it is laid out: one grid per deck, every seat in its real
 * row/column (a sleeper berth spans its cells). Aisles are the empty cells.
 * Seats are buttons — keyboard and screen-reader friendly, with the seat
 * number, type, price and state in the label.
 */
export function SeatMap({ map, selected, onToggle, priceOf, currency = 'INR', disabled }: {
  map: SeatMapResponse;
  selected: string[];
  onToggle: (seat: SeatCell) => void;
  priceOf: (seatType: string) => number | undefined;
  currency?: string;
  disabled?: boolean;
}) {
  const decks = Array.from({ length: Math.max(1, map.layout.decks) }, (_, d) => d);
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-6">
        {decks.map((deck) => {
          const seats = map.seats.filter((s) => s.deck === deck);
          if (seats.length === 0) return null;
          return (
            <div key={deck} className="rounded-card border border-border bg-surface-muted/40 p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-muted">
                <span>{map.layout.decks > 1 ? (deck === 0 ? 'Lower deck' : 'Upper deck') : 'Seats'}</span>
                {deck === 0 && <CircleDot className="h-4 w-4" aria-label="Driver (front)" />}
              </div>
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${map.layout.columns}, ${CELL_REM}rem)`,
                  gridTemplateRows: `repeat(${map.layout.rows}, ${CELL_REM}rem)`,
                }}
              >
                {seats.map((s) => {
                  const isSel = selected.includes(s.seatNumber);
                  const price = priceOf(s.seatType);
                  const label = `Seat ${s.seatNumber}, ${SEAT_TYPE_LABEL[s.seatType] ?? s.seatType}`
                    + (s.ladiesOnly ? ', ladies only' : '') + (s.accessible ? ', accessible' : '')
                    + (!s.available ? ', booked' : price !== undefined ? `, ${formatMoney(price, currency)}` : '')
                    + (isSel ? ', selected' : '');
                  return (
                    <button
                      key={s.seatNumber}
                      type="button"
                      disabled={disabled || !s.available}
                      aria-pressed={isSel}
                      aria-label={label}
                      title={label}
                      onClick={() => onToggle(s)}
                      style={{
                        gridColumn: `${s.column + 1} / span ${s.colSpan}`,
                        gridRow: `${s.row + 1} / span ${s.rowSpan}`,
                      }}
                      className={cn(
                        'relative flex flex-col items-center justify-center rounded-md border text-[10px] font-semibold leading-none transition',
                        s.seatType === 'sleeper' ? 'rounded-lg' : '',
                        !s.available
                          ? 'cursor-not-allowed border-border bg-surface-muted text-text-muted/60 line-through'
                          : isSel
                            ? 'border-primary bg-primary text-primary-fg shadow-sm'
                            : s.ladiesOnly
                              ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
                              : 'border-success/50 bg-surface text-success hover:bg-success/10',
                      )}
                    >
                      <span>{s.seatNumber}</span>
                      {s.accessible && <Accessibility className="mt-0.5 h-3 w-3" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-success/50 bg-surface" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-primary" /> Selected</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded bg-surface-muted ring-1 ring-border" /> Booked</span>
        <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded border border-accent bg-accent/10" /> Ladies only</span>
        <span className="flex items-center gap-1.5"><Accessibility className="h-3.5 w-3.5" /> Accessible</span>
      </div>
    </div>
  );
}
