import { Body, Controller, Delete, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, zodBody } from '@http';
import { type ApiKeyId } from '@kernel';

import { ApiKeyService } from '../application/services/api-key.service';
import { CreateApiKeySchema, type CreateApiKeyDto } from './dto/api-key.dto';

@ApiTags('api-keys')
@ApiBearerAuth('bearer')
@Controller({ path: 'api-keys', version: '1' })
@ApiStandardErrors()
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'List active API keys (secrets are never returned)' })
  async list() {
    return { items: await this.apiKeys.list() };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Issue an API key — the plaintext is shown ONCE' })
  async create(@Body(zodBody(CreateApiKeySchema)) dto: CreateApiKeyDto) {
    const result = await this.apiKeys.issue({
      name: dto.name,
      scopes: dto.scopes,
      ipAllowlist: dto.ipAllowlist,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return {
      id: result.id,
      apiKey: result.plaintext,
      prefix: result.prefix,
      warning: 'Store this key now — it will not be shown again.',
    };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Revoke an API key' })
  async revoke(@Param('id') id: string): Promise<void> {
    await this.apiKeys.revoke(id as ApiKeyId);
  }
}
