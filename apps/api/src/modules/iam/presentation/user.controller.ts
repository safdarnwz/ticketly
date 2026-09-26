import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Patch,
  Post,
  Put,
  HttpCode,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { AppConfig } from '@config';
import {
  ApiStandardErrors,
  DateRangeQuerySchema,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
  type DateRangeQuery,
} from '@http';
import { daysBetween, localDate, NotFoundError, toCsv, type UserId } from '@kernel';

import {
  AssignRolesSchema,
  GrantRoleSchema,
  InviteUserSchema,
  StaffAccessSchema,
  StaffBranchSchema,
  StaffListQuerySchema,
  UpdateUserSchema,
  type AssignRolesDto,
  type GrantRoleDto,
  type InviteUserDto,
  type StaffAccessDto,
  type StaffBranchDto,
  type StaffListQueryDto,
  type UpdateUserDto,
} from './dto/user.dto';
import { StaffAccessService } from '../application/services/staff-access.service';
import { UserService } from '../application/services/user.service';
import { StaffDirectoryRepository } from '../infrastructure/persistence/staff-directory.repository';

const PerformanceRangeSchema = DateRangeQuerySchema.refine(
  (v) => daysBetween(localDate(v.from), localDate(v.to)) <= 366,
  { message: 'Pick at most a year', path: ['to'] },
);

@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller({ path: 'users', version: '1' })
@ApiStandardErrors()
export class UserController {
  constructor(
    private readonly users: UserService,
    private readonly access: StaffAccessService,
    private readonly staff: StaffDirectoryRepository,
    private readonly config: AppConfig,
  ) {}

  @Get()
  @RequirePermission(Permission.USER_READ)
  @ApiOperation({
    summary: 'Staff directory — search by name or exact email/mobile, by status, branch or role',
  })
  async list(@Query(zodQuery(StaffListQuerySchema)) q: StaffListQueryDto) {
    const rows = await this.staff.list({
      ...q,
      offset: (q.page - 1) * q.limit,
      limit: q.limit + 1,
    });
    return { items: rows.slice(0, q.limit), page: q.page, hasMore: rows.length > q.limit };
  }

  @Get('export.csv')
  @RequirePermission(Permission.USER_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="staff.csv"')
  @ApiOperation({ summary: 'The whole staff directory as CSV' })
  async exportCsv() {
    const rows = await this.staff.list({ offset: 0, limit: 5000 });
    return toCsv(
      ['name', 'email', 'mobile', 'status', 'branch', 'roles', 'last_login', 'access_until'],
      rows.map((r) => ({
        name: r.fullName,
        email: r.email,
        mobile: r.phone,
        status: r.status,
        branch: r.branchName,
        roles: r.roles.map((x) => x.name).join('; '),
        last_login: r.lastLoginAt,
        access_until: r.accessExpiresAt,
      })),
    );
  }

  @Get('performance')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary:
      'Counter sales per staff member over a period: bookings, seats, revenue, cancellation rate',
  })
  async performance(@Query(zodQuery(PerformanceRangeSchema)) { from, to }: DateRangeQuery) {
    return { from, to, items: await this.staff.performance(from, to, this.config.domain.timezone) };
  }

  @Get(':id')
  @RequirePermission(Permission.USER_READ)
  @ApiOperation({ summary: 'A staff member: roles, branch, access, and what they did recently' })
  async detail(@UuidParam('id') id: string) {
    const person = await this.staff.find(id);
    if (!person) throw new NotFoundError('User', id);
    return { ...person, activity: await this.staff.activity(id, 50) };
  }

  @Put(':id/branch')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Move a staff member to a branch, or off every branch' })
  async setBranch(
    @UuidParam('id') id: string,
    @Body(zodBody(StaffBranchSchema)) dto: StaffBranchDto,
  ) {
    await this.users.setBranch(id as UserId, dto.branchId);
    return { ok: true };
  }

  @Delete(':id/roles/:roleId')
  @RequirePermission(Permission.ROLE_MANAGE)
  @ApiOperation({
    summary: 'Take one role away (never the last role, never the last user manager)',
  })
  async revokeRole(@UuidParam('id') id: string, @UuidParam('roleId') roleId: string) {
    await this.users.revokeRole(id as UserId, roleId);
    return { ok: true };
  }

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
