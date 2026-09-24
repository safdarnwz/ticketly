import { Body, Controller, Patch, Post, Put, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';
import { type UserId } from '@kernel';

import {
  AssignRolesSchema,
  GrantRoleSchema,
  InviteUserSchema,
  StaffAccessSchema,
  UpdateUserSchema,
  type AssignRolesDto,
  type GrantRoleDto,
  type InviteUserDto,
  type StaffAccessDto,
  type UpdateUserDto,
} from './dto/user.dto';
import { StaffAccessService } from '../application/services/staff-access.service';
import { UserService } from '../application/services/user.service';

@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller({ path: 'users', version: '1' })
@ApiStandardErrors()
export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly access: StaffAccessService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Invite a staff user' })
  async invite(@Body(zodBody(InviteUserSchema)) dto: InviteUserDto) {
    const id = await this.users.invite(dto);
    return { id };
  }

  @Patch(':id')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Update a user' })
  async update(@UuidParam('id') id: string, @Body(zodBody(UpdateUserSchema)) dto: UpdateUserDto) {
    await this.users.update(id as UserId, dto);
    return { ok: true };
  }

  @Post(':id/roles')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Assign roles to a user' })
  async assignRoles(
    @UuidParam('id') id: string,
    @Body(zodBody(AssignRolesSchema)) dto: AssignRolesDto,
  ) {
    await this.users.assignRoles(id as UserId, dto.roles);
    return { ok: true };
  }

  @Post(':id/force-logout')
  @HttpCode(200)
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Sign a staff member out everywhere, effective on their next request' })
  forceLogout(@UuidParam('id') id: string) {
    return this.access.forceLogout(id);
  }

  @Put(':id/access')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({
    summary:
      'Access expiry (contractors), login time window, reporting manager — null clears a field',
  })
  async setAccess(
    @UuidParam('id') id: string,
    @Body(zodBody(StaffAccessSchema)) dto: StaffAccessDto,
  ) {
    await this.access.setAccess(id, dto);
    return { ok: true };
  }

  @Put(':id/roles/:roleId')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Grant one role, optionally only until a date (temporary permission)' })
  async grantRole(
    @UuidParam('id') id: string,
    @UuidParam('roleId') roleId: string,
    @Body(zodBody(GrantRoleSchema)) dto: GrantRoleDto,
  ) {
    await this.access.grantRole(id, roleId, dto.expiresAt);
    return { ok: true };
  }
}
