import { z } from 'zod';
import { Body, Controller, Param, Patch, Post, Put, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, zodBody } from '@http';
import { type UserId } from '@kernel';

import { RequirePermission } from './decorators/require-permission.decorator';
import {
  AssignRolesSchema, type AssignRolesDto,
  InviteUserSchema, type InviteUserDto,
  UpdateUserSchema, type UpdateUserDto,
} from './dto/user.dto';
import { StaffAccessService } from '../application/services/staff-access.service';
import { UserService } from '../application/services/user.service';

const StaffAccessSchema = z.object({
  accessExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  loginWindow: z.object({ days: z.array(z.number().int().min(1).max(7)).min(1).max(7), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(0).max(1439) }).nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
});

@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller({ path: 'users', version: '1' })
@ApiStandardErrors()
export class UserController {
  constructor(private readonly users: UserService, private readonly access: StaffAccessService) {}

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
  async update(@Param('id') id: string, @Body(zodBody(UpdateUserSchema)) dto: UpdateUserDto) {
    await this.users.update(id as UserId, dto);
    return { ok: true };
  }

  @Post(':id/roles')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Assign roles to a user' })
  async assignRoles(@Param('id') id: string, @Body(zodBody(AssignRolesSchema)) dto: AssignRolesDto) {
    await this.users.assignRoles(id as UserId, dto.roles);
    return { ok: true };
  }

  @Post(':id/force-logout')
  @HttpCode(200)
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Sign a staff member out everywhere, effective on their next request' })
  forceLogout(@Param('id') id: string) { return this.access.forceLogout(id); }

  @Put(':id/access')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Access expiry (contractors), login time window, reporting manager — null clears a field' })
  async setAccess(@Param('id') id: string, @Body(zodBody(StaffAccessSchema)) dto: z.infer<typeof StaffAccessSchema>) {
    await this.access.setAccess(id, dto);
    return { ok: true };
  }

  @Put(':id/roles/:roleId')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({ summary: 'Grant one role, optionally only until a date (temporary permission)' })
  async grantRole(@Param('id') id: string, @Param('roleId') roleId: string, @Body(zodBody(z.object({ expiresAt: z.string().datetime({ offset: true }).nullable().default(null) }))) dto: { expiresAt: string | null }) {
    await this.access.grantRole(id, roleId, dto.expiresAt);
    return { ok: true };
  }
}
