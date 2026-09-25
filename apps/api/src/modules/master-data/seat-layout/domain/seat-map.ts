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
 *   A sleeper berth can span two rows (rowSpan = 2); a seat spans one cell.
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

export interface SeatMapProps {
  decks: number; // 1 or 2
  rows: number; // grid height per deck
  columns: number; // grid width per deck
  seats: SeatCell[];
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
    const { decks, rows, columns, seats } = props;

    if (decks < 1 || decks > 2) fail('A bus has 1 or 2 decks');
    if (rows < 1 || rows > MAX_ROWS) fail(`rows must be between 1 and ${MAX_ROWS}`);
    if (columns < 1 || columns > MAX_COLUMNS) fail(`columns must be between 1 and ${MAX_COLUMNS}`);
    if (seats.length === 0) fail('A layout must have at least one seat');

    const seen = new Set<string>();
    const occupied = new Set<string>(); // "deck:row:col" cells already taken

    for (const seat of seats) {
      if (!SEAT_NUMBER_RE.test(seat.number)) {
        fail(`Invalid seat number '${seat.number}' (letters, digits, hyphen; max 6 chars)`);
      }
      if (seen.has(seat.number)) fail(`Duplicate seat number '${seat.number}'`);
      seen.add(seat.number);

      if (seat.type === 'crew' && seat.bookable !== false) {
        fail(
          `Seat '${seat.number}' is a crew/driver cell — it must be marked non-bookable, it can never be sold as a ticket`,
        );
      }

      if (seat.deck < 0 || seat.deck >= decks) {
        fail(`Seat '${seat.number}' is on deck ${seat.deck}, but the bus has ${decks} deck(s)`);
      }
      const rowSpan = seat.rowSpan ?? 1;
      const colSpan = seat.colSpan ?? 1;
      if (rowSpan < 1 || colSpan < 1) fail(`Seat '${seat.number}' has a non-positive span`);
      if (seat.row < 0 || seat.row + rowSpan > rows) {
        fail(`Seat '${seat.number}' overflows the grid vertically`);
      }
      if (seat.column < 0 || seat.column + colSpan > columns) {
        fail(`Seat '${seat.number}' overflows the grid horizontally`);
      }

      // Every cell the seat covers must be free — no two seats overlap.
      for (let r = seat.row; r < seat.row + rowSpan; r += 1) {
        for (let c = seat.column; c < seat.column + colSpan; c += 1) {
          const cell = `${seat.deck}:${r}:${c}`;
          if (occupied.has(cell)) {
            fail(
              `Seat '${seat.number}' overlaps another seat at cell (deck ${seat.deck}, row ${r}, col ${c})`,
            );
          }
          occupied.add(cell);
        }
      }
    }

    return new SeatMap(props);
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
    };
  }
}

function fail(message: string): never {
  throw new DomainError(ErrorCode.COMMON_VALIDATION, `Invalid seat layout: ${message}`);
}
