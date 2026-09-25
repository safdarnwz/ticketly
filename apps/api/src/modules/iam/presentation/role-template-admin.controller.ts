import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, UuidParam, zodBody } from '@http';
import { getUserId } from '@kernel';

import { RoleTemplateService } from '../application/services/role-template.service';
import {
  RoleTemplateSchema,
  UpdateRoleTemplateSchema,
  type RoleTemplateDto,
  type UpdateRoleTemplateDto,
} from './dto/role.dto';

/** Global role → permission templates (#22). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/role-templates', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class RoleTemplateAdminController {
  constructor(private readonly templates: RoleTemplateService) {}

  @Get()
  async list() {
    return { items: await this.templates.list() };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a role template operators can apply' })
  create(@Body(zodBody(RoleTemplateSchema)) dto: RoleTemplateDto) {
    return this.templates.create(dto, getUserId() ?? null);
  }

  @Put(':id')
  update(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateRoleTemplateSchema)) dto: UpdateRoleTemplateDto,
  ) {
    return this.templates.update(id, dto);
  }

  @Delete(':id')
  async remove(@UuidParam('id') id: string) {
    await this.templates.remove(id);
    return { ok: true };
  }
}
