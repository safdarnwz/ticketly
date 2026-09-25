// Shared API response shapes (kept loose where the backend is generic).

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string;
  tenantId: string | null;
  roles: string[];
  permissions: string[];
}

export interface SearchResult {
  tripId: string;
  routeId: string;
  /** The operator this trip belongs to — carried forward as X-Tenant-Id on every later call. */
  tenantId: string;
  operatorName: string;
  departsAt: string;
  arrivesAt: string;
  durationMin: number;
  availableSeats: number;
  fromPriceMinor: number;
  currency: string;
  operatorRating?: number;
  seatTypes?: string[];
  amenities: { id: string; code: string; name: string; icon: string | null }[];
}

export interface Booking {
  id: string;
  pnr: string;
  tripId: string;
  routeId: string;
  status: string;
  seatCount: number;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  createdAt?: string;
  /** Only present on the cross-tenant PNR lookup (`by-pnr`) — the operator this booking belongs to. */
  tenantId?: string;
}

export interface Ticket {
  seat: string;
  ticketId?: string | null;
  boardingToken: string;
}
