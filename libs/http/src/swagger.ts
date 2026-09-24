import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import type { AppConfig } from '@config';

/**
 * OpenAPI generation.
 *
 * The spec is the contract OTA partners integrate against (Part 10), so it is
 * a first-class deliverable, not an afterthought:
 *  - the raw document is served at `/{path}-json` for client-SDK generation;
 *  - `ProblemDetails` is declared once and referenced by every error response;
 *  - docs are disabled in production unless explicitly enabled, because an
 *    open spec is a free map of your attack surface.
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.swagger.enabled) return;

  const builder = new DocumentBuilder()
    .setTitle('Bus GDS Platform API')
    .setDescription(
      [
        'Multi-tenant bus reservation, inventory and distribution platform.',
        '',
        '### Conventions',
        '- All identifiers are UUID v7.',
        '- Money is transported as integer minor units plus a currency code.',
        "- Journey dates are `YYYY-MM-DD` in the *origin stop's* local calendar.",
        '- Timestamps are RFC 3339 UTC.',
        '- Collections use keyset pagination (`?cursor=`); there is no `?page=`.',
        '- Errors follow RFC 9457 `application/problem+json`; branch on `code`.',
        '- Unsafe requests accept `Idempotency-Key`; money-moving endpoints require it.',
      ].join('\n'),
    )
    .setVersion(config.app.version)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Operator console / customer app access token',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Api-Key',
        in: 'header',
        description: 'Server-to-server key for OTA / channel partners',
      },
      'apiKey',
    )
    .addGlobalParameters({
      name: 'X-Tenant-Id',
      in: 'header',
      required: false,
      description: 'Operator to act for. Inferred from the host or the token when omitted.',
      schema: { type: 'string', format: 'uuid' },
    })
    .addServer(config.app.publicBaseUrl, 'This environment');

  const document = SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ProblemDetails = {
    type: 'object',
    required: ['type', 'title', 'status', 'code'],
    properties: {
      type: { type: 'string', format: 'uri' },
      title: { type: 'string' },
      status: { type: 'integer' },
      detail: { type: 'string' },
      instance: { type: 'string' },
      code: { type: 'string', example: 'INVENTORY.SEAT_UNAVAILABLE' },
      retryable: { type: 'boolean' },
      requestId: { type: 'string', format: 'uuid' },
      traceId: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      errors: { type: 'object', additionalProperties: true },
    },
  };
  document.components.schemas.Money = {
    type: 'object',
    required: ['amount', 'currency'],
    properties: {
      amount: { type: 'integer', description: 'Minor units (paise for INR)', example: 124950 },
      currency: { type: 'string', example: 'INR' },
      display: { type: 'string', example: '₹1,249.50' },
    },
  };

  SwaggerModule.setup(config.swagger.path, app, document, {
    jsonDocumentUrl: `${config.swagger.path}-json`,
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
  });
}
