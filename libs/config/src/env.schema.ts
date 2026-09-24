import { z } from 'zod';

/**
 * ============================================================================
 *  Environment schema — fail fast, fail loud
 * ============================================================================
 *
 * The process refuses to boot if configuration is invalid. A typo in
 * `DB_POOL_MAX` becomes a startup error with the offending key named, not a
 * connection-exhaustion incident at 8pm on a Friday during festival booking.
 *
 * Everything is parsed and COERCED here exactly once. Downstream code receives
 * typed values (`number`, `boolean`, `string[]`) and never touches
 * `process.env` again — enforced by ESLint.
 */

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
    .default(defaultValue)
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1' || v === 'yes'));

const int = (defaultValue: number, min?: number, max?: number) => {
  let schema = z.coerce.number().int();
  if (min !== undefined) schema = schema.min(min);
  if (max !== undefined) schema = schema.max(max);
  return schema.default(defaultValue);
};

const csv = (defaultValue: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? defaultValue
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

export const envSchema = z.object({
  /* ── Runtime ───────────────────────────────────────────────────────────*/
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_NAME: z.string().default('ticketly'),
  APP_VERSION: z.string().default('0.0.0'),
  /** Identifies the deployed instance in logs/metrics (hostname by default). */
  INSTANCE_ID: z.string().optional(),

  /* ── HTTP server ───────────────────────────────────────────────────────*/
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: int(3000, 1, 65535),
  /** Public base URL — used for webhook callbacks and absolute links. */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_PREFIX: z.string().default('api'),
  /** Body size cap. Booking payloads are small; a large cap is an attack surface. */
  HTTP_BODY_LIMIT_BYTES: int(8_388_608, 1024), // 8 MB: fits a 5 MB base64-encoded fleet document upload
  /** Per-request wall-clock budget. Beyond this the request is aborted. */
  HTTP_REQUEST_TIMEOUT_MS: int(15_000, 100),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: int(72_000, 1_000),
  /** Must exceed the load balancer's idle timeout to avoid 502s on reuse. */
  HTTP_HEADERS_TIMEOUT_MS: int(75_000, 1_000),
  HTTP_TRUST_PROXY: bool(true),
  CORS_ORIGINS: csv(['*']),
  CORS_CREDENTIALS: bool(true),
  /** Shed load when the event loop lags — protects p99 under overload. */
  OVERLOAD_MAX_EVENT_LOOP_DELAY_MS: int(1_000, 0),
  OVERLOAD_MAX_HEAP_USED_BYTES: int(0, 0),
  OVERLOAD_MAX_RSS_BYTES: int(0, 0),

  /* ── Database (primary) ────────────────────────────────────────────────*/
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: int(5432, 1, 65535),
  DB_NAME: z.string().default('ticketly'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  DB_SSL: bool(false),
  DB_SSL_REJECT_UNAUTHORIZED: bool(true),
  DB_SCHEMA: z.string().default('public'),
  /**
   * Pool sizing. RULE: `DB_POOL_MAX * instances <= max_connections - reserved`.
   * A pool larger than the machine's effective concurrency (~2-4x cores) makes
   * things SLOWER, not faster: Postgres context-switches instead of working.
   */
  DB_POOL_MIN: int(2, 0),
  DB_POOL_MAX: int(20, 1),
  DB_POOL_IDLE_TIMEOUT_MS: int(30_000, 0),
  DB_CONNECTION_TIMEOUT_MS: int(5_000, 100),
  /** Recycle connections to bound memory growth from prepared statements. */
  DB_MAX_USES_PER_CONNECTION: int(7_500, 0),
  /** Server-side guards. Any query exceeding these is killed, not queued. */
  DB_STATEMENT_TIMEOUT_MS: int(10_000, 0),
  DB_LOCK_TIMEOUT_MS: int(3_000, 0),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: int(15_000, 0),
  /** Log any query slower than this with its parameters redacted. */
  DB_SLOW_QUERY_MS: int(150, 0),
  DB_LOG_QUERIES: bool(false),
  DB_APPLICATION_NAME: z.string().default('ticketly-api'),

  /* ── Database (read replicas) ──────────────────────────────────────────*/
  /** Comma-separated `host:port` list. Empty = all reads go to the primary. */
  DB_REPLICA_HOSTS: csv([]),
  DB_REPLICA_POOL_MAX: int(20, 1),
  /** Max acceptable replication lag before a replica is taken out of rotation. */
  DB_REPLICA_MAX_LAG_MS: int(2_000, 0),
  DB_REPLICA_HEALTHCHECK_INTERVAL_MS: int(5_000, 500),

  /* ── Cache ─────────────────────────────────────────────────────────────*/
  /** L1 = in-process. Zero network hops; the fastest cache is no cache call. */
  CACHE_L1_ENABLED: bool(true),
  CACHE_L1_MAX_ITEMS: int(50_000, 1),
  CACHE_L1_TTL_MS: int(5_000, 0),
  /** L2 = Redis, shared across instances. Optional: the system degrades to L1. */
  CACHE_L2_ENABLED: bool(false),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_KEY_PREFIX: z.string().default('gds'),
  REDIS_CONNECT_TIMEOUT_MS: int(3_000, 100),
  REDIS_COMMAND_TIMEOUT_MS: int(1_000, 50),
  REDIS_MAX_RETRIES_PER_REQUEST: int(2, 0),

  /* ── Security (expanded in Part 2) ─────────────────────────────────────*/
  /** 32+ byte secret. Rotated via JWT_SECRET_PREVIOUS for zero-downtime. */
  JWT_SECRET: z.string().min(32).default('dev-only-secret-change-me-in-production-32b'),
  JWT_SECRET_PREVIOUS: z.string().optional(),
  JWT_ACCESS_TTL_SECONDS: int(900, 60),
  JWT_REFRESH_TTL_SECONDS: int(2_592_000, 300),
  JWT_ISSUER: z.string().default('ticketly'),
  JWT_AUDIENCE: z.string().default('ticketly-clients'),
  /** AES-256-GCM key (base64, 32 bytes) for column-level PII encryption. */
  ENCRYPTION_KEY: z.string().default(''),
  PASSWORD_HASH_MEMORY_KIB: int(19_456, 8),
  PASSWORD_HASH_ITERATIONS: int(2, 1),
  PASSWORD_HASH_PARALLELISM: int(1, 1),

  /* ── Rate limiting ─────────────────────────────────────────────────────*/
  RATE_LIMIT_ENABLED: bool(true),
  RATE_LIMIT_WINDOW_MS: int(60_000, 1_000),
  RATE_LIMIT_MAX_PER_IP: int(600, 1),
  RATE_LIMIT_MAX_PER_TENANT: int(6_000, 1),
  RATE_LIMIT_SEARCH_PER_MINUTE: int(120, 1),
  RATE_LIMIT_BOOKING_PER_MINUTE: int(30, 1),

  /* ── Idempotency ───────────────────────────────────────────────────────*/
  IDEMPOTENCY_ENABLED: bool(true),
  IDEMPOTENCY_TTL_SECONDS: int(86_400, 60),

  /* ── Observability ─────────────────────────────────────────────────────*/
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_PRETTY: bool(false),
  LOG_REDACT_PATHS: csv([
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    '*.password',
    '*.otp',
    '*.cardNumber',
    '*.cvv',
  ]),
  METRICS_ENABLED: bool(true),
  METRICS_PATH: z.string().default('/metrics'),
  TRACING_ENABLED: bool(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://127.0.0.1:4318'),
  OTEL_SERVICE_NAME: z.string().default('ticketly-api'),
  /** 0.0 - 1.0. Keep low in production; always 1.0 for errors via tail sampling. */
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.05),

  /* ── API docs ──────────────────────────────────────────────────────────*/
  SWAGGER_ENABLED: bool(true),
  SWAGGER_PATH: z.string().default('docs'),

  /* ── Domain defaults (bus operations) ──────────────────────────────────*/
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
  DEFAULT_CURRENCY: z.enum(['INR', 'USD', 'AED', 'LKR', 'NPR', 'BDT']).default('INR'),
  DEFAULT_LOCALE: z.string().default('en-IN'),
  /** How many days of trips are materialised ahead of time (Part 5). */
  INVENTORY_HORIZON_DAYS: int(120, 1, 365),
  /** How long a seat hold survives before auto-release (Part 7). */
  SEAT_HOLD_TTL_SECONDS: int(600, 30, 3_600),
  /** Booking cut-off before departure, in minutes. */
  BOOKING_CUTOFF_MINUTES: int(30, 0),

  /* ── Background workers (Part 9) ───────────────────────────────────────*/
  WORKER_ENABLED: bool(false),
  OUTBOX_POLL_INTERVAL_MS: int(200, 25),
  OUTBOX_BATCH_SIZE: int(200, 1),
  OUTBOX_MAX_ATTEMPTS: int(12, 1),
  JOB_CONCURRENCY: int(8, 1),

  /* ── Graceful shutdown ─────────────────────────────────────────────────*/
  /** Grace period so the load balancer stops routing before we close sockets. */
  SHUTDOWN_DELAY_MS: int(5_000, 0),
  SHUTDOWN_TIMEOUT_MS: int(20_000, 1_000),

  /* ── Payments: TEST/SANDBOX gateway ────────────────────────────────────*
   * TEMPORARY. A fake gateway for QA/demo so the whole pay flow works with no
   * real PSP. When PAYMENT_TEST_MODE=true, entering these test credentials at
   * checkout succeeds, confirms the booking and posts the ledger — just like a
   * real capture. Remove this block once a real PSP (Razorpay/PayU/…) is wired.
   */
  PAYMENT_TEST_MODE: bool(true),
  PAYMENT_TEST_UPI_SUCCESS_VPA: z.string().default('success@ticketly'),
  PAYMENT_TEST_UPI_FAILURE_VPA: z.string().default('failure@ticketly'),
  PAYMENT_TEST_CARD_SUCCESS: z.string().default('4111111111111111'),
  PAYMENT_TEST_CARD_FAILURE: z.string().default('4000000000000002'),
  PAYMENT_TEST_CARD_CVV: z.string().default('123'),
  PAYMENT_TEST_CARD_EXPIRY: z.string().default('12/30'),
  PAYMENT_TEST_NETBANKING_USER: z.string().default('ticketly'),
  PAYMENT_TEST_NETBANKING_PASSWORD: z.string().default('test1234'),
  PAYMENT_TEST_NETBANKING_BANKS: csv(['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK']),

  /* ── Notifications: MSG91 (SMS + WhatsApp) ─────────────────────────────*
   * Leave MSG91_AUTH_KEY empty to keep the log-only fallback (dev/test) — the
   * moment a key is set, real sends switch on automatically, no code change.
   */
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_SENDER_ID: z.string().default('TCKTLY'), // 6-char DLT-approved sender id
  MSG91_ROUTE: z.string().default('4'), // '4' = transactional
  MSG91_DLT_TEMPLATE_ID: z.string().default(''), // required by Indian TRAI/DLT for transactional SMS
  MSG91_WHATSAPP_INTEGRATED_NUMBER: z.string().default(''), // WhatsApp Business number registered with MSG91
  MSG91_WHATSAPP_NAMESPACE: z.string().default(''),

  /* ── Payments: Razorpay (real PSP) ──────────────────────────────────────*
   * Leave RAZORPAY_KEY_ID empty to keep using the test/mock gateway — see
   * PaymentModule's factory. Get these from https://dashboard.razorpay.com/.
   * webhookSecret is set ONCE when you register the webhook URL in the
   * dashboard — it is NOT the same value as the key secret.
   */
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  /* ── Object storage (fleet documents, bus photos, operator logos) ──────────
   * Provider-agnostic. 'r2' = Cloudflare R2 (S3 API), 's3' = AWS S3 or any
   * S3-compatible store, 'azure' = Azure Blob, 'database' = local/dev
   * fallback (bytes in Postgres). Object KEYS are identical on every provider
   * ({operator-slug}/{folder}/...), and each stored row remembers which
   * provider holds it — so moving providers is a copy + config change
   * (scripts/storage-migrate.ts), never a code change.
   */
  STORAGE_PROVIDER: z.enum(['database', 'r2', 's3', 'azure']).default('database'),
  STORAGE_BUCKET: z.string().default(''),            // R2/S3 bucket, or Azure container
  STORAGE_REGION: z.string().default('auto'),        // 'auto' for R2; e.g. 'ap-south-1' for S3
  STORAGE_ENDPOINT: z.string().default(''),          // R2: https://<account-id>.r2.cloudflarestorage.com ; S3: https://s3.<region>.amazonaws.com
  STORAGE_FORCE_PATH_STYLE: bool(true),              // R2 requires path-style; AWS prefers virtual-hosted
  STORAGE_ACCESS_KEY_ID: z.string().default(''),
  STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
  STORAGE_AZURE_ACCOUNT: z.string().default(''),
  STORAGE_AZURE_ACCOUNT_KEY: z.string().default(''), // base64 account key
  STORAGE_KEY_PREFIX: z.string().default(''),        // e.g. 'prod' → prod/orange-travels/...
  /** Public CDN origin for PUBLIC objects (logos, bus photos), e.g. https://cdn.ticketly.com (a Cloudflare custom domain on the R2 bucket). */
  STORAGE_PUBLIC_BASE_URL: z.string().default(''),
  STORAGE_SIGNED_URL_TTL_SECONDS: int(300, 30, 3600), // private documents: short-lived signed links only
  STORAGE_TIMEOUT_MS: int(15_000, 1000, 120_000),
});

export type Env = z.infer<typeof envSchema>;
