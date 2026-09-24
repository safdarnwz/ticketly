/**
 * MUST be imported first in `main.ts` (`import '@observability/tracing.bootstrap'`)
 * — before Nest, pg, fastify or ioredis are loaded. OpenTelemetry works by
 * monkey-patching those modules at require time; if they are already resolved,
 * instrumentation silently does nothing and you get empty traces.
 *
 * Kept dependency-light and env-driven so it can run before ConfigModule exists.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | undefined;

const enabled = ['true', '1', 'yes'].includes((process.env.TRACING_ENABLED ?? '').toLowerCase());

if (enabled) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'ticketly-api',
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? '0.0.0',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318').replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation produces enormous, useless span volume.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-pg': {
          enhancedDatabaseReporting: false, // never capture bound parameters (PII)
        },
      }),
    ],
  });

  sdk.start();

  const shutdown = (): void => {
    void sdk?.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export { sdk as otelSdk };
