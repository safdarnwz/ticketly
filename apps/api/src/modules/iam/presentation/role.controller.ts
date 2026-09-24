import { Body, Controller, Delete, Get, Param, Post, Put, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { UnitOfWork } from '@database';
import { ApiStandardErrors, RequirePermission, zodBody } from '@http';
import { requireTenantId, type RoleId } from '@kernel';

import {
  CreateRoleSchema,
  type CreateRoleDto,
  UpdateRolePermissionsSchema,
  type UpdateRolePermissionsDto,
} from './dto/role.dto';
import { RoleRepository } from '../infrastructure/persistence/role.repository';
import { StaffAccessService } from '../application/services/staff-access.service';

@ApiTags('roles')
@ApiBearerAuth('bearer')
@Controller({ path: 'roles', version: '1' })
@ApiStandardErrors()
export class RoleController {
  constructor(
    private readonly roles: RoleRepository,
    private readonly uow: UnitOfWork,
    private readonly access: StaffAccessService,
  ) {}

  @Get()
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'List roles for this operator' })
  async list() {
    return { items: await this.roles.list() };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Create a custom role' })
  async create(@Body(zodBody(CreateRoleSchema)) dto: CreateRoleDto) {
    const id = await this.uow.run({ name: 'role.create', tenantId: requireTenantId() }, async () =>
      this.roles.createRole({ tenantId: requireTenantId(), ...dto, isSystem: false }),
    );
    return { id };
  }

  @Put(':id/permissions')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: "Replace a role's permissions" })
  async setPermissions(
    @Param('id') id: string,
    @Body(zodBody(UpdateRolePermissionsSchema)) dto: UpdateRolePermissionsDto,
  ) {
    await this.uow.run({ name: 'role.setPermissions', tenantId: requireTenantId() }, async () => {
      await this.roles.setPermissions(id as RoleId, dto.permissions);
    });
    return { ok: true };
  }

  @Post(':id/duplicate')
  @HttpCode(201)
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Copy a role with all its permissions under a new code and name' })
  async duplicate(
    @Param('id') id: string,
    @Body(
      zodBody(
        z.object({
          code: z
            .string()
            .trim()
            .regex(/^[a-z][a-z0-9_]{2,40}$/),
          name: z.string().trim().min(2).max(80),
        }),
      ),
    )
    dto: { code: string; name: string },
  ) {
    return { id: await this.access.duplicateRole(id, dto.code, dto.name) };
  }

  @Delete(':id')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Delete a custom role (not built-in, not assigned to anyone)' })
  async remove(@Param('id') id: string) {
    await this.access.deleteRole(id);
    return { ok: true };
  }
}
