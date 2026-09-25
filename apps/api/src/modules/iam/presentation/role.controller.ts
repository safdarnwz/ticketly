import { Body, Controller, Delete, Get, Post, Put, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';

import {
  ApplyRoleTemplateSchema,
  CreateRoleSchema,
  DuplicateRoleSchema,
  UpdateRolePermissionsSchema,
  type ApplyRoleTemplateDto,
  type CreateRoleDto,
  type DuplicateRoleDto,
  type UpdateRolePermissionsDto,
} from './dto/role.dto';
import { RoleRepository } from '../infrastructure/persistence/role.repository';
import { RoleTemplateService } from '../application/services/role-template.service';
import { StaffAccessService } from '../application/services/staff-access.service';

@ApiTags('roles')
@ApiBearerAuth('bearer')
@Controller({ path: 'roles', version: '1' })
@ApiStandardErrors()
export class RoleController {
  constructor(
    private readonly roles: RoleRepository,
    private readonly access: StaffAccessService,
    private readonly roleTemplates: RoleTemplateService,
  ) {}

  @Get()
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'List roles for this operator' })
  async list() {
    return { items: await this.roles.list() };
  }

  @Get('templates')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: "The platform's role templates this operator can apply" })
  async templates() {
    return { items: await this.roleTemplates.list() };
  }

  @Post('templates/:templateId/apply')
  @HttpCode(201)
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Create a role from a platform template' })
  applyTemplate(
    @UuidParam('templateId') templateId: string,
    @Body(zodBody(ApplyRoleTemplateSchema)) dto: ApplyRoleTemplateDto,
  ) {
    return this.roleTemplates.apply(templateId, dto);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Create a custom role' })
  async create(@Body(zodBody(CreateRoleSchema)) dto: CreateRoleDto) {
    return { id: await this.access.createRole(dto) };
  }

  @Put(':id/permissions')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: "Replace a role's permissions" })
  async setPermissions(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateRolePermissionsSchema)) dto: UpdateRolePermissionsDto,
  ) {
    await this.access.setRolePermissions(id, dto.permissions);
    return { ok: true };
  }

  @Post(':id/duplicate')
  @HttpCode(201)
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Copy a role with all its permissions under a new code and name' })
  async duplicate(
    @UuidParam('id') id: string,
    @Body(zodBody(DuplicateRoleSchema)) dto: DuplicateRoleDto,
  ) {
    return { id: await this.access.duplicateRole(id, dto.code, dto.name) };
  }

  @Delete(':id')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Delete a custom role (not built-in, not assigned to anyone)' })
  async remove(@UuidParam('id') id: string) {
    await this.access.deleteRole(id);
    return { ok: true };
  }
}
