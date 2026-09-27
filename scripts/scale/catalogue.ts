/**
 * What the scale data set is made of: India's busy intercity corridors, every
 * kind of bus an operator runs (seater 2+2 / 2+1 / 3+2, semi-sleeper, sleeper
 * 2+1, seater-cum-sleeper; AC and non-AC; 30 to 60 seats), and the names of
 * 100 operators. Pure data + layout builders — no I/O.
 */

/** A corridor: cities in order (first → last), with the km and minutes from the first city. */
export interface Corridor {
  code: string;
  stops: { city: string; km: number; min: number }[];
}

export const CORRIDORS: Corridor[] = [
  {
    code: 'DEL-LKO',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Agra', km: 233, min: 240 },
      { city: 'Kanpur', km: 480, min: 480 },
      { city: 'Lucknow', km: 555, min: 570 },
    ],
  },
  {
    code: 'DEL-JAI',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Gurugram', km: 30, min: 45 },
      { city: 'Alwar', km: 160, min: 180 },
      { city: 'Jaipur', km: 280, min: 330 },
    ],
  },
  {
    code: 'DEL-MNL',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Karnal', km: 130, min: 150 },
      { city: 'Chandigarh', km: 250, min: 300 },
      { city: 'Mandi', km: 450, min: 600 },
      { city: 'Manali', km: 540, min: 780 },
    ],
  },
  {
    code: 'DEL-DDN',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Haridwar', km: 220, min: 300 },
      { city: 'Rishikesh', km: 245, min: 345 },
      { city: 'Dehradun', km: 255, min: 390 },
    ],
  },
  {
    code: 'DEL-ASR',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Ambala', km: 200, min: 240 },
      { city: 'Ludhiana', km: 310, min: 360 },
      { city: 'Jalandhar', km: 370, min: 420 },
      { city: 'Amritsar', km: 450, min: 510 },
    ],
  },
  {
    code: 'DEL-SML',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Chandigarh', km: 250, min: 300 },
      { city: 'Shimla', km: 350, min: 480 },
    ],
  },
  {
    code: 'DEL-DSH',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Ludhiana', km: 310, min: 360 },
      { city: 'Jalandhar', km: 370, min: 420 },
      { city: 'Dharamshala', km: 480, min: 600 },
    ],
  },
  {
    code: 'DEL-JMU',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Ludhiana', km: 310, min: 360 },
      { city: 'Jalandhar', km: 370, min: 420 },
      { city: 'Jammu', km: 590, min: 660 },
    ],
  },
  {
    code: 'LKO-VNS',
    stops: [
      { city: 'Lucknow', km: 0, min: 0 },
      { city: 'Prayagraj', km: 200, min: 240 },
      { city: 'Varanasi', km: 320, min: 390 },
    ],
  },
  {
    code: 'JAI-JDH',
    stops: [
      { city: 'Jaipur', km: 0, min: 0 },
      { city: 'Ajmer', km: 135, min: 150 },
      { city: 'Jodhpur', km: 335, min: 390 },
    ],
  },
  {
    code: 'AMD-JAI',
    stops: [
      { city: 'Ahmedabad', km: 0, min: 0 },
      { city: 'Udaipur', km: 260, min: 300 },
      { city: 'Ajmer', km: 530, min: 600 },
      { city: 'Jaipur', km: 665, min: 750 },
    ],
  },
  {
    code: 'BOM-PNQ',
    stops: [
      { city: 'Mumbai', km: 0, min: 0 },
      { city: 'Lonavala', km: 85, min: 120 },
      { city: 'Pune', km: 150, min: 210 },
    ],
  },
  {
    code: 'BOM-AUR',
    stops: [
      { city: 'Mumbai', km: 0, min: 0 },
      { city: 'Nashik', km: 170, min: 240 },
      { city: 'Shirdi', km: 250, min: 330 },
      { city: 'Aurangabad', km: 335, min: 420 },
    ],
  },
  {
    code: 'BOM-AMD',
    stops: [
      { city: 'Mumbai', km: 0, min: 0 },
      { city: 'Surat', km: 285, min: 330 },
      { city: 'Vadodara', km: 420, min: 480 },
      { city: 'Ahmedabad', km: 530, min: 600 },
    ],
  },
  {
    code: 'BOM-GOA',
    stops: [
      { city: 'Mumbai', km: 0, min: 0 },
      { city: 'Pune', km: 150, min: 210 },
      { city: 'Satara', km: 260, min: 330 },
      { city: 'Kolhapur', km: 380, min: 480 },
      { city: 'Panaji', km: 590, min: 720 },
    ],
  },
  {
    code: 'PNQ-HYD',
    stops: [
      { city: 'Pune', km: 0, min: 0 },
      { city: 'Solapur', km: 250, min: 300 },
      { city: 'Hyderabad', km: 560, min: 660 },
    ],
  },
  {
    code: 'PNQ-NAG',
    stops: [
      { city: 'Pune', km: 0, min: 0 },
      { city: 'Aurangabad', km: 235, min: 300 },
      { city: 'Nagpur', km: 710, min: 840 },
    ],
  },
  {
    code: 'AMD-RJK',
    stops: [
      { city: 'Ahmedabad', km: 0, min: 0 },
      { city: 'Rajkot', km: 215, min: 270 },
    ],
  },
  {
    code: 'IDR-BPL',
    stops: [
      { city: 'Indore', km: 0, min: 0 },
      { city: 'Ujjain', km: 55, min: 75 },
      { city: 'Bhopal', km: 195, min: 240 },
    ],
  },
  {
    code: 'HYD-VTZ',
    stops: [
      { city: 'Hyderabad', km: 0, min: 0 },
      { city: 'Suryapet', km: 135, min: 150 },
      { city: 'Vijayawada', km: 275, min: 330 },
      { city: 'Rajahmundry', km: 430, min: 540 },
      { city: 'Visakhapatnam', km: 620, min: 780 },
    ],
  },
  {
    code: 'HYD-BLR',
    stops: [
      { city: 'Hyderabad', km: 0, min: 0 },
      { city: 'Kurnool', km: 215, min: 240 },
      { city: 'Anantapur', km: 360, min: 420 },
      { city: 'Bangalore', km: 570, min: 660 },
    ],
  },
  {
    code: 'HYD-WGL',
    stops: [
      { city: 'Hyderabad', km: 0, min: 0 },
      { city: 'Warangal', km: 150, min: 210 },
    ],
  },
  {
    code: 'HYD-TPT',
    stops: [
      { city: 'Hyderabad', km: 0, min: 0 },
      { city: 'Kurnool', km: 215, min: 240 },
      { city: 'Tirupati', km: 560, min: 690 },
    ],
  },
  {
    code: 'BLR-MYS',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Channapatna', km: 60, min: 75 },
      { city: 'Mysuru', km: 145, min: 180 },
    ],
  },
  {
    code: 'BLR-MAA',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Krishnagiri', km: 90, min: 120 },
      { city: 'Vellore', km: 210, min: 240 },
      { city: 'Chennai', km: 345, min: 390 },
    ],
  },
  {
    code: 'BLR-CBE',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Krishnagiri', km: 90, min: 120 },
      { city: 'Salem', km: 200, min: 240 },
      { city: 'Coimbatore', km: 365, min: 420 },
    ],
  },
  {
    code: 'BLR-IXE',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Hassan', km: 185, min: 240 },
      { city: 'Mangaluru', km: 350, min: 450 },
    ],
  },
  {
    code: 'BLR-HBL',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Davanagere', km: 265, min: 300 },
      { city: 'Hubballi', km: 410, min: 450 },
      { city: 'Belagavi', km: 505, min: 570 },
    ],
  },
  {
    code: 'BLR-TPT',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Krishnagiri', km: 90, min: 120 },
      { city: 'Tirupati', km: 250, min: 330 },
    ],
  },
  {
    code: 'MAA-PNY',
    stops: [
      { city: 'Chennai', km: 0, min: 0 },
      { city: 'Villupuram', km: 160, min: 180 },
      { city: 'Puducherry', km: 195, min: 240 },
    ],
  },
  {
    code: 'MAA-IXM',
    stops: [
      { city: 'Chennai', km: 0, min: 0 },
      { city: 'Villupuram', km: 160, min: 180 },
      { city: 'Tiruchirappalli', km: 330, min: 390 },
      { city: 'Madurai', km: 460, min: 540 },
    ],
  },
  {
    code: 'MAA-TPT',
    stops: [
      { city: 'Chennai', km: 0, min: 0 },
      { city: 'Tirupati', km: 135, min: 180 },
    ],
  },
  {
    code: 'MAA-CBE',
    stops: [
      { city: 'Chennai', km: 0, min: 0 },
      { city: 'Vellore', km: 140, min: 150 },
      { city: 'Salem', km: 340, min: 360 },
      { city: 'Coimbatore', km: 505, min: 540 },
    ],
  },
  {
    code: 'CBE-COK',
    stops: [
      { city: 'Coimbatore', km: 0, min: 0 },
      { city: 'Palakkad', km: 55, min: 75 },
      { city: 'Kochi', km: 190, min: 270 },
    ],
  },
  {
    code: 'COK-TRV',
    stops: [
      { city: 'Kochi', km: 0, min: 0 },
      { city: 'Alappuzha', km: 55, min: 75 },
      { city: 'Thiruvananthapuram', km: 205, min: 270 },
    ],
  },
  {
    code: 'BLR-COK',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Salem', km: 200, min: 240 },
      { city: 'Coimbatore', km: 365, min: 420 },
      { city: 'Kochi', km: 555, min: 660 },
    ],
  },
  {
    code: 'BLR-CCJ',
    stops: [
      { city: 'Bangalore', km: 0, min: 0 },
      { city: 'Mysuru', km: 145, min: 180 },
      { city: 'Kozhikode', km: 355, min: 480 },
    ],
  },
  {
    code: 'CCU-SIL',
    stops: [
      { city: 'Kolkata', km: 0, min: 0 },
      { city: 'Durgapur', km: 170, min: 210 },
      { city: 'Siliguri', km: 590, min: 720 },
    ],
  },
  {
    code: 'CCU-BBI',
    stops: [
      { city: 'Kolkata', km: 0, min: 0 },
      { city: 'Balasore', km: 235, min: 300 },
      { city: 'Cuttack', km: 420, min: 510 },
      { city: 'Bhubaneswar', km: 445, min: 540 },
    ],
  },
  {
    code: 'PAT-RNC',
    stops: [
      { city: 'Patna', km: 0, min: 0 },
      { city: 'Gaya', km: 100, min: 150 },
      { city: 'Ranchi', km: 330, min: 450 },
    ],
  },
  {
    code: 'CCU-DHN',
    stops: [
      { city: 'Kolkata', km: 0, min: 0 },
      { city: 'Durgapur', km: 170, min: 210 },
      { city: 'Dhanbad', km: 265, min: 330 },
    ],
  },
  {
    code: 'NAG-RPR',
    stops: [
      { city: 'Nagpur', km: 0, min: 0 },
      { city: 'Raipur', km: 290, min: 360 },
    ],
  },
  {
    code: 'GAU-SHL',
    stops: [
      { city: 'Guwahati', km: 0, min: 0 },
      { city: 'Shillong', km: 100, min: 180 },
    ],
  },
  {
    code: 'LKO-GKP',
    stops: [
      { city: 'Lucknow', km: 0, min: 0 },
      { city: 'Gorakhpur', km: 270, min: 330 },
    ],
  },
  {
    code: 'DEL-BEK',
    stops: [
      { city: 'Delhi', km: 0, min: 0 },
      { city: 'Mathura', km: 180, min: 180 },
      { city: 'Bareilly', km: 250, min: 330 },
    ],
  },
];

/* ───────────── bus types ───────────── */

export type SeatType = 'seater' | 'sleeper' | 'semi_sleeper';
export interface Seat {
  number: string;
  deck: 0 | 1;
  row: number;
  column: number;
  rowSpan?: number;
  type: SeatType;
  ladiesOnly?: boolean;
  accessible?: boolean;
  position?: 'window' | 'aisle';
}
export interface Layout {
  decks: 1 | 2;
  rows: number;
  columns: number;
  seats: Seat[];
}
export interface BusType {
  code: string;
  name: string;
  ac: boolean;
  layout: Layout;
  /** Fare per km (paise) for this class. */
  paisePerKm: number;
}

/**
 * Seats in rows of a pattern: `pattern` lists the seat columns (the rest is aisle),
 * e.g. [0, 1, 3, 4] for 2+2. The last row may take the aisle too (a full back bench).
 */
function seaterGrid(
  total: number,
  pattern: number[],
  columns: number,
  type: SeatType,
  backBench: boolean,
): Layout {
  const seats: Seat[] = [];
  let n = 1;
  let row = 0;
  const perRow = pattern.length;
  const benchSeats = backBench ? columns : 0;
  const mainRows = backBench
    ? Math.floor((total - benchSeats) / perRow)
    : Math.ceil(total / perRow);
  for (; row < mainRows && n <= total - benchSeats; row += 1) {
    for (const col of pattern) {
      if (n > total - benchSeats) break;
      const edge = col === 0 || col === columns - 1;
      seats.push({
        number: String(n++),
        deck: 0,
        row,
        column: col,
        type,
        position: edge ? 'window' : 'aisle',
      });
    }
  }
  if (backBench) {
    for (let col = 0; col < columns && n <= total; col += 1) {
      seats.push({
        number: String(n++),
        deck: 0,
        row,
        column: col,
        type,
        position: col === 0 || col === columns - 1 ? 'window' : 'aisle',
      });
    }
    row += 1;
  }
  // First two seats are for women on every seater (a common operator rule); seat 1 is accessible.
  seats[0].accessible = true;
  if (seats[2]) seats[2].ladiesOnly = true;
  if (seats[3]) seats[3].ladiesOnly = true;
  return { decks: 1, rows: row, columns, seats };
}

/** Sleeper berths 2+1 on two decks (lower L1.., upper U1..): `berthRows` rows of 3 berths per deck. */
function sleeperGrid(berthRows: number, extraBack = 0): Layout {
  const seats: Seat[] = [];
  const pattern = [0, 2, 3];
  for (const deck of [0, 1] as const) {
    let n = 1;
    const prefix = deck === 0 ? 'L' : 'U';
    for (let r = 0; r < berthRows; r += 1) {
      for (const col of pattern) {
        seats.push({
          number: `${prefix}${n++}`,
          deck,
          row: r * 2,
          rowSpan: 2,
          column: col,
          type: 'sleeper',
          position: col === 2 ? 'aisle' : 'window',
        });
      }
    }
    for (let i = 0; i < extraBack; i += 1) {
      seats.push({
        number: `${prefix}${n++}`,
        deck,
        row: berthRows * 2,
        rowSpan: 2,
        column: i === 0 ? 0 : i + 1,
        type: 'sleeper',
        position: 'window',
      });
    }
  }
  seats[0].ladiesOnly = true;
  seats[1].ladiesOnly = true;
  return { decks: 2, rows: berthRows * 2 + (extraBack ? 2 : 0), columns: 4, seats };
}

/** Seater 2+1 on the lower deck, sleeper 2+1 berths above (the "seater-cum-sleeper"). */
function mixedGrid(seatRows: number, berthRows: number): Layout {
  const seats: Seat[] = [];
  let n = 1;
  for (let r = 0; r < seatRows; r += 1) {
    for (const col of [0, 2, 3]) {
      seats.push({
        number: String(n++),
        deck: 0,
        row: r,
        column: col,
        type: 'seater',
        position: col === 2 ? 'aisle' : 'window',
      });
    }
  }
  let u = 1;
  for (let r = 0; r < berthRows; r += 1) {
    for (const col of [0, 2, 3]) {
      seats.push({
        number: `U${u++}`,
        deck: 1,
        row: r * 2,
        rowSpan: 2,
        column: col,
        type: 'sleeper',
        position: col === 2 ? 'aisle' : 'window',
      });
    }
  }
  seats[0].accessible = true;
  seats[1].ladiesOnly = true;
  return { decks: 2, rows: Math.max(seatRows, berthRows * 2), columns: 4, seats };
}

const S22 = [0, 1, 3, 4];
const S21 = [0, 2, 3];
const S32 = [0, 1, 2, 4, 5];

/** Every kind of bus in the data set (each also exists as AC and non-AC where it makes sense). */
export const BUS_TYPES: BusType[] = [
  {
    code: 'S22-32',
    name: '2+2 Seater (32)',
    ac: false,
    layout: seaterGrid(32, S22, 5, 'seater', false),
    paisePerKm: 110,
  },
  {
    code: 'S22-35',
    name: '2+2 Seater (35)',
    ac: false,
    layout: seaterGrid(35, S22, 5, 'seater', true),
    paisePerKm: 110,
  },
  {
    code: 'S22-36',
    name: '2+2 Seater (36)',
    ac: false,
    layout: seaterGrid(36, S22, 5, 'seater', false),
    paisePerKm: 115,
  },
  {
    code: 'S22-40',
    name: '2+2 AC Seater (40)',
    ac: true,
    layout: seaterGrid(40, S22, 5, 'seater', false),
    paisePerKm: 150,
  },
  {
    code: 'S22-41',
    name: '2+2 AC Seater (41)',
    ac: true,
    layout: seaterGrid(41, S22, 5, 'seater', true),
    paisePerKm: 150,
  },
  {
    code: 'S22-45',
    name: '2+2 AC Seater (45)',
    ac: true,
    layout: seaterGrid(45, S22, 5, 'seater', true),
    paisePerKm: 155,
  },
  {
    code: 'S22-49',
    name: '2+2 Volvo AC Seater (49)',
    ac: true,
    layout: seaterGrid(49, S22, 5, 'seater', true),
    paisePerKm: 170,
  },
  {
    code: 'S22-53',
    name: '2+2 Non-AC Seater (53)',
    ac: false,
    layout: seaterGrid(53, S22, 5, 'seater', true),
    paisePerKm: 100,
  },
  {
    code: 'S32-50',
    name: '3+2 Seater (50)',
    ac: false,
    layout: seaterGrid(50, S32, 6, 'seater', false),
    paisePerKm: 85,
  },
  {
    code: 'S32-55',
    name: '3+2 Seater (55)',
    ac: false,
    layout: seaterGrid(55, S32, 6, 'seater', false),
    paisePerKm: 85,
  },
  {
    code: 'S32-60',
    name: '3+2 Seater (60)',
    ac: false,
    layout: seaterGrid(60, S32, 6, 'seater', false),
    paisePerKm: 80,
  },
  {
    code: 'S21-30',
    name: '2+1 AC Seater (30)',
    ac: true,
    layout: seaterGrid(30, S21, 4, 'seater', false),
    paisePerKm: 175,
  },
  {
    code: 'S21-36',
    name: '2+1 AC Seater (36)',
    ac: true,
    layout: seaterGrid(36, S21, 4, 'seater', false),
    paisePerKm: 170,
  },
  {
    code: 'SS22-36',
    name: '2+2 AC Semi-sleeper (36)',
    ac: true,
    layout: seaterGrid(36, S22, 5, 'semi_sleeper', false),
    paisePerKm: 165,
  },
  {
    code: 'SS22-40',
    name: '2+2 Semi-sleeper (40)',
    ac: false,
    layout: seaterGrid(40, S22, 5, 'semi_sleeper', false),
    paisePerKm: 130,
  },
  {
    code: 'SS22-44',
    name: '2+2 AC Semi-sleeper (44)',
    ac: true,
    layout: seaterGrid(44, S22, 5, 'semi_sleeper', false),
    paisePerKm: 160,
  },
  {
    code: 'SL21-30',
    name: '2+1 AC Sleeper (30)',
    ac: true,
    layout: sleeperGrid(5),
    paisePerKm: 230,
  },
  {
    code: 'SL21-32',
    name: '2+1 Non-AC Sleeper (32)',
    ac: false,
    layout: sleeperGrid(5, 1),
    paisePerKm: 170,
  },
  {
    code: 'SL21-36',
    name: '2+1 AC Sleeper (36)',
    ac: true,
    layout: sleeperGrid(6),
    paisePerKm: 225,
  },
  {
    code: 'SL21-38',
    name: '2+1 Volvo AC Sleeper (38)',
    ac: true,
    layout: sleeperGrid(6, 1),
    paisePerKm: 250,
  },
  {
    code: 'MX-45',
    name: 'AC Seater + Sleeper (30 + 15)',
    ac: true,
    layout: mixedGrid(10, 5),
    paisePerKm: 180,
  },
  {
    code: 'MX-39',
    name: 'Non-AC Seater + Sleeper (24 + 15)',
    ac: false,
    layout: mixedGrid(8, 5),
    paisePerKm: 140,
  },
];

/** How many seats a bus type sells. */
export const seatCount = (t: BusType) => t.layout.seats.length;

/** Per-seat-type fare multiplier on a mixed bus (sleepers cost more). */
export const TYPE_FACTOR: Record<SeatType, number> = {
  seater: 1,
  semi_sleeper: 1.15,
  sleeper: 1.45,
};

/* ───────────── operators ───────────── */

const FIRST = [
  'Shree',
  'Sai',
  'Royal',
  'Orange',
  'Green',
  'Blue',
  'Golden',
  'Silver',
  'National',
  'Kaveri',
  'Ganga',
  'Yamuna',
  'Narmada',
  'Sahyadri',
  'Konkan',
  'Deccan',
  'Himalayan',
  'Desert',
  'Coastal',
  'Metro',
  'Paulo',
  'Vijay',
  'Jabbar',
  'Neeta',
  'Hans',
  'Laxmi',
  'Durga',
  'Maa',
  'Jai',
  'Om',
];
const SECOND = [
  'Travels',
  'Tours & Travels',
  'Roadways',
  'Bus Service',
  'Holidays',
  'Express',
  'Transport',
  'Yatra',
  'Safari',
  'Journeys',
];

/** 100 distinct operator names, deterministic. */
export function operatorNames(n = 100): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n; i += 1) {
    const name = `${FIRST[i % FIRST.length]} ${SECOND[Math.floor(i / FIRST.length) % SECOND.length]}`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** A small deterministic PRNG, so a re-run builds the same data set. */
export function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
