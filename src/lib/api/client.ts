import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

/** The RFC-9457-ish error envelope the backend returns. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  traceId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'COMMON.INTERNAL_ERROR';
    this.details = body.details;
  }
}

// Auth hooks are injected by the auth store to avoid a circular import.
let getToken: () => string | null = () => null;
let getTenant: () => string | null = () => null;
let onUnauthorized: () => void = () => {};
// Set by the booking store once a trip is picked from search results — the
// customer's storefront flow (www.ticketly.com) has NO tenant bound by host,
// so every subsequent call (trip detail, quote, hold, confirm, ticket) must
// carry the OPERATOR of the trip the customer actually chose.
let getBookingTenantId: () => string | null = () => null;

export function configureApiAuth(hooks: {
  getToken: () => string | null;
  getTenant: () => string | null;
  onUnauthorized: () => void;
}): void {
  getToken = hooks.getToken;
  getTenant = hooks.getTenant;
  onUnauthorized = hooks.onUnauthorized;
}

/** Called once by the booking store; kept separate from `configureApiAuth` so neither overwrites the other's hooks. */
export function configureBookingTenant(fn: () => string | null): void {
  getBookingTenantId = fn;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api',
  headers: { Accept: 'application/json' },
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  const tenant = getTenant();
  const bookingTenantId = getBookingTenantId();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Dev-only fallback: the real deployment resolves tenant from the Host
  // header (app.<slug>.ticketly.com) — see TenantResolutionMiddleware.
  if (tenant) config.headers['x-tenant-slug'] = tenant;
  // The real, production-meaningful header for the customer storefront flow —
  // takes priority since it names an exact tenant UUID, not a dev alias.
  if (bookingTenantId) config.headers['X-Tenant-Id'] = bookingTenantId;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status ?? 0;
    if (status === 401) onUnauthorized();
    const body = error.response?.data ?? { message: error.message };
    return Promise.reject(new ApiError(status, body));
  },
);

// Thin typed helpers.
export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await api.get<T>(url, config)).data;
}
export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await api.post<T>(url, body, config)).data;
}
export async function put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await api.put<T>(url, body, config)).data;
}
export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await api.patch<T>(url, body, config)).data;
}
export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await api.delete<T>(url, config)).data;
}

/** Attach an Idempotency-Key header for money/inventory writes. */
export function withIdempotency(key: string): AxiosRequestConfig {
  return { headers: { 'idempotency-key': key } };
}
