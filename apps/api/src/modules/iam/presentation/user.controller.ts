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
import {
  daysBetween,
  getContext,
  getUserId,
  localDate,
  NotFoundError,
  toCsv,
  type UserId,
} from '@kernel';

import {
  AssignRolesSchema,
  GrantRoleSchema,
  InviteUserSchema,
  ResetStaffPasswordSchema,
  StaffAccessSchema,
  StaffBranchSchema,
  StaffImportRowSchema,
  StaffImportSchema,
  StaffListQuerySchema,
  StaffTargetSchema,
  StaffWarningSchema,
  UpdateUserSchema,
  type AssignRolesDto,
  type GrantRoleDto,
  type InviteUserDto,
  type ResetStaffPasswordDto,
  type StaffAccessDto,
  type StaffBranchDto,
  type StaffImportDto,
  type StaffListQueryDto,
  type StaffTargetDto,
  type StaffWarningDto,
  type UpdateUserDto,
} from './dto/user.dto';
import { StaffAccessService } from '../application/services/staff-access.service';
import { StaffManagementService } from '../application/services/staff-management.service';
import { UserService } from '../application/services/user.service';
import { STAFF_IMPORT_COLUMNS } from '../domain/staff-import';
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
    private readonly management: StaffManagementService,
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

  @Get('import-template.csv')
  @RequirePermission(Permission.USER_MANAGE)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="staff-upload-template.csv"')
  @ApiOperation({ summary: 'The staff upload template (opens in Excel; save as CSV to upload)' })
  importTemplate() {
    return toCsv(
      [...STAFF_IMPORT_COLUMNS],
      [
        {
          full_name: 'Asha Verma',
          email: 'asha@example.com',
          mobile: '9876543210',
          role: 'Agent',
          branch: '',
        },
      ],
    );
  }

  @Post('bulk-import')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({
    summary:
      'Add many staff at once; each row stands alone. Starting passwords are returned once — share them privately',
  })
  bulkImport(@Body(zodBody(StaffImportSchema)) dto: StaffImportDto) {
    return this.management.bulkInvite(
      dto.rows.map((raw) => {
        const r = StaffImportRowSchema.safeParse(raw);
        if (!r.success) return { error: r.error.issues.map((i) => i.message).join('; ') };
        return {
          fullName: r.data.full_name,
          email: r.data.email,
          phone: r.data.mobile,
          role: r.data.role,
          branch: r.data.branch,
        };
      }),
    );
  }

  @Get('me')
  @ApiOperation({ summary: 'My own staff record: roles, what I did, warnings and my daily target' })
  async me() {
    const id = getUserId();
    const person = getContext()?.tenantId && id ? await this.staff.find(id) : null;
    if (!person || !id) throw new NotFoundError('Staff member', 'me');
    return this.withRecords(person, id);
  }

  @Post('me/warnings/:warningId/acknowledge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm I have read a warning' })
  async acknowledge(@UuidParam('warningId') warningId: string) {
    if (!getContext()?.tenantId) throw new NotFoundError('Warning', warningId);
    await this.management.acknowledge(warningId);
    return { ok: true };
  }

  @Get(':id')
  @RequirePermission(Permission.USER_READ)
  @ApiOperation({
    summary: 'A staff member: roles, branch, access, what they did, warnings and target',
  })
  async detail(@UuidParam('id') id: string) {
    const person = await this.staff.find(id);
    if (!person) throw new NotFoundError('User', id);
    return this.withRecords(person, id);
  }

  private async withRecords<T extends object>(person: T, id: string) {
    const [activity, warnings, target] = await Promise.all([
      this.staff.activity(id, 50),
      this.staff.warnings(id),
      this.staff.target(id),
    ]);
    return { ...person, activity, warnings, target };
  }

  @Put(':id/target')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Set a daily counter-sales target (bookings, optionally revenue)' })
  async setTarget(
    @UuidParam('id') id: string,
    @Body(zodBody(StaffTargetSchema)) dto: StaffTargetDto,
  ) {
    await this.management.setTarget(id, dto);
    return { ok: true };
  }

  @Delete(':id/target')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Remove the daily target' })
  async clearTarget(@UuidParam('id') id: string) {
    await this.management.setTarget(id, null);
    return { ok: true };
  }

  @Post(':id/warnings')
  @HttpCode(201)
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({ summary: 'Issue a written warning; the staff member sees it on their account' })
  warn(@UuidParam('id') id: string, @Body(zodBody(StaffWarningSchema)) dto: StaffWarningDto) {
    return this.management.warn(id, dto.reason, dto.note);
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
  @ApiOperation({
    summary: 'Grant roles by code (older clients) — same checks as PUT /users/:id/roles/:roleId',
  })
  async assignRoles(
    @UuidParam('id') id: string,
    @Body(zodBody(AssignRolesSchema)) dto: AssignRolesDto,
  ) {
    await this.access.grantRolesByCode(id, dto.roles);
    return { ok: true };
  }

  @Put(':id/password')
  @RequirePermission(Permission.USER_MANAGE)
  @ApiOperation({
    summary: 'Set a new password for a staff member (unlocks them, ends their sessions)',
  })
  async resetPassword(
    @UuidParam('id') id: string,
    @Body(zodBody(ResetStaffPasswordSchema)) dto: ResetStaffPasswordDto,
  ) {
    await this.users.resetPassword(id as UserId, dto.password);
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
