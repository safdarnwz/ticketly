/**
 * The seat layout an operator builds once per bus model — and every screen
 * then draws (booking, counter, agent, chart, crew app).
 *
 * A deck is a grid of rows (front → back) and columns (left → right, the
 * aisle is an empty column). On it sit seats — a seater or semi-sleeper
 * takes one cell, a sleeper berth two (standing along the bus, or lying
 * across it at the back) — and fixtures: the driver, doors, a washroom
 * (mid-coach on a Volvo multi-axle, at the back on the right in others,
 * none in many), the staircase, an emergency exit, a pantry. Each deck has
 * its own rows and columns.
 *
 * Seat numbers follow the common Indian bus convention:
 *   - seaters and semi-sleepers 1, 2, 3 … front to back, left to right;
 *   - sleeper berths L1, L2 … on the lower deck and U1, U2 … on the upper;
 *   - or airline style — row number + seat letter (1A 1B 1C 1D), berths L1A;
 *   - or one running count 1 … N over both decks.
 * Generated numbers can be changed by hand, seat by seat.
 */

export type SeatKind = 'seater' | 'semi_sleeper' | 'sleeper' | 'crew';
export type FixtureKind = 'driver' | 'door' | 'washroom' | 'staircase' | 'emergency_exit' | 'pantry';
export type SeatPosition = 'window' | 'aisle' | 'front';
export type Deck = 0 | 1;

export interface LayoutSeat {
  number: string;
  deck: Deck;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
  type: SeatKind;
  ladiesOnly?: boolean;
  accessible?: boolean;
  bookable?: boolean;
  position?: SeatPosition;
}

export interface LayoutFixture {
  kind: FixtureKind;
  deck: Deck;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
}

export interface DeckGrid { rows: number; columns: number }

export interface LayoutDraft {
  decks: 1 | 2;
  grids: DeckGrid[];
  seats: LayoutSeat[];
  fixtures: LayoutFixture[];
}

export const MAX_ROWS = 40;
export const MAX_COLUMNS = 12;
export const SEAT_NUMBER_RE = /^[A-Za-z0-9-]{1,6}$/;

export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  driver: 'Driver',
  door: 'Door',
  washroom: 'Washroom',
  staircase: 'Stairs',
  emergency_exit: 'Emergency exit',
  pantry: 'Pantry',
};

export const span = (x: { rowSpan?: number; colSpan?: number }) => ({ rows: x.rowSpan ?? 1, cols: x.colSpan ?? 1 });

const covers = (x: { deck: number; row: number; column: number; rowSpan?: number; colSpan?: number }, deck: number, r: number, c: number) =>
  x.deck === deck && r >= x.row && r < x.row + (x.rowSpan ?? 1) && c >= x.column && c < x.column + (x.colSpan ?? 1);

/** What sits on a cell (a seat or a fixture covering it), if anything. */
export function occupantAt(d: LayoutDraft, deck: number, r: number, c: number): { kind: 'seat'; index: number } | { kind: 'fixture'; index: number } | null {
  const s = d.seats.findIndex((x) => covers(x, deck, r, c));
  if (s >= 0) return { kind: 'seat', index: s };
  const f = d.fixtures.findIndex((x) => covers(x, deck, r, c));
  if (f >= 0) return { kind: 'fixture', index: f };
  return null;
}

type Box = { deck: Deck; row: number; column: number; rowSpan?: number; colSpan?: number };
const overlaps = (a: Box, b: Box) =>
  a.deck === b.deck &&
  a.row < b.row + (b.rowSpan ?? 1) && b.row < a.row + (a.rowSpan ?? 1) &&
  a.column < b.column + (b.colSpan ?? 1) && b.column < a.column + (a.colSpan ?? 1);

/** Why a box cannot go on its deck (off the grid), or null. */
export function outOfGrid(d: LayoutDraft, b: Box): string | null {
  const g = d.grids[b.deck];
  if (!g) return 'That deck does not exist';
  const { rows, cols } = span(b);
  if (b.row < 0 || b.column < 0 || b.row + rows > g.rows) return 'It does not fit — add a row at the back first';
  if (b.column + cols > g.columns) return 'It does not fit — add a column first';
  return null;
}

/**
 * Put a seat or a fixture on the grid. Whatever it lands on is replaced
 * (painting a washroom over two seats removes them), and a seat keeps its
 * number when it is only re-shaped in place.
 */
export function placeItem(d: LayoutDraft, item: { seat: Omit<LayoutSeat, 'number'> & { number?: string } } | { fixture: LayoutFixture }): { draft: LayoutDraft; error?: string } {
  const box: Box = 'seat' in item ? item.seat : item.fixture;
  const problem = outOfGrid(d, box);
  if (problem) return { draft: d, error: problem };
  if ('fixture' in item && item.fixture.kind === 'staircase' && d.decks < 2) return { draft: d, error: 'Stairs need an upper deck' };
  const replaced = d.seats.find((s) => s.deck === box.deck && s.row === box.row && s.column === box.column);
  const seats = d.seats.filter((s) => !overlaps(s, box));
  let fixtures = d.fixtures.filter((f) => !overlaps(f, box));
  if ('fixture' in item) {
    if (item.fixture.kind === 'driver') fixtures = fixtures.filter((f) => f.kind !== 'driver'); // one driver
    return { draft: { ...d, seats, fixtures: [...fixtures, clean(item.fixture)] } };
  }
  const number = item.seat.number ?? replaced?.number ?? nextFreeNumber({ ...d, seats }, item.seat);
  const seat: LayoutSeat = clean({ ...item.seat, number, bookable: item.seat.type === 'crew' ? false : item.seat.bookable });
  return { draft: { ...d, seats: [...seats, seat], fixtures } };
}

function clean<T extends { rowSpan?: number; colSpan?: number }>(x: T): T {
  const out = { ...x };
  if (!out.rowSpan || out.rowSpan <= 1) delete out.rowSpan;
  if (!out.colSpan || out.colSpan <= 1) delete out.colSpan;
  return out;
}

/** Remove whatever covers a cell. */
export function clearCell(d: LayoutDraft, deck: number, r: number, c: number): LayoutDraft {
  return { ...d, seats: d.seats.filter((x) => !covers(x, deck, r, c)), fixtures: d.fixtures.filter((x) => !covers(x, deck, r, c)) };
}

/** A number for a new seat that nobody has yet, in the standard style. */
function nextFreeNumber(d: LayoutDraft, s: { type: SeatKind; deck: Deck }): string {
  const taken = new Set(d.seats.map((x) => x.number.toUpperCase()));
  const prefix = s.type === 'crew' ? 'C' : s.type === 'sleeper' ? (s.deck === 1 ? 'U' : 'L') : '';
  for (let n = 1; n < 1000; n += 1) if (!taken.has(`${prefix}${n}`)) return `${prefix}${n}`;
  return `${prefix}X`;
}

// ── Rows and columns ────────────────────────────────────────────────────────

/** Change a deck's size; seats and fixtures that no longer fit are reported, not silently dropped. */
export function resizeDeck(d: LayoutDraft, deck: Deck, grid: DeckGrid): { draft: LayoutDraft; error?: string } {
  if (grid.rows < 1 || grid.rows > MAX_ROWS) return { draft: d, error: `1 to ${MAX_ROWS} rows` };
  if (grid.columns < 1 || grid.columns > MAX_COLUMNS) return { draft: d, error: `1 to ${MAX_COLUMNS} columns` };
  const next = { ...d, grids: d.grids.map((g, i) => (i === deck ? grid : g)) };
  const cut = [...d.seats, ...d.fixtures].filter((x) => x.deck === deck && outOfGrid(next, x));
  if (cut.length) return { draft: d, error: `Clear the ${cut.length} seat(s) or fixture(s) at the edge first` };
  return { draft: next };
}

/** Insert an empty row before `at` (or a column), shifting everything behind it. */
export function insertLine(d: LayoutDraft, deck: Deck, axis: 'row' | 'column', at: number): { draft: LayoutDraft; error?: string } {
  const g = d.grids[deck];
  const size = axis === 'row' ? { ...g, rows: g.rows + 1 } : { ...g, columns: g.columns + 1 };
  if (size.rows > MAX_ROWS || size.columns > MAX_COLUMNS) return { draft: d, error: axis === 'row' ? `At most ${MAX_ROWS} rows` : `At most ${MAX_COLUMNS} columns` };
  const key = axis === 'row' ? 'row' : 'column';
  const shift = <T extends Box>(x: T): T => (x.deck === deck && x[key] >= at ? { ...x, [key]: x[key] + 1 } : x);
  // Something spanning across the insertion point would be torn in two.
  const torn = [...d.seats, ...d.fixtures].some((x) => x.deck === deck && x[key] < at && x[key] + (axis === 'row' ? x.rowSpan ?? 1 : x.colSpan ?? 1) > at);
  if (torn) return { draft: d, error: 'A berth or fixture crosses that line — insert next to it instead' };
  return { draft: { ...d, grids: d.grids.map((x, i) => (i === deck ? size : x)), seats: d.seats.map(shift), fixtures: d.fixtures.map(shift) } };
}

/** Delete a row or column; it must be empty. */
export function deleteLine(d: LayoutDraft, deck: Deck, axis: 'row' | 'column', at: number): { draft: LayoutDraft; error?: string } {
  const g = d.grids[deck];
  if ((axis === 'row' ? g.rows : g.columns) <= 1) return { draft: d, error: `A deck needs at least one ${axis}` };
  const key = axis === 'row' ? 'row' : 'column';
  const inLine = [...d.seats, ...d.fixtures].some((x) => x.deck === deck && x[key] <= at && x[key] + (axis === 'row' ? x.rowSpan ?? 1 : x.colSpan ?? 1) > at);
  if (inLine) return { draft: d, error: `Clear that ${axis} first` };
  const shift = <T extends Box>(x: T): T => (x.deck === deck && x[key] > at ? { ...x, [key]: x[key] - 1 } : x);
  const size = axis === 'row' ? { ...g, rows: g.rows - 1 } : { ...g, columns: g.columns - 1 };
  return { draft: { ...d, grids: d.grids.map((x, i) => (i === deck ? size : x)), seats: d.seats.map(shift), fixtures: d.fixtures.map(shift) } };
}

/** Add or remove the upper deck. */
export function setDecks(d: LayoutDraft, decks: 1 | 2): { draft: LayoutDraft; error?: string } {
  if (decks === d.decks) return { draft: d };
  if (decks === 2) return { draft: { ...d, decks: 2, grids: [d.grids[0], { rows: Math.min(d.grids[0].rows, 8), columns: d.grids[0].columns }] } };
  if (d.seats.some((s) => s.deck === 1) || d.fixtures.some((f) => f.deck === 1)) return { draft: d, error: 'Clear the upper deck first' };
  return { draft: { decks: 1, grids: [d.grids[0]], seats: d.seats, fixtures: d.fixtures.filter((f) => f.kind !== 'staircase') } };
}

// ── Numbering ───────────────────────────────────────────────────────────────

export type NumberingPreset = 'standard' | 'airline' | 'continuous';
export interface NumberingOptions {
  preset: NumberingPreset;
  /** Across each row left → right (the usual default), or down each column front → back. */
  direction: 'rows' | 'columns';
  start: number;
  lowerPrefix: string;
  upperPrefix: string;
  seaterPrefix: string;
  /** Number only seats without a number, keep the rest. */
  onlyBlank?: boolean;
}

export const DEFAULT_NUMBERING: NumberingOptions = { preset: 'standard', direction: 'rows', start: 1, lowerPrefix: 'L', upperPrefix: 'U', seaterPrefix: '' };

export const NUMBERING_PRESETS: { id: NumberingPreset; label: string; example: string }[] = [
  { id: 'standard', label: 'Standard (1, 2, 3 · L1 · U1)', example: 'Seats 1, 2, 3 · berths L1, L2 · U1, U2' },
  { id: 'airline', label: 'Row + letter', example: '1A 1B 1C 1D · berths L1A, U1A' },
  { id: 'continuous', label: 'One running count', example: '1 … N over both decks' },
];

const LETTERS = 'ABCDEFGHIJKL';

/** Number every passenger seat (and crew seat) by the chosen scheme. */
export function autoNumber(d: LayoutDraft, o: NumberingOptions): LayoutDraft {
  const start = Math.max(0, Math.floor(o.start || 1));
  const order = (a: LayoutSeat, b: LayoutSeat) =>
    a.deck - b.deck || (o.direction === 'rows' ? a.row - b.row || a.column - b.column : a.column - b.column || a.row - b.row);
  const sorted = d.seats.map((s, i) => ({ s, i })).sort((a, b) => order(a.s, b.s));
  const out = d.seats.map((s) => ({ ...s }));
  const keep = new Set(o.onlyBlank ? d.seats.filter((s) => s.number.trim()).map((s) => s.number.toUpperCase()) : []);
  const fresh = (make: () => string) => {
    let n = make();
    while (keep.has(n.toUpperCase())) n = make();
    keep.add(n.toUpperCase());
    return n;
  };
  let seatN = start;
  let crewN = 1;
  const berthN: Record<number, number> = { 0: start, 1: start };
  let allN = start;
  // Airline style: passenger rows counted per deck from the first row with a seat.
  const rowRank = new Map<string, number>();
  for (const deck of [0, 1]) {
    const rows = [...new Set(d.seats.filter((s) => s.deck === deck && s.type !== 'crew').map((s) => s.row))].sort((a, b) => a - b);
    rows.forEach((r, i) => rowRank.set(`${deck}:${r}`, i + start));
  }
  const letterIn = new Map<string, number>();
  for (const { s, i } of sorted) {
    if (o.onlyBlank && s.number.trim()) continue;
    if (s.type === 'crew') { out[i].number = fresh(() => `C${crewN++}`); continue; }
    const berth = s.type === 'sleeper';
    const deckPrefix = s.deck === 1 ? o.upperPrefix : o.lowerPrefix;
    if (o.preset === 'continuous') out[i].number = fresh(() => `${allN++}`);
    else if (o.preset === 'airline') {
      const rowKey = `${s.deck}:${s.row}`;
      out[i].number = fresh(() => {
        const k = letterIn.get(rowKey) ?? 0;
        letterIn.set(rowKey, k + 1);
        return `${berth ? deckPrefix : o.seaterPrefix}${rowRank.get(rowKey)}${LETTERS[k] ?? 'Z'}`;
      });
    } else if (berth) out[i].number = fresh(() => `${deckPrefix}${berthN[s.deck]++}`);
    else out[i].number = fresh(() => `${o.seaterPrefix}${seatN++}`);
  }
  // Airline letters go left → right within a row whatever the direction chosen.
  return { ...d, seats: out };
}

/** Seat numbers that are empty, badly formed or used twice (case-insensitive). */
export function numberProblems(d: LayoutDraft): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Map<string, number>();
  d.seats.forEach((s, i) => {
    const n = s.number.trim();
    if (!n) return problems.set(i, 'No number');
    if (!SEAT_NUMBER_RE.test(n)) return problems.set(i, 'Letters, digits and - only, up to 6');
    const k = n.toUpperCase();
    if (seen.has(k)) { problems.set(i, `Same as another seat`); problems.set(seen.get(k)!, 'Same as another seat'); }
    else seen.set(k, i);
  });
  return problems;
}

// ── Window / aisle ──────────────────────────────────────────────────────────

/** In each row the outermost seats are window seats; a seat beside the aisle gap is an aisle seat. */
export function autoPositions(d: LayoutDraft): LayoutDraft {
  const seats = d.seats.map((s) => ({ ...s }));
  const byRow = new Map<string, number[]>();
  seats.forEach((s, i) => { if (s.type !== 'crew') byRow.set(`${s.deck}:${s.row}`, [...(byRow.get(`${s.deck}:${s.row}`) ?? []), i]); });
  for (const idx of byRow.values()) {
    const taken = new Set<number>();
    for (const i of idx) for (let c = seats[i].column; c < seats[i].column + (seats[i].colSpan ?? 1); c++) taken.add(c);
    const min = Math.min(...taken);
    const max = Math.max(...taken);
    for (const i of idx) {
      const s = seats[i];
      const left = s.column - 1;
      const right = s.column + (s.colSpan ?? 1);
      if (s.column === min || right - 1 === max) s.position = 'window';
      else if ((left >= min && !taken.has(left)) || (right <= max && !taken.has(right))) s.position = 'aisle';
      else delete s.position;
    }
  }
  return { ...d, seats };
}

// ── To and from the API ─────────────────────────────────────────────────────

export interface SeatMapPayload {
  decks: number;
  rows: number;
  columns: number;
  deckGrids: DeckGrid[];
  seats: LayoutSeat[];
  fixtures: LayoutFixture[];
}

export function toPayload(d: LayoutDraft): SeatMapPayload {
  const grids = d.grids.slice(0, d.decks);
  return {
    decks: d.decks,
    rows: Math.max(...grids.map((g) => g.rows)),
    columns: Math.max(...grids.map((g) => g.columns)),
    deckGrids: grids,
    seats: d.seats.map((s) => {
      const out: LayoutSeat = { ...s, number: s.number.trim() };
      if (!out.ladiesOnly) delete out.ladiesOnly;
      if (!out.accessible) delete out.accessible;
      if (out.type === 'crew') out.bookable = false;
      else if (out.bookable !== false) delete out.bookable;
      if (!out.position) delete out.position;
      return clean(out);
    }),
    fixtures: d.fixtures.map(clean),
  };
}

export function fromPayload(raw: unknown): LayoutDraft {
  const m = raw as Partial<SeatMapPayload> & { rows: number; columns: number; decks: number };
  const decks = (m.decks === 2 ? 2 : 1) as 1 | 2;
  const grids = m.deckGrids?.length === decks ? m.deckGrids : Array.from({ length: decks }, () => ({ rows: m.rows, columns: m.columns }));
  return { decks, grids, seats: (m.seats ?? []).map((s) => ({ ...s })), fixtures: (m.fixtures ?? []).map((f) => ({ ...f })) };
}

// ── Templates: common Indian coaches, ready to adjust ──────────────────────

type Cell = { type: SeatKind; rowSpan?: number; colSpan?: number } | { fixture: FixtureKind; rowSpan?: number; colSpan?: number } | null;

function fromRows(decks: 1 | 2, grids: DeckGrid[], cellAt: (deck: Deck, r: number, c: number) => Cell): LayoutDraft {
  let d: LayoutDraft = { decks, grids, seats: [], fixtures: [] };
  for (let deck = 0 as Deck; deck < decks; deck = (deck + 1) as Deck)
    for (let r = 0; r < grids[deck].rows; r++)
      for (let c = 0; c < grids[deck].columns; c++) {
        const x = cellAt(deck, r, c);
        if (!x) continue;
        d = 'fixture' in x
          ? placeItem(d, { fixture: { kind: x.fixture, deck, row: r, column: c, rowSpan: x.rowSpan, colSpan: x.colSpan } }).draft
          : { ...d, seats: [...d.seats, clean({ number: '', deck, row: r, column: c, type: x.type, rowSpan: x.rowSpan, colSpan: x.colSpan, ...(x.type === 'crew' ? { bookable: false } : {}) })] };
      }
  return autoPositions(autoNumber(d, DEFAULT_NUMBERING));
}

export const LAYOUT_TEMPLATES: { id: string; label: string; describe: string; build: () => LayoutDraft }[] = [
  {
    id: 'seater-2x2', label: '2+2 Seater', describe: '41 seats, door front-left, 5 across the back',
    // Row 0: door on the left, driver on the right. Last row: 5 seats across the aisle.
    build: () => fromRows(1, [{ rows: 11, columns: 5 }], (_d, r, c) => {
      if (r === 0) return c === 0 ? { fixture: 'door' } : c === 4 ? { fixture: 'driver' } : null;
      if (r === 10) return { type: 'seater' };
      return c === 2 ? null : { type: 'seater' };
    }),
  },
  {
    id: 'volvo-2x2-wc', label: 'Volvo multi-axle 2+2 with washroom', describe: '2+2 seater, washroom mid-coach on the right, rear door',
    build: () => fromRows(1, [{ rows: 14, columns: 5 }], (_d, r, c) => {
      if (r === 0) return c === 0 ? { fixture: 'door' } : c === 4 ? { fixture: 'driver' } : null;
      if (r === 7 && c === 3) return { fixture: 'washroom', rowSpan: 2, colSpan: 2 };
      if ((r === 7 || r === 8) && c >= 3) return null;
      if (r === 8 && c === 0) return { fixture: 'door' };
      if (r === 13) return { type: 'seater' };
      return c === 2 ? null : { type: 'seater' };
    }),
  },
  {
    id: 'sleeper-2x1', label: '2+1 Sleeper', describe: 'Lower + upper deck, single berths left, double right, 30 berths',
    build: () => fromRows(2, [{ rows: 11, columns: 4 }, { rows: 10, columns: 4 }], (deck, r, c) => {
      if (deck === 0 && r === 0) return c === 0 ? { fixture: 'door' } : c === 3 ? { fixture: 'driver' } : null;
      const rr = deck === 0 ? r - 1 : r;
      if (rr < 0 || rr % 2 === 1 || c === 1) return null;
      return { type: 'sleeper', rowSpan: 2 };
    }),
  },
  {
    id: 'sleeper-2x1-back', label: '2+1 Sleeper, berths across the back', describe: 'Like 2+1 sleeper, last row two berths lying across',
    build: () => fromRows(2, [{ rows: 11, columns: 4 }, { rows: 10, columns: 4 }], (deck, r, c) => {
      if (deck === 0 && r === 0) return c === 0 ? { fixture: 'door' } : c === 3 ? { fixture: 'driver' } : null;
      const last = deck === 0 ? 10 : 9;
      if (r === last) return c === 0 || c === 2 ? { type: 'sleeper', colSpan: 2 } : null;
      const rr = deck === 0 ? r - 1 : r;
      if (rr < 0 || rr % 2 === 1 || c === 1 || r + 1 >= last) return null;
      return { type: 'sleeper', rowSpan: 2 };
    }),
  },
  {
    id: 'seater-sleeper', label: 'Seater + sleeper', describe: '2+2 seats downstairs, 2+1 berths upstairs, stairs at the door',
    build: () => fromRows(2, [{ rows: 11, columns: 5 }, { rows: 10, columns: 4 }], (deck, r, c) => {
      if (deck === 0) {
        if (r === 0) return c === 0 ? { fixture: 'door' } : c === 4 ? { fixture: 'driver' } : null;
        if (r === 1 && c === 0) return { fixture: 'staircase' };
        if (r === 1 && c === 1) return null;
        if (r === 10) return { type: 'seater' };
        return c === 2 ? null : { type: 'seater' };
      }
      if (r % 2 === 1 || c === 1) return null;
      return { type: 'sleeper', rowSpan: 2 };
    }),
  },
  {
    id: 'semi-2x1', label: '2+1 Semi-sleeper', describe: 'Push-back seats, 1 left and 2 right, washroom at the back right',
    build: () => fromRows(1, [{ rows: 13, columns: 4 }], (_d, r, c) => {
      if (r === 0) return c === 0 ? { fixture: 'door' } : c === 3 ? { fixture: 'driver' } : null;
      if (r === 11 && c === 2) return { fixture: 'washroom', rowSpan: 2, colSpan: 2 };
      if (r >= 11 && c >= 2) return null;
      return c === 1 ? null : { type: 'semi_sleeper' };
    }),
  },
  {
    id: 'sleeper-1x1', label: '1+1 Luxury sleeper', describe: 'Single berths on both sides, both decks',
    build: () => fromRows(2, [{ rows: 11, columns: 3 }, { rows: 10, columns: 3 }], (deck, r, c) => {
      if (deck === 0 && r === 0) return c === 0 ? { fixture: 'door' } : c === 2 ? { fixture: 'driver' } : null;
      const rr = deck === 0 ? r - 1 : r;
      if (rr < 0 || rr % 2 === 1 || c === 1) return null;
      return { type: 'sleeper', rowSpan: 2 };
    }),
  },
  {
    id: 'blank', label: 'Blank — draw your own', describe: 'Pick rows and columns, then place every seat',
    build: () => ({ decks: 1, grids: [{ rows: 10, columns: 5 }], seats: [], fixtures: [] }),
  },
];

// ── Drag and drop ──────────────────────────────────────────────────────────

export type ItemRef = { kind: 'seat' | 'fixture'; index: number };

/**
 * Move a placed seat or fixture to another cell (or deck). It keeps its
 * number, type and marks. Dropping it on top of something else is refused —
 * nothing is ever removed by a drag.
 */
export function moveItem(d: LayoutDraft, ref: ItemRef, to: { deck: Deck; row: number; column: number }): { draft: LayoutDraft; error?: string } {
  const item = ref.kind === 'seat' ? d.seats[ref.index] : d.fixtures[ref.index];
  if (!item) return { draft: d };
  if (item.deck === to.deck && item.row === to.row && item.column === to.column) return { draft: d };
  const moved = { ...item, deck: to.deck, row: to.row, column: to.column };
  const rest: LayoutDraft = ref.kind === 'seat'
    ? { ...d, seats: d.seats.filter((_, i) => i !== ref.index) }
    : { ...d, fixtures: d.fixtures.filter((_, i) => i !== ref.index) };
  const off = outOfGrid(rest, moved);
  if (off) return { draft: d, error: off };
  if ([...rest.seats, ...rest.fixtures].some((x) => overlaps(x, moved)))
    return { draft: d, error: 'Something is already there — drop it on an empty spot' };
  if (ref.kind === 'fixture' && (moved as LayoutFixture).kind === 'staircase' && d.decks < 2) return { draft: d, error: 'Stairs need an upper deck' };
  return ref.kind === 'seat'
    ? { draft: { ...rest, seats: [...rest.seats, moved as LayoutSeat] } }
    : { draft: { ...rest, fixtures: [...rest.fixtures, moved as LayoutFixture] } };
}

// ── The rules a coach is checked against ───────────────────────────────────

export interface LayoutCheck { ok: boolean; label: string; detail: string }

/**
 * What the operator should see before saving: the things passengers, the
 * crew and the bus-body and accessibility rules expect on a coach. None of
 * them blocks saving — a mini-bus may really have no washroom — but each is
 * shown with what to do.
 */
export function layoutChecks(d: LayoutDraft): LayoutCheck[] {
  const passenger = d.seats.filter((s) => s.type !== 'crew' && s.bookable !== false);
  const ladies = passenger.filter((s) => s.ladiesOnly).length;
  const accessible = passenger.filter((s) => s.accessible);
  const doors = d.fixtures.filter((f) => f.kind === 'door');
  const nearDoor = (s: LayoutSeat) => doors.some((f) => f.deck === s.deck && Math.abs(f.row - s.row) <= 2);
  const exits = d.fixtures.filter((f) => f.kind === 'emergency_exit').length;
  const upperSeats = passenger.filter((s) => s.deck === 1).length;
  return [
    { ok: d.fixtures.some((f) => f.kind === 'driver'), label: 'Driver seat placed', detail: 'Shows passengers where the front of the bus is.' },
    { ok: doors.some((f) => f.deck === 0), label: 'Door on the lower deck', detail: 'Place the entry door (and the rear door if the bus has one).' },
    { ok: passenger.length <= 22 || exits > 0, label: 'Emergency exit marked', detail: `Bus body rules ask for emergency exits on coaches of this size${passenger.length ? ` (${passenger.length} seats)` : ''}.` },
    { ok: ladies > 0, label: `Ladies seats marked (${ladies})`, detail: 'State transport rules reserve seats for women — mark them; bookings then keep them for women.' },
    { ok: accessible.length > 0 && accessible.some(nearDoor), label: `Seat for a passenger with a disability${accessible.length ? ', near the door' : ''}`, detail: accessible.length ? 'Keep it within two rows of a door so a wheelchair user can reach it.' : 'Mark at least one seat near the door as disability-friendly.' },
    { ok: d.decks < 2 || upperSeats > 0, label: 'Upper deck has seats', detail: 'An upper deck with nothing to sell — add berths or make it a single deck.' },
    { ok: numberProblems(d).size === 0 && passenger.every((s) => s.number.trim()), label: 'Every seat has its own number', detail: 'Fix the seats shown in red.' },
  ];
}
