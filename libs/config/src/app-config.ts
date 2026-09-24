import { hostname } from 'node:os';

import { Injectable } from '@nestjs/common';

import type { CurrencyCode } from '@kernel';
import { DEFAULT_TIMEZONE, timeZone, type TimeZone } from '@kernel';

import type { Env } from './env.schema';

/**
 * Typed, namespaced configuration facade.
 *
 * Consumers inject `AppConfig` and read `config.db.poolMax`, never
 * `process.env.DB_POOL_MAX`. Benefits:
 *  - one place to see everything a subsystem is tunable by;
 *  - values are already coerced and validated;
 *  - tests construct an `AppConfig` from a plain object with no env mutation,
 *    so parallel test files cannot interfere with each other.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly env: Env) {}

  /* ── app ──────────────────────────────────────────────────────────────*/
  get env_(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }
  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }
  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  readonly app = {
    name: '',
    version: '',
    instanceId: '',
    publicBaseUrl: '',
    /** The customer web app's origin, for links sent to passengers. */
    publicWebUrl: '',
    apiPrefix: '',
  };

  /* Namespaces are materialised in the factory below so property access is a
     plain object read (monomorphic, inlined by V8) rather than a getter call
     on a hot path. */
  http!: HttpConfig;
  db!: DbConfig;
  cache!: CacheConfig;
  security!: SecurityConfig;
  rateLimit!: RateLimitConfig;
  observability!: ObservabilityConfig;
  domain!: DomainConfig;
  worker!: WorkerConfig;
  shutdown!: ShutdownConfig;
  swagger!: SwaggerConfig;
  payment!: PaymentConfig;
  notifications!: NotificationsConfig;
  storage!: StorageConfig;
  mail!: MailConfig;
  bootstrap!: BootstrapConfig;
  kyc!: KycConfig;

  raw(): Readonly<Env> {
    return this.env;
  }
}

export interface HttpConfig {
  host: string;
  port: number;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  headersTimeoutMs: number;
  trustProxy: boolean;
  corsOrigins: string[];
  corsCredentials: boolean;
  overload: {
    maxEventLoopDelayMs: number;
    maxHeapUsedBytes: number;
    maxRssBytes: number;
  };
}

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  schema: string;
  poolMin: number;
  poolMax: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  maxUsesPerConnection: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
  slowQueryMs: number;
  logQueries: boolean;
  applicationName: string;
  replicas: { host: string; port: number }[];
  replicaPoolMax: number;
  replicaMaxLagMs: number;
  replicaHealthcheckIntervalMs: number;
}

export interface CacheConfig {
  l1Enabled: boolean;
  l1MaxItems: number;
  l1TtlMs: number;
  l2Enabled: boolean;
  redisUrl: string;
  redisKeyPrefix: string;
  redisConnectTimeoutMs: number;
  redisCommandTimeoutMs: number;
  redisMaxRetriesPerRequest: number;
}

export interface SecurityConfig {
  jwtSecret: string;
  jwtSecretPrevious?: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  issuer: string;
  audience: string;
  encryptionKey: string;
  passwordHash: { memoryKiB: number; iterations: number; parallelism: number };
  idempotency: { enabled: boolean; ttlSeconds: number };
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxPerIp: number;
  maxPerTenant: number;
  searchPerMinute: number;
  bookingPerMinute: number;
}

export interface ObservabilityConfig {
  logLevel: string;
  logPretty: boolean;
  redactPaths: string[];
  metricsEnabled: boolean;
  metricsPath: string;
  tracingEnabled: boolean;
  otlpEndpoint: string;
  serviceName: string;
  traceSampleRatio: number;
}

export interface DomainConfig {
  timezone: TimeZone;
  currency: CurrencyCode;
  locale: string;
  inventoryHorizonDays: number;
  seatHoldTtlSeconds: number;
  bookingCutoffMinutes: number;
}

export interface WorkerConfig {
  enabled: boolean;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
  outboxMaxAttempts: number;
  jobConcurrency: number;
}

export interface ShutdownConfig {
  delayMs: number;
  timeoutMs: number;
}

export interface SwaggerConfig {
  enabled: boolean;
  path: string;
}

/**
 * TEMPORARY test/sandbox payment gateway config. Present only while there is no
 * real PSP integration. `testMode` gates the whole sandbox flow.
 */
export interface PaymentConfig {
  testMode: boolean;
  test: {
    upiSuccessVpa: string;
    upiFailureVpa: string;
    cardSuccessNumber: string;
    cardFailureNumber: string;
    cardCvv: string;
    cardExpiry: string;
    netbankingUser: string;
    netbankingPassword: string;
    netbankingBanks: string[];
  };
  razorpay: {
    /** True only once real Razorpay keys are set — gates the PaymentModule factory. */
    enabled: boolean;
    keyId: string;
    keySecret: string;
    webhookSecret: string;
  };
}

/**
 * MSG91 (SMS + WhatsApp). `enabled` is true only once an auth key is set —
 * the notification module falls back to logging otherwise, so this is safe
 * to leave unconfigured in dev.
 */
export interface NotificationsConfig {
  msg91: {
    enabled: boolean;
    authKey: string;
    senderId: string;
    route: string;
    dltTemplateId: string;
    whatsappIntegratedNumber: string;
    whatsappNamespace: string;
  };
}

/** Gmail SMTP fallback used when no SMTP integration is enabled. */
export interface MailConfig {
  gmailUser: string;
  gmailAppPassword: string;
  /** "Name <address>"; empty = "Ticketly <gmailUser>". */
  from: string;
}

/** The platform super admin created on first boot, if absent. */
export interface BootstrapConfig {
  superAdminEmail: string;
  superAdminPassword: string;
  superAdminName: string;
}

export interface KycConfig {
  digio: { clientId: string; clientSecret: string; environment: 'sandbox' | 'production' };
}

export interface StorageConfig {
  provider: 'database' | 'r2' | 's3' | 'azure';
  bucket: string;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  azureAccount: string;
  azureAccountKey: string;
  keyPrefix: string;
  publicBaseUrl: string;
  signedUrlTtlSeconds: number;
  timeoutMs: number;
}

/** Build the namespaced facade from a validated env object. */
export function buildAppConfig(env: Env): AppConfig {
  const config = new AppConfig(env);

  Object.assign(config.app, {
    name: env.APP_NAME,
    version: env.APP_VERSION,
    instanceId: env.INSTANCE_ID ?? hostname(),
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    publicWebUrl: env.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    apiPrefix: env.API_PREFIX.replace(/^\/+|\/+$/g, ''),
  });

  config.http = {
    host: env.HTTP_HOST,
    port: env.HTTP_PORT,
    bodyLimitBytes: env.HTTP_BODY_LIMIT_BYTES,
    requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_MS,
    keepAliveTimeoutMs: env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
    headersTimeoutMs: env.HTTP_HEADERS_TIMEOUT_MS,
    trustProxy: env.HTTP_TRUST_PROXY,
    corsOrigins: env.CORS_ORIGINS,
    corsCredentials: env.CORS_CREDENTIALS,
    overload: {
      maxEventLoopDelayMs: env.OVERLOAD_MAX_EVENT_LOOP_DELAY_MS,
      maxHeapUsedBytes: env.OVERLOAD_MAX_HEAP_USED_BYTES,
      maxRssBytes: env.OVERLOAD_MAX_RSS_BYTES,
    },
  };

  config.db = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL,
    sslRejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    schema: env.DB_SCHEMA,
    poolMin: env.DB_POOL_MIN,
    poolMax: env.DB_POOL_MAX,
    idleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    maxUsesPerConnection: env.DB_MAX_USES_PER_CONNECTION,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    slowQueryMs: env.DB_SLOW_QUERY_MS,
    logQueries: env.DB_LOG_QUERIES,
    applicationName: env.DB_APPLICATION_NAME,
    replicas: env.DB_REPLICA_HOSTS.map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: port ? Number(port) : env.DB_PORT };
    }),
    replicaPoolMax: env.DB_REPLICA_POOL_MAX,
    replicaMaxLagMs: env.DB_REPLICA_MAX_LAG_MS,
    replicaHealthcheckIntervalMs: env.DB_REPLICA_HEALTHCHECK_INTERVAL_MS,
  };

  config.cache = {
    l1Enabled: env.CACHE_L1_ENABLED,
    l1MaxItems: env.CACHE_L1_MAX_ITEMS,
    l1TtlMs: env.CACHE_L1_TTL_MS,
    l2Enabled: env.CACHE_L2_ENABLED,
    redisUrl: env.REDIS_URL,
    redisKeyPrefix: env.REDIS_KEY_PREFIX,
    redisConnectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    redisCommandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
    redisMaxRetriesPerRequest: env.REDIS_MAX_RETRIES_PER_REQUEST,
  };

  config.security = {
    jwtSecret: env.JWT_SECRET,
    jwtSecretPrevious: env.JWT_SECRET_PREVIOUS,
    accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: env.JWT_REFRESH_TTL_SECONDS,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    encryptionKey: env.ENCRYPTION_KEY,
    passwordHash: {
      memoryKiB: env.PASSWORD_HASH_MEMORY_KIB,
      iterations: env.PASSWORD_HASH_ITERATIONS,
      parallelism: env.PASSWORD_HASH_PARALLELISM,
    },
    idempotency: {
      enabled: env.IDEMPOTENCY_ENABLED,
      ttlSeconds: env.IDEMPOTENCY_TTL_SECONDS,
    },
  };

  config.rateLimit = {
    enabled: env.RATE_LIMIT_ENABLED,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxPerIp: env.RATE_LIMIT_MAX_PER_IP,
    maxPerTenant: env.RATE_LIMIT_MAX_PER_TENANT,
    searchPerMinute: env.RATE_LIMIT_SEARCH_PER_MINUTE,
    bookingPerMinute: env.RATE_LIMIT_BOOKING_PER_MINUTE,
  };

  config.observability = {
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    redactPaths: env.LOG_REDACT_PATHS,
    metricsEnabled: env.METRICS_ENABLED,
    metricsPath: env.METRICS_PATH,
    tracingEnabled: env.TRACING_ENABLED,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: env.OTEL_SERVICE_NAME,
    traceSampleRatio: env.OTEL_TRACE_SAMPLE_RATIO,
  };

  config.domain = {
    timezone: safeTimeZone(env.DEFAULT_TIMEZONE),
    currency: env.DEFAULT_CURRENCY,
    locale: env.DEFAULT_LOCALE,
    inventoryHorizonDays: env.INVENTORY_HORIZON_DAYS,
    seatHoldTtlSeconds: env.SEAT_HOLD_TTL_SECONDS,
    bookingCutoffMinutes: env.BOOKING_CUTOFF_MINUTES,
  };

  config.worker = {
    enabled: env.WORKER_ENABLED,
    outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    outboxBatchSize: env.OUTBOX_BATCH_SIZE,
    outboxMaxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    jobConcurrency: env.JOB_CONCURRENCY,
  };

  config.shutdown = { delayMs: env.SHUTDOWN_DELAY_MS, timeoutMs: env.SHUTDOWN_TIMEOUT_MS };
  config.swagger = { enabled: env.SWAGGER_ENABLED, path: env.SWAGGER_PATH.replace(/^\/+/, '') };

  config.payment = {
    testMode: env.PAYMENT_TEST_MODE,
    test: {
      upiSuccessVpa: env.PAYMENT_TEST_UPI_SUCCESS_VPA,
      upiFailureVpa: env.PAYMENT_TEST_UPI_FAILURE_VPA,
      cardSuccessNumber: env.PAYMENT_TEST_CARD_SUCCESS,
      cardFailureNumber: env.PAYMENT_TEST_CARD_FAILURE,
      cardCvv: env.PAYMENT_TEST_CARD_CVV,
      cardExpiry: env.PAYMENT_TEST_CARD_EXPIRY,
      netbankingUser: env.PAYMENT_TEST_NETBANKING_USER,
      netbankingPassword: env.PAYMENT_TEST_NETBANKING_PASSWORD,
      netbankingBanks: env.PAYMENT_TEST_NETBANKING_BANKS,
    },
    razorpay: {
      enabled: env.RAZORPAY_KEY_ID.length > 0,
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    },
  };

  config.notifications = {
    msg91: {
      enabled: env.MSG91_AUTH_KEY.length > 0,
      authKey: env.MSG91_AUTH_KEY,
      senderId: env.MSG91_SENDER_ID,
      route: env.MSG91_ROUTE,
      dltTemplateId: env.MSG91_DLT_TEMPLATE_ID,
      whatsappIntegratedNumber: env.MSG91_WHATSAPP_INTEGRATED_NUMBER,
      whatsappNamespace: env.MSG91_WHATSAPP_NAMESPACE,
    },
  };

  config.storage = {
    provider: env.STORAGE_PROVIDER,
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT.replace(/\/+$/, ''),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    azureAccount: env.STORAGE_AZURE_ACCOUNT,
    azureAccountKey: env.STORAGE_AZURE_ACCOUNT_KEY,
    keyPrefix: env.STORAGE_KEY_PREFIX.replace(/^\/+|\/+$/g, ''),
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, ''),
    signedUrlTtlSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS,
    timeoutMs: env.STORAGE_TIMEOUT_MS,
  };

  config.mail = {
    gmailUser: env.GMAIL_USER,
    gmailAppPassword: env.GMAIL_APP_PASSWORD,
    from: env.MAIL_FROM,
  };

  config.bootstrap = {
    superAdminEmail: env.SUPER_ADMIN_EMAIL.trim().toLowerCase(),
    superAdminPassword: env.SUPER_ADMIN_PASSWORD,
    superAdminName: env.SUPER_ADMIN_NAME,
  };

  config.kyc = {
    digio: {
      clientId: env.DIGIO_CLIENT_ID,
      clientSecret: env.DIGIO_CLIENT_SECRET,
      environment: env.DIGIO_ENV,
    },
  };

  return config;
}

function safeTimeZone(value: string): TimeZone {
  try {
    return timeZone(value);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
