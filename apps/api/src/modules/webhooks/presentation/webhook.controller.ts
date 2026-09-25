import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, UuidParam, zodBody } from '@http';
import { getUserId, NotFoundError } from '@kernel';

import { WebhookDeliveryService } from '../application/webhook-delivery.service';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TEST_EVENT,
} from '../domain/webhook-event';
import { WebhookRepository } from '../infrastructure/webhook.repository';
import { RegisterWebhookSchema, type RegisterWebhookDto } from './dto/webhook.dto';

/** An operator's outbound webhook endpoints (their ERP, a directly-contracted OTA, …). */
@ApiTags('webhooks')
@ApiBearerAuth('bearer')
@Controller({ path: 'webhooks', version: '1' })
@ApiStandardErrors()
export class WebhookController {
  constructor(
    private readonly webhooks: WebhookRepository,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  @Get('catalogue')
  @Public()
  @ApiOperation({ summary: 'Events an endpoint can subscribe to, and how deliveries are signed' })
  catalogue() {
    return {
      events: WEBHOOK_EVENTS,
      testEvent: WEBHOOK_TEST_EVENT,
      signature: `Header \`${WEBHOOK_SIGNATURE_HEADER}: sha256=<hex>\`, hex = HMAC_SHA256(your endpoint secret, the raw JSON body). Verify before trusting.`,
      retries:
        'Non-2xx or timeout (10 s) is retried after 1 min, 5 min, 30 min and 3 h, then marked failed.',
    };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Register a webhook endpoint (returns the signing secret ONCE)' })
  async register(@Body(zodBody(RegisterWebhookSchema)) dto: RegisterWebhookDto) {
    return this.webhooks.registerForTenant({ ...dto, createdBy: getUserId() ?? null });
  }

  @Get()
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: "This operator's webhook endpoints" })
  async list() {
    return { items: await this.webhooks.listForTenant() };
  }

  @Get(':id/deliveries')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Recent delivery attempts for an endpoint' })
  async deliveries(@UuidParam('id') id: string) {
    if (!(await this.webhooks.targetForTenant(id))) throw new NotFoundError('Webhook', id);
    return { items: await this.webhooks.deliveriesForTenant(id) };
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary: 'Send a signed test event now and report the response (status, latency)',
  })
  async test(@UuidParam('id') id: string) {
    const target = await this.webhooks.targetForTenant(id);
    if (!target) throw new NotFoundError('Webhook', id);
    return this.delivery.sendTest(target);
  }

  @Delete(':id')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Revoke a webhook endpoint' })
  async revoke(@UuidParam('id') id: string) {
    await this.webhooks.revokeForTenant(id);
    return { ok: true };
  }
}
