import { DomainError, ErrorCode, type Json } from '@kernel';

/**
 * ============================================================================
 *  Seat-map — the canonical bus layout model
 * ============================================================================
 *
 * A bus layout is the single most fiddly piece of master data in the domain,
 * and everything downstream depends on it being correct:
 *   - inventory (Part 5) allocates one availability bit per seat;
 *   - pricing (Part 6) can price by seat type / deck / position;
 *   - the booking UI renders it as a clickable grid;
 *   - the manifest (Part 9) lists passengers by seat number.
 *
 * So it is modelled as an immutable, self-validating value object. Once a
 * `SeatMap` is constructed it is GUARANTEED to be internally consistent:
 *   - seat numbers are unique;
 *   - no two seats occupy the same (deck,row,column) cell;
 *   - coordinates are within the declared grid;
 *   - counts (total / sleeper / seater / ladies) are derived, never trusted.
 *
 * COORDINATE SYSTEM
 *   deck   : 0 = lower, 1 = upper (double-decker / sleeper coaches)
 *   row    : 0-based, front → back
 *   column : 0-based, left → right (aisle is a gap in the column sequence)
 *   A sleeper berth can span two rows (rowSpan = 2) standing along the bus,
 *   or two columns (colSpan = 2) lying across it; a seat spans one cell.
 *   Each deck may have its own grid (`deckGrids`): a seater lower deck under
 *   a sleeper upper deck rarely has the same number of rows or columns.
 *
 * FIXTURES
 *   What is not a seat but takes floor space and helps a passenger find
 *   their way: the driver, the door(s), a washroom (in the middle of a
 *   Volvo multi-axle, at the back on the right of another coach, none in
 *   many), the staircase to the upper deck, an emergency exit, a pantry.
 *   They are placed on the grid like seats and may not overlap anything.
 *
 * This model is intentionally UI-agnostic: it stores logical grid coordinates,
 * not pixels, so any front-end can render it.
 */

export type SeatType = 'seater' | 'sleeper' | 'semi_sleeper' | 'crew';
export type SeatDeck = 0 | 1;
export type SeatFacing = 'front' | 'aisle' | 'window';

export interface SeatCell {
  /** Passenger-facing seat number, e.g. "L1", "U12", "A3". Unique in the map. */
  number: string;
  deck: SeatDeck;
  row: number;
  column: number;
  /** Cells a berth occupies (sleepers are usually 1×2). Defaults to 1×1. */
  rowSpan?: number;
  colSpan?: number;
  type: SeatType;
  /** A seat reservable only by female passengers (regulatory in some states). */
  ladiesOnly?: boolean;
  /** Disabled/crew/unavailable cell that still occupies grid space. */
  bookable?: boolean;
  /** Window / aisle (#136, #137) — set by hand or derived with `withAutoPositions`. */
  position?: SeatFacing;
  /** Disability-friendly seat (#141): kept for passengers in the 'disabled' category until release (#294). */
  accessible?: boolean;
}

/** Attributes an operator can set on many seats at once. */
export interface SeatAttributePatch {
  position?: SeatFacing | null;
  ladiesOnly?: boolean;
  accessible?: boolean;
}

export type FixtureKind =
  'driver' | 'door' | 'washroom' | 'staircase' | 'emergency_exit' | 'pantry';

export const FIXTURE_KINDS: readonly FixtureKind[] = [
  'driver',
  'door',
  'washroom',
  'staircase',
  'emergency_exit',
  'pantry',
];

export interface Fixture {
  kind: FixtureKind;
  deck: SeatDeck;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
}

export interface DeckGrid {
  rows: number;
  columns: number;
}

export interface SeatMapProps {
  decks: number; // 1 or 2
  /** Grid height — the largest deck's when `deckGrids` is given. */
  rows: number;
  /** Grid width — the largest deck's when `deckGrids` is given. */
  columns: number;
  /** Each deck's own grid (lower first); absent = every deck is rows × columns. */
  deckGrids?: DeckGrid[];
  seats: SeatCell[];
  fixtures?: Fixture[];
}

export interface SeatMapSummary {
  totalSeats: number;
  bookableSeats: number;
  seater: number;
  sleeper: number;
  semiSleeper: number;
  /** Driver/conductor cells — occupy grid space but are NEVER sellable, and excluded from every other count (not seater/sleeper/semi, never in inventory). */
  crewSeats: number;
  ladiesOnly: number;
  accessible: number;
  window: number;
  aisle: number;
  decks: number;
  washrooms: number;
}

const MAX_ROWS = 40;
const MAX_COLUMNS = 12;
const SEAT_NUMBER_RE = /^[A-Za-z0-9-]{1,6}$/;

export class SeatMap {
  private readonly index: Map<string, SeatCell>;
  readonly summary: SeatMapSummary;

  private constructor(private readonly props: SeatMapProps) {
    this.index = new Map(props.seats.map((s) => [s.number, s]));
    this.summary = this.computeSummary();
    Object.freeze(this.props);
  }

  /**
   * Validate and construct. Throws `DomainError` (422) on any inconsistency, so
   * an invalid layout can never be persisted or served.
   */
  static create(props: SeatMapProps): SeatMap {
    const { decks, seats } = props;
    const fixtures = props.fixtures ?? [];

    if (decks < 1 || decks > 2) fail('A bus has 1 or 2 decks');
    if (props.deckGrids && props.deckGrids.length !== decks)
      fail(`Give a grid for each of the ${decks} deck(s)`);
    const grids = SeatMap.gridsOf(props);
    for (const [d, g] of grids.entries()) {
      const where = decks > 1 ? ` on the ${d === 0 ? 'lower' : 'upper'} deck` : '';
      if (g.rows < 1 || g.rows > MAX_ROWS) fail(`rows must be between 1 and ${MAX_ROWS}${where}`);
      if (g.columns < 1 || g.columns > MAX_COLUMNS)
        fail(`columns must be between 1 and ${MAX_COLUMNS}${where}`);
    }
    if (props.deckGrids) {
      if (props.rows !== Math.max(...grids.map((g) => g.rows)))
        fail("rows must be the largest deck's row count");
      if (props.columns !== Math.max(...grids.map((g) => g.columns)))
        fail("columns must be the largest deck's column count");
    }
    if (seats.length === 0) fail('A layout must have at least one seat');

    const seen = new Set<string>();
    const occupied = new Map<string, string>(); // "deck:row:col" → what is there

    const place = (
      what: string,
      item: { deck: number; row: number; column: number; rowSpan?: number; colSpan?: number },
    ) => {
      if (item.deck < 0 || item.deck >= decks)
        fail(`${what} is on deck ${item.deck}, but the bus has ${decks} deck(s)`);
      const grid = grids[item.deck];
      const rowSpan = item.rowSpan ?? 1;
      const colSpan = item.colSpan ?? 1;
      if (rowSpan < 1 || colSpan < 1 || rowSpan > 4 || colSpan > 4)
        fail(`${what} must span 1 to 4 rows and columns`);
      if (item.row < 0 || item.row + rowSpan > grid.rows)
        fail(`${what} overflows the grid vertically`);
      if (item.column < 0 || item.column + colSpan > grid.columns)
        fail(`${what} overflows the grid horizontally`);
      // Every cell it covers must be free — nothing overlaps.
      for (let r = item.row; r < item.row + rowSpan; r += 1) {
        for (let c = item.column; c < item.column + colSpan; c += 1) {
          const cell = `${item.deck}:${r}:${c}`;
          const there = occupied.get(cell);
          if (there)
            fail(`${what} overlaps ${there} at cell (deck ${item.deck}, row ${r}, col ${c})`);
          occupied.set(cell, what[0].toLowerCase() + what.slice(1));
        }
      }
    };

    for (const seat of seats) {
      if (!SEAT_NUMBER_RE.test(seat.number)) {
        fail(`Invalid seat number '${seat.number}' (letters, digits, hyphen; max 6 chars)`);
      }
      const key = seat.number.toUpperCase();
      if (seen.has(key)) fail(`Duplicate seat number '${seat.number}'`);
      seen.add(key);

      if (seat.type === 'crew' && seat.bookable !== false) {
        fail(
          `Seat '${seat.number}' is a crew/driver cell — it must be marked non-bookable, it can never be sold as a ticket`,
        );
      }
      place(`Seat '${seat.number}'`, seat);
    }

    for (const f of fixtures) {
      if (!FIXTURE_KINDS.includes(f.kind)) fail(`Unknown fixture '${String(f.kind)}'`);
      if (f.kind === 'staircase' && decks < 2) fail('A staircase needs an upper deck');
      place(`The ${f.kind.replace('_', ' ')}`, f);
    }
    if (fixtures.filter((f) => f.kind === 'driver').length > 1) fail('A bus has one driver seat');

    return new SeatMap(props);
  }

  /** Each deck's grid — its own, or the shared rows × columns. */
  static gridsOf(
    props: Pick<SeatMapProps, 'decks' | 'rows' | 'columns' | 'deckGrids'>,
  ): DeckGrid[] {
    return (
      props.deckGrids ??
      Array.from({ length: Math.max(1, props.decks) }, () => ({
        rows: props.rows,
        columns: props.columns,
      }))
    );
  }

  get grids(): DeckGrid[] {
    return SeatMap.gridsOf(this.props);
  }

  get fixtures(): Fixture[] {
    return this.props.fixtures ?? [];
  }

  /**
   * The passenger seats as trips know them — number and type. Moving seats,
   * doors or the washroom around keeps it; renumbering or changing a seat's
   * type does not.
   */
  seatIdentity(): string[] {
    return this.props.seats
      .filter((s) => s.type !== 'crew' && s.bookable !== false)
      .map((s) => `${s.number}:${s.type}`)
      .sort();
  }

  has(seatNumber: string): boolean {
    return this.index.has(seatNumber);
  }

  get(seatNumber: string): SeatCell | undefined {
    return this.index.get(seatNumber);
  }

  /** All bookable seat numbers, in a stable order — used to size inventory. */
  bookableSeatNumbers(): string[] {
    return this.props.seats.filter((s) => s.bookable !== false).map((s) => s.number);
  }

  isBookable(seatNumber: string): boolean {
    const seat = this.index.get(seatNumber);
    return seat !== undefined && seat.bookable !== false;
  }

  isLadiesOnly(seatNumber: string): boolean {
    return this.index.get(seatNumber)?.ladiesOnly === true;
  }

  isAccessible(seatNumber: string): boolean {
    return this.index.get(seatNumber)?.accessible === true;
  }

  /**
   * Set attributes on the given seats (#136, #137, #141). Unknown seat
   * numbers are an error, not ignored; crew cells cannot take passenger
   * attributes. Returns a new, validated map.
   */
  withSeatAttributes(seatNumbers: string[], patch: SeatAttributePatch): SeatMap {
    const wanted = new Set(seatNumbers);
    const unknown = seatNumbers.filter((n) => !this.index.has(n));
    if (unknown.length > 0) fail(`No such seat(s): ${unknown.join(', ')}`);
    const seats = this.props.seats.map((seat) => {
      if (!wanted.has(seat.number)) return seat;
      if (seat.type === 'crew') fail(`Seat '${seat.number}' is a crew cell`);
      const next: SeatCell = { ...seat };
      if (patch.position !== undefined) {
        if (patch.position === null) delete next.position;
        else next.position = patch.position;
      }
      if (patch.ladiesOnly !== undefined) next.ladiesOnly = patch.ladiesOnly;
      if (patch.accessible !== undefined) next.accessible = patch.accessible;
      return next;
    });
    return SeatMap.create({ ...this.props, seats });
  }

  /**
   * Mark every passenger seat as window or aisle from the grid: in each row
   * of each deck, the outermost seats are window seats and a seat next to an
   * empty column inside the row (the aisle gap) is an aisle seat. Seats in
   * between keep no position. Crew cells are left alone.
   */
  withAutoPositions(): SeatMap {
    const rows = new Map<string, SeatCell[]>();
    for (const seat of this.props.seats) {
      if (seat.type === 'crew') continue;
      const key = `${seat.deck}:${seat.row}`;
      rows.set(key, [...(rows.get(key) ?? []), seat]);
    }
    const position = new Map<string, SeatFacing>();
    for (const rowSeats of rows.values()) {
      const taken = new Set<number>();
      for (const s of rowSeats)
        for (let c = s.column; c < s.column + (s.colSpan ?? 1); c += 1) taken.add(c);
      const minCol = Math.min(...taken);
      const maxCol = Math.max(...taken);
      for (const s of rowSeats) {
        const left = s.column - 1;
        const right = s.column + (s.colSpan ?? 1);
        if (s.column === minCol || right - 1 === maxCol) position.set(s.number, 'window');
        else if ((left >= minCol && !taken.has(left)) || (right <= maxCol && !taken.has(right)))
          position.set(s.number, 'aisle');
      }
    }
    const seats = this.props.seats.map((seat) => {
      const p = position.get(seat.number);
      if (seat.type === 'crew') return seat;
      const next: SeatCell = { ...seat };
      if (p) next.position = p;
      else delete next.position;
      return next;
    });
    return SeatMap.create({ ...this.props, seats });
  }

  seatType(seatNumber: string): SeatType | undefined {
    return this.index.get(seatNumber)?.type;
  }

  get seatCount(): number {
    return this.props.seats.length;
  }

  toJSON(): SeatMapProps & { summary: SeatMapSummary } {
    return { ...this.props, summary: this.summary };
  }

  /** Persist form: the raw props as jsonb. */
  toPersistence(): Json {
    return this.props as unknown as Json;
  }

  static fromPersistence(raw: Json): SeatMap {
    return SeatMap.create(raw as unknown as SeatMapProps);
  }

  private computeSummary(): SeatMapSummary {
    let seater = 0;
    let sleeper = 0;
    let semiSleeper = 0;
    let crewSeats = 0;
    let ladiesOnly = 0;
    let accessible = 0;
    let window = 0;
    let aisle = 0;
    let bookable = 0;
    for (const seat of this.props.seats) {
      if (seat.bookable !== false) bookable += 1;
      if (seat.ladiesOnly) ladiesOnly += 1;
      if (seat.accessible) accessible += 1;
      if (seat.position === 'window') window += 1;
      else if (seat.position === 'aisle') aisle += 1;
      if (seat.type === 'seater') seater += 1;
      else if (seat.type === 'sleeper') sleeper += 1;
      else if (seat.type === 'semi_sleeper') semiSleeper += 1;
      else if (seat.type === 'crew') crewSeats += 1;
    }
    return {
      totalSeats: this.props.seats.length,
      bookableSeats: bookable,
      seater,
      sleeper,
      semiSleeper,
      crewSeats,
      ladiesOnly,
      accessible,
      window,
      aisle,
      decks: this.props.decks,
      washrooms: (this.props.fixtures ?? []).filter((f) => f.kind === 'washroom').length,
    };
  }
}

function fail(message: string): never {
  throw new DomainError(ErrorCode.COMMON_VALIDATION, `Invalid seat layout: ${message}`);
}
