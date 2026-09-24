/**
 * ============================================================================
 *  Ticketly API SDK — a tiny, dependency-free typed client
 * ============================================================================
 *
 * A thin, fetch-based wrapper over the public HTTP API so integrators (an OTA, a
 * white-label storefront, an internal tool) don't hand-roll requests. It carries
 * the bearer token, sets the tenant + idempotency headers, parses the RFC-9457
 * error envelope into a typed error, and exposes a handful of typed resource
 * methods. Zero runtime dependencies — it uses the platform `fetch`.
 */

export interface TicketlyClientOptions {
  baseUrl: string;
  token?: string;
  tenantSlug?: string;
  /** Injected for tests / non-browser runtimes; defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  status: number;
}

export class TicketlyApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(e: ApiError) {
    super(e.message);
    this.name = 'TicketlyApiError';
    this.code = e.code;
    this.status = e.status;
    this.details = e.details;
  }
}

export interface SearchQuery {
  originCityId: string;
  destCityId: string;
  journeyDate: string; // YYYY-MM-DD
  filter?: Record<string, unknown>;
  sort?: 'price' | 'departure' | 'duration' | 'rating';
}

export interface HoldRequest {
  quoteId: string;
  seatNumbers: string[];
  passengers: { seatNumber: string; fullName: string; age?: number; gender?: string }[];
  contactEmail?: string;
  contactPhone?: string;
}

export class TicketlyClient {
  private readonly baseUrl: string;
  private token?: string;
  private readonly tenantSlug?: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: TicketlyClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.tenantSlug = opts.tenantSlug;
    const f = opts.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) throw new Error('No fetch implementation available; pass opts.fetch');
    this.doFetch = f;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.tenantSlug) headers['x-tenant'] = this.tenantSlug;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const e = (json ?? {}) as Partial<ApiError>;
      throw new TicketlyApiError({ code: e.code ?? 'COMMON.INTERNAL_ERROR', message: e.message ?? res.statusText, details: e.details, status: res.status });
    }
    return json as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const out = await this.request<{ accessToken: string; refreshToken: string }>('POST', '/v1/auth/login', { email, password });
    this.token = out.accessToken;
    return out;
  }

  // ── Storefront ────────────────────────────────────────────────────────────
  search(q: SearchQuery): Promise<{ results: unknown[]; count: number }> {
    return this.request('POST', '/v1/storefront/search', q);
  }

  // ── Booking ────────────────────────────────────────────────────────────────
  hold(req: HoldRequest, idempotencyKey: string): Promise<{ bookingId: string; pnr: string; holdExpiresAt: string; totalMinor: number }> {
    return this.request('POST', '/v1/bookings/hold', req, idempotencyKey);
  }
  confirm(bookingId: string, payment: { paidMinor: number; reference?: string }, idempotencyKey: string): Promise<unknown> {
    return this.request('POST', `/v1/bookings/${bookingId}/confirm`, payment, idempotencyKey);
  }
  cancel(bookingId: string, reason?: string): Promise<{ refundMinor: number; refundPct: number }> {
    return this.request('POST', `/v1/bookings/${bookingId}/cancel`, { reason });
  }

  // ── Tickets ────────────────────────────────────────────────────────────────
  ticketTokens(bookingId: string): Promise<{ pnr: string; tickets: { seat: string; boardingToken: string }[] }> {
    return this.request('GET', `/v1/bookings/${bookingId}/tickets`);
  }
  verifyTicket(token: string): Promise<{ valid: boolean; payload: unknown }> {
    return this.request('POST', '/v1/tickets/verify', { token });
  }

  // ── i18n / currency ─────────────────────────────────────────────────────────
  convert(amountMinor: number, from: string, to: string): Promise<{ amountMinor: number; formatted: string }> {
    return this.request('GET', `/v1/i18n/convert?amountMinor=${amountMinor}&from=${from}&to=${to}`);
  }

  // ── Privacy ────────────────────────────────────────────────────────────────
  setConsent(purpose: string, granted: boolean): Promise<{ state: Record<string, boolean> }> {
    return this.request('POST', '/v1/privacy/consents', { purpose, granted });
  }
  requestErasure(): Promise<{ requestId: string }> {
    return this.request('POST', '/v1/privacy/erasure-requests');
  }
}
