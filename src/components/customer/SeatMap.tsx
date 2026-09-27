import type { CSSProperties, ReactNode } from 'react';
import { Accessibility, Bath, Check, Coffee, DoorOpen } from 'lucide-react';

import type { SeatCell, SeatMapResponse } from '@/lib/api/booking-flow';
import { SEAT_TYPE_LABEL, cn } from '@/lib/utils';
import { TONE_LABEL, bookingTone, type SeatTone, type SeatView } from '@/lib/seat-tones';
import { FIXTURE_LABEL, type LayoutFixture } from '@/lib/seat-layout';

/**
 * The bus as it is laid out — the same map on every screen (customer, counter,
 * agent, operator chart, crew app, layout editor): one card per deck side by
 * side, the steering wheel on the lower deck, a chair for a seat, a berth for
 * a sleeper (standing or lying across the back row), the price on each free
 * seat, and who a seat is for (ladies seat, kept for women / men, booked by a
 * woman). Seats are buttons with the full state in their label.
 */

const TONE: Record<SeatTone, { box: string; text: string; pillow: string }> = {
  available: { box: 'border-[#1f9d55] bg-white', text: 'text-[#1f9d55]', pillow: 'bg-[#1f9d55]/25' },
  selected: { box: 'border-[#1f9d55] bg-[#1f9d55]', text: 'text-white', pillow: 'bg-white/70' },
  booked: { box: 'border-[#d4d7dd] bg-[#e5e7eb]', text: 'text-[#9aa0a9]', pillow: 'bg-[#cfd3d9]' },
  bookedFemale: { box: 'border-[#f4b6cc] bg-[#fbe1ea]', text: 'text-[#d9557f]', pillow: 'bg-[#f4b6cc]' },
  forFemale: { box: 'border-[#e8508a] bg-[#fff5f8]', text: 'text-[#e8508a]', pillow: 'bg-[#e8508a]/25' },
  forMale: { box: 'border-[#3b82f6] bg-[#f3f8ff]', text: 'text-[#3b82f6]', pillow: 'bg-[#3b82f6]/25' },
  blocked: { box: 'border-dashed border-[#c5c9d0] bg-[#f3f4f6]', text: 'text-[#9aa0a9]', pillow: 'bg-[#e5e7eb]' },
  pending: { box: 'border-[#f59e0b] bg-[#fff8eb]', text: 'text-[#b45309]', pillow: 'bg-[#f59e0b]/30' },
  boarded: { box: 'border-[#1f9d55] bg-[#1f9d55]', text: 'text-white', pillow: 'bg-white/70' },
  checkedOut: { box: 'border-[#64748b] bg-[#e2e8f0]', text: 'text-[#475569]', pillow: 'bg-[#94a3b8]' },
  noShow: { box: 'border-[#dc2626] bg-[#fef2f2]', text: 'text-[#dc2626]', pillow: 'bg-[#dc2626]/25' },
  empty: { box: 'border-[#d4d7dd] bg-white', text: 'text-[#9aa0a9]', pillow: 'bg-[#e5e7eb]' },
};

const rupees = (minor: number) => `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;

/** A steering wheel, drawn (lucide has none). */
function SteeringWheel({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-label="Driver">
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M3.2 10.5 9.9 11.4M20.8 10.5l-6.7.9M12 14.2v7.2" />
    </svg>
  );
}

/** Stairs to the upper deck, drawn. */
function Stairs({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 20h5v-5h5v-5h5V5h3" />
    </svg>
  );
}

/**
 * What is not a seat — driver, door, washroom, stairs, emergency exit,
 * pantry — drawn where the operator put it, so a passenger can see the
 * washroom is two rows behind their seat or the door is right beside it.
 */
export function FixtureTile({ kind, small }: { kind: LayoutFixture['kind']; small?: boolean }) {
  const icon = 'h-4 w-4 shrink-0 sm:h-5 sm:w-5';
  const body =
    kind === 'driver' ? <SteeringWheel className={icon} /> :
    kind === 'door' ? <DoorOpen className={icon} aria-hidden /> :
    kind === 'washroom' ? <Bath className={icon} aria-hidden /> :
    kind === 'staircase' ? <Stairs className={icon} /> :
    kind === 'pantry' ? <Coffee className={icon} aria-hidden /> :
    <span className="text-[8px] font-bold leading-none sm:text-[9px]">EXIT</span>;
  const tone = kind === 'emergency_exit' ? 'border-[#fca5a5] bg-[#fef2f2] text-[#dc2626]' : kind === 'washroom' ? 'border-[#bae6fd] bg-[#f0f9ff] text-[#0369a1]' : 'border-[#e5e7eb] bg-[#f8fafc] text-[#64748b]';
  return (
    <span className={cn('flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed', tone)} title={FIXTURE_LABEL[kind]}>
      {body}
      {!small && kind !== 'driver' && kind !== 'emergency_exit' && <span className="hidden text-[8px] font-medium leading-none sm:block">{kind === 'washroom' ? 'WC' : FIXTURE_LABEL[kind]}</span>}
    </span>
  );
}

/** A seat as a chair (seater / semi-sleeper), filled and outlined in its tone. */
function Chair({ tone, semi }: { tone: SeatTone; semi?: boolean }) {
  const t = TONE[tone];
  const filled = tone === 'selected' || tone === 'boarded';
  return (
    <svg viewBox="0 0 32 32" className={cn('h-full w-full', filled ? 'text-[#1f9d55]' : t.text)} aria-hidden>
      <path
        d={semi ? 'M8 2h16a3 3 0 0 1 3 3v16H5V5a3 3 0 0 1 3-3z' : 'M8 5h16a3 3 0 0 1 3 3v13H5V8a3 3 0 0 1 3-3z'}
        fill={filled ? 'currentColor' : tone === 'booked' || tone === 'bookedFemale' || tone === 'checkedOut' ? 'currentColor' : 'white'}
        fillOpacity={filled ? 1 : tone === 'booked' || tone === 'bookedFemale' || tone === 'checkedOut' ? 0.35 : 1}
        stroke="currentColor"
        strokeWidth={2}
      />
      <path
        d="M3 14a2 2 0 0 1 4 0v7h18v-7a2 2 0 0 1 4 0v11a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"
        fill={filled ? 'currentColor' : 'white'}
        stroke="currentColor"
        strokeWidth={2}
      />
    </svg>
  );
}

export function SeatMap({
  map,
  fares,
  selected = [],
  onToggle,
  onSeatClick,
  viewOf,
  priceFilter,
  onPriceFilter,
  disabled,
  legend = 'booking',
  compact,
}: {
  map: SeatMapResponse;
  /** Seat number → price (paise). */
  fares?: Map<string, number>;
  selected?: string[];
  /** Booking: a free seat was tapped. */
  onToggle?: (seat: SeatCell) => void;
  /** Crew / chart / editor: any seat was tapped. */
  onSeatClick?: (seat: SeatCell) => void;
  /** Crew / chart: how each seat looks (instead of the booking colours). */
  viewOf?: (seat: SeatCell) => SeatView;
  /** Price chips: show only seats at this price (null = all). */
  priceFilter?: number | null;
  onPriceFilter?: (p: number | null) => void;
  disabled?: boolean;
  legend?: 'booking' | 'crew' | 'none';
  compact?: boolean;
}) {
  const fixtures = map.layout.fixtures ?? [];
  const decks = Array.from({ length: Math.max(1, map.layout.decks) }, (_, d) => d).filter((d) =>
    map.seats.some((s) => s.deck === d) || fixtures.some((f) => f.deck === d),
  );
  // Each deck's own grid; older layouts share one size (rows from the seats).
  const gridOf = (deck: number) => {
    const g = map.layout.grids?.[deck];
    if (g) return g;
    const on = map.seats.filter((s) => s.deck === deck);
    return { rows: on.length ? Math.max(...on.map((s) => s.row + s.rowSpan)) : map.layout.rows, columns: map.layout.columns };
  };
  const hasDriver = fixtures.some((f) => f.kind === 'driver');
  const prices = fares
    ? [...new Set(map.seats.filter((s) => s.available).map((s) => fares.get(s.seatNumber)).filter((p): p is number => p !== undefined))].sort((a, b) => a - b)
    : [];
  // Cell size fits every deck side by side on a phone, and stays comfortable on a desktop.
  const totalCols = decks.reduce((n, d) => n + gridOf(d).columns, 0);
  const cell = compact ? '1.9rem' : `clamp(1.55rem, calc((100vw - ${decks.length * 3 + 3}rem) / ${totalCols}), 2.6rem)`;
  const style = { '--cell': cell, '--row': `calc(var(--cell) * 1.3)` } as CSSProperties;

  return (
    <div className="flex flex-col gap-3" style={style}>
      {onPriceFilter && prices.length > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Filter seats by price">
          <button type="button" onClick={() => onPriceFilter(null)} className={cn('rounded-pill border px-3 py-1 text-xs font-semibold', priceFilter == null ? 'border-[#e8508a] bg-[#fff5f8] text-[#e8508a]' : 'border-border bg-surface text-text')}>All</button>
          {prices.map((p) => (
            <button key={p} type="button" aria-pressed={priceFilter === p} onClick={() => onPriceFilter(priceFilter === p ? null : p)} className={cn('rounded-pill border px-3 py-1 text-xs font-semibold', priceFilter === p ? 'border-[#e8508a] bg-[#fff5f8] text-[#e8508a]' : 'border-border bg-surface text-text')}>
              {rupees(p)}
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-2 sm:gap-4">
        {decks.map((deck) => {
          const seats = map.seats.filter((s) => s.deck === deck);
          const { rows, columns } = gridOf(deck);
          return (
            <section key={deck} aria-label={deck === 0 ? 'Lower deck' : 'Upper deck'} className="rounded-2xl border border-border bg-surface p-2 shadow-sm sm:p-3">
              <header className="mb-2 flex items-center justify-between gap-2 px-0.5">
                <span className="text-[11px] font-semibold text-text sm:text-xs">{map.layout.decks > 1 ? (deck === 0 ? 'Lower deck' : 'Upper deck') : 'Seats'}</span>
                {deck === 0 && !hasDriver ? <SteeringWheel className="h-5 w-5 text-text-muted sm:h-6 sm:w-6" /> : <span className="h-5 w-5 sm:h-6 sm:w-6" />}
              </header>
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${columns}, var(--cell))`,
                  gridTemplateRows: `repeat(${rows}, var(--row))`,
                }}
              >
                {fixtures.filter((f) => f.deck === deck).map((f, i) => (
                  <div key={`f${i}`} aria-label={FIXTURE_LABEL[f.kind]} role="img" className="p-0.5"
                    style={{ gridColumn: `${f.column + 1} / span ${f.colSpan ?? 1}`, gridRow: `${f.row + 1} / span ${f.rowSpan ?? 1}` }}>
                    <FixtureTile kind={f.kind} small={(f.rowSpan ?? 1) * (f.colSpan ?? 1) === 1} />
                  </div>
                ))}
                {seats.map((s) => {
                  const isSel = selected.includes(s.seatNumber);
                  const view = viewOf?.(s);
                  const tone = view?.tone ?? bookingTone(s, isSel);
                  const price = fares?.get(s.seatNumber);
                  const dimmed = priceFilter != null && price !== priceFilter && s.available && !isSel;
                  const sleeper = s.seatType === 'sleeper';
                  const horizontal = sleeper && s.colSpan > s.rowSpan;
                  const clickable = view ? view.clickable !== false && Boolean(onSeatClick) : !disabled && s.available && Boolean(onToggle);
                  const caption = view?.caption ?? (s.available || isSel ? (price !== undefined ? rupees(price) : '') : '');
                  const t = TONE[tone];
                  const label = `${sleeper ? 'Berth' : 'Seat'} ${s.seatNumber}, ${SEAT_TYPE_LABEL[s.seatType] ?? s.seatType}${deck === 1 ? ', upper deck' : map.layout.decks > 1 ? ', lower deck' : ''}, ${TONE_LABEL[tone]}`
                    + (s.ladiesOnly ? ', ladies seat' : '') + (s.accessible ? ', accessible' : '')
                    + (price !== undefined && s.available ? `, ${rupees(price)}` : '') + (view?.caption ? `, ${view.caption}` : '');
                  const body: ReactNode = sleeper ? (
                    <span className={cn('relative block h-full w-full rounded-lg border-2', t.box)}>
                      <span className={cn('absolute rounded-full', t.pillow, horizontal ? 'left-1 top-1/2 h-2/3 w-1.5 -translate-y-1/2' : 'bottom-1 left-1/2 h-1.5 w-2/3 -translate-x-1/2')} />
                      <span className={cn('absolute inset-x-0 top-1 text-center text-[9px] font-semibold leading-none sm:text-[10px]', t.text, horizontal && 'top-1/2 -translate-y-1/2')}>{s.seatNumber}</span>
                      {caption && <span className={cn('absolute inset-x-0 text-center text-[9px] font-semibold leading-none sm:text-[10px]', t.text, horizontal ? 'bottom-0.5 left-3' : 'top-1/2 -translate-y-1/2')}>{caption}</span>}
                    </span>
                  ) : (
                    <span className="flex h-full w-full flex-col items-center">
                      <span className={cn('relative block aspect-square w-full', tone === 'blocked' && 'opacity-50')}>
                        <Chair tone={tone} semi={s.seatType === 'semi_sleeper'} />
                        <span className={cn('absolute inset-x-0 top-[30%] text-center text-[8px] font-semibold leading-none sm:text-[9px]', tone === 'selected' || tone === 'boarded' ? 'text-white' : t.text)}>{s.seatNumber}</span>
                      </span>
                      {caption && <span className={cn('mt-0.5 truncate text-center text-[8px] font-semibold leading-none sm:text-[9px]', tone === 'selected' ? 'text-[#1f9d55]' : t.text === 'text-white' ? 'text-[#1f9d55]' : t.text)}>{caption}</span>}
                    </span>
                  );
                  return (
                    <button
                      key={`${s.deck}:${s.row}:${s.column}`}
                      type="button"
                      disabled={!clickable}
                      aria-pressed={view ? undefined : isSel}
                      aria-label={label}
                      title={label}
                      onClick={() => (view ? onSeatClick?.(s) : onToggle?.(s))}
                      style={{ gridColumn: `${s.column + 1} / span ${s.colSpan}`, gridRow: `${s.row + 1} / span ${s.rowSpan}` }}
                      className={cn(
                        'relative rounded-lg p-0 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e8508a]',
                        clickable ? 'cursor-pointer hover:-translate-y-px' : 'cursor-default',
                        dimmed && 'opacity-25',
                      )}
                    >
                      {body}
                      {s.accessible && <Accessibility className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-white text-[#3b82f6]" aria-hidden />}
                      {(s.ladiesOnly || s.reservedFor === 'female') && s.available && !isSel && !view && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#e8508a]" aria-hidden />}
                      {view?.badge && <span className="absolute -right-1 -top-1 rounded-full bg-[#111827] px-1 text-[8px] font-bold leading-[14px] text-white">{view.badge}</span>}
                      {tone === 'checkedOut' && <Check className="absolute bottom-0 right-0 h-3 w-3 text-[#475569]" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {legend !== 'none' && <SeatLegend kind={legend} rule={map.seatRule} />}
    </div>
  );
}

/** The key under the map: every state a seat can be in on this screen. */
export function SeatLegend({ kind, rule }: { kind: 'booking' | 'crew'; rule?: string }) {
  const tones: SeatTone[] = kind === 'crew'
    ? ['pending', 'boarded', 'checkedOut', 'noShow', 'empty']
    : ['available', 'selected', 'forFemale', ...(rule === 'both' ? (['forMale'] as SeatTone[]) : []), 'bookedFemale', 'booked'];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-text-muted">
      {tones.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className="block h-4 w-4"><Chair tone={t} /></span>
          {TONE_LABEL[t]}
        </span>
      ))}
      {kind === 'booking' && (
        <span className="flex items-center gap-1.5"><span className={cn('relative block h-5 w-3 rounded border-2', TONE.available.box)} /> Sleeper</span>
      )}
      {kind === 'booking' && <span className="flex items-center gap-1.5"><Accessibility className="h-3.5 w-3.5 text-[#3b82f6]" /> Accessible</span>}
    </div>
  );
}

/** A custom key (e.g. the operator's chart): the seat drawn in each tone, with its label. */
export function SeatLegendRow({ items }: { items: [SeatTone, string][] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-text-muted">
      {items.map(([t, l]) => (
        <span key={t} className="flex items-center gap-1.5"><span className="block h-4 w-4"><Chair tone={t} /></span>{l}</span>
      ))}
    </div>
  );
}
