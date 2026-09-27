import { Body, Controller, Delete, Get, Patch, Post, Put, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { AppConfig } from '@config';
import { Permission } from '@contracts';
import { UnitOfWork } from '@database';
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
  BadRequestError,
  DomainError,
  ErrorCode,
  localDate,
  requireTenantId,
  todayIn,
  type CrewId,
  type DutyId,
  type TripId,
  type VehicleId,
} from '@kernel';

import { CrewRepository } from '../infrastructure/persistence/crew.repository';
import { CrewService } from '../application/services/crew.service';
import {
  AssignDutySchema,
  AttendanceSchema,
  BulkImportVehiclesSchema,
  CreateCrewSchema,
  CreateVehicleSchema,
  ExpiringQuerySchema,
  ListDutiesQuerySchema,
  CrewRulesSchema,
  ListCrewQuerySchema,
  ListVehiclesQuerySchema,
  MaintenanceLogSchema,
  UpdateCrewSchema,
  UpdateVehicleSchema,
  UploadDocumentSchema,
  VehicleDocumentUploadQuerySchema,
  VehiclePermitTypeSchema,
  VehiclePhotoNoteSchema,
  VehiclePhotoUploadQuerySchema,
  VehicleStatusSchema,
  type AssignDutyDto,
  type BulkImportVehiclesDto,
  type CreateCrewDto,
  type CreateVehicleDto,
  type ExpiringQueryDto,
  type ListDutiesQueryDto,
  type ListCrewQueryDto,
  type ListVehiclesQueryDto,
  type MaintenanceLogDto,
  type UpdateCrewDto,
  type UpdateVehicleDto,
  type UploadDocumentDto,
  type VehicleDocumentUploadQueryDto,
  type VehiclePermitTypeDto,
  type VehiclePhotoNoteDto,
  type VehiclePhotoUploadQueryDto,
  type VehicleStatusDto,
} from './dto/fleet.dto';
import { VehicleVerificationService } from '../application/services/vehicle-verification.service';
import { FleetLogsRepository } from '../infrastructure/persistence/logs.repository';
import { FleetService } from '../application/services/fleet.service';
import { VehicleRepository } from '../infrastructure/persistence/vehicle.repository';
import { PlatformBillingService } from '../../platform-settings';

@ApiTags('fleet')
@ApiBearerAuth('bearer')
@Controller({ path: 'fleet', version: '1' })
@ApiStandardErrors()
export class FleetController {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly fleet: FleetService,
    private readonly crew: CrewRepository,
    private readonly crewService: CrewService,
    private readonly logs: FleetLogsRepository,
    private readonly uow: UnitOfWork,
    private readonly billing: PlatformBillingService,
    private readonly verification: VehicleVerificationService,
    private readonly config: AppConfig,
  ) {}

  /* ── vehicles ───────────────────────────────────────────────────────────*/

  @Post('vehicles')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary:
      'Add a bus (starts as draft — cannot run until the platform verifies its documents). Charges the one-time per-bus fee.',
  })
  async createVehicle(@Body(zodBody(CreateVehicleSchema)) dto: CreateVehicleDto) {
    const tenantId = requireTenantId();
    const id = await this.uow.run({ name: 'fleet.createVehicle', tenantId }, async () => {
      const vehicleId = await this.verification.create(dto as never);
      // Same transaction as the registration itself — a rolled-back create
      // never leaves an orphaned charge (unique index on the charge too).
      await this.billing.chargePerBusFee(tenantId, vehicleId);
      return vehicleId;
    });
    return { id, verificationStatus: 'draft' };
  }

  @Get('vehicles')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({
    summary: 'List buses (filter by status / verification, search by registration or make/model)',
  })
  async listVehicles(@Query(zodQuery(ListVehiclesQuerySchema)) q: ListVehiclesQueryDto) {
    return this.vehicles.list(q);
  }

  @Get('vehicles/:id')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({
    summary: 'Bus details, every document version, compliance and what is blocking verification',
  })
  async getVehicle(@UuidParam('id') id: string) {
    return this.verification.detail(id as VehicleId);
  }

  @Patch('vehicles/:id')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary:
      'Edit bus details. The registration number can NEVER be changed; RC facts lock once submitted/approved.',
  })
  async updateVehicle(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateVehicleSchema)) dto: UpdateVehicleDto,
  ) {
    await this.verification.updateDetails(id as VehicleId, dto as never);
    return { ok: true };
  }

  @Post('vehicles/bulk-import')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Bulk-add buses as drafts; each row validated independently' })
  async bulkImportVehicles(@Body(zodBody(BulkImportVehiclesSchema)) dto: BulkImportVehiclesDto) {
    const tenantId = requireTenantId();
    return this.verification.bulkCreate((dto?.rows ?? []) as never, (row) =>
      this.uow.run({ name: 'fleet.bulkVehicle', tenantId }, async () => {
        const vehicleId = await this.verification.create(row);
        await this.billing.chargePerBusFee(tenantId, vehicleId);
      }),
    );
  }

  @Post('vehicles/:id/status')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary:
      'Operational status. "active" is only possible for a platform-verified bus with valid papers.',
  })
  async setVehicleStatus(
    @UuidParam('id') id: string,
    @Body(zodBody(VehicleStatusSchema)) dto: VehicleStatusDto,
  ) {
    await this.verification.setOperationalStatus(id as VehicleId, dto.status);
    return { ok: true };
  }

  @Post('vehicles/:id/permit-type')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary: 'Set permit type (AITP / stage carriage / state tourist / contract carriage)',
  })
  async setVehiclePermitType(
    @UuidParam('id') id: string,
    @Body(zodBody(VehiclePermitTypeSchema)) dto: VehiclePermitTypeDto,
  ) {
    await this.vehicles.getById(id as VehicleId);
    await this.vehicles.setPermitType(id as VehicleId, dto.permitType);
    return { ok: true };
  }

  @Patch('vehicles/:id/photo-note')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Set a service note (photos are uploaded under vehicles/:id/media)' })
  async setVehiclePhotoNote(
    @UuidParam('id') id: string,
    @Body(zodBody(VehiclePhotoNoteSchema)) dto: VehiclePhotoNoteDto,
  ) {
    await this.vehicles.setPhotoAndNote(id as VehicleId, { serviceNote: dto.serviceNote });
    return { ok: true };
  }

  @Post('vehicles/:id/documents')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary:
      'Upload a document / photo (stored in object storage under {operator}/vehicles/{REG}/{type}/). Goes to pending review.',
  })
  async uploadDocument(
    @UuidParam('id') id: string,
    @Body(zodBody(UploadDocumentSchema)) dto: UploadDocumentDto,
  ) {
    return this.verification.uploadDocument(id as VehicleId, dto);
  }

  @Post('vehicles/:id/documents/file')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary:
      'Upload a document FILE as raw bytes (Content-Type: application/octet-stream). PDF/JPG/PNG/DOC/DOCX, max 5 MB. Returns fileId for POST vehicles/:id/documents.',
  })
  async uploadDocumentFile(
    @UuidParam('id') id: string,
    @Query(zodQuery(VehicleDocumentUploadQuerySchema)) q: VehicleDocumentUploadQueryDto,
    @Body() body: Buffer,
  ) {
    return this.verification.uploadDocumentFile(
      id as VehicleId,
      q.docType,
      asBuffer(body),
      q.fileName,
    );
  }

  @Get('vehicles/:id/media')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({ summary: 'Bus photos (max 10). Video uploads are not supported.' })
  async listMedia(@UuidParam('id') id: string) {
    return { items: await this.verification.listMedia(id as VehicleId) };
  }

  @Post('vehicles/:id/media')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary:
      'Add a bus photo (JPG/PNG/WEBP ≤ 5 MB, max 10). Raw bytes, Content-Type: application/octet-stream. Videos are refused.',
  })
  async addMedia(
    @UuidParam('id') id: string,
    @Query(zodQuery(VehiclePhotoUploadQuerySchema)) q: VehiclePhotoUploadQueryDto,
    @Body() body: Buffer,
  ) {
    return this.verification.addPhoto(id as VehicleId, asBuffer(body), q.fileName, q.caption);
  }

  @Delete('vehicles/:id/media/:mediaId')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Remove a photo' })
  async removeMedia(@UuidParam('id') id: string, @UuidParam('mediaId') mediaId: string) {
    await this.verification.removeMedia(id as VehicleId, mediaId);
    return { ok: true };
  }

  /** @deprecated same as POST vehicles/:id/documents — kept so older clients keep working. */
  @Put('vehicles/:id/documents')
  @RequirePermission(Permission.VEHICLE_MANAGE)
  async upsertDocument(
    @UuidParam('id') id: string,
    @Body(zodBody(UploadDocumentSchema)) dto: UploadDocumentDto,
  ) {
    return this.verification.uploadDocument(id as VehicleId, dto);
  }

  @Post('vehicles/:id/submit')
  @HttpCode(200)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({
    summary: 'Submit the bus for platform verification (all required documents must be uploaded)',
  })
  async submitVehicle(@UuidParam('id') id: string) {
    return this.verification.submit(id as VehicleId);
  }

  @Post('vehicles/:id/withdraw')
  @HttpCode(200)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Pull a submitted bus back to draft to correct something' })
  async withdrawVehicle(@UuidParam('id') id: string) {
    await this.verification.withdraw(id as VehicleId);
    return { ok: true };
  }

  @Get('expiring')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({
    summary:
      'Renewals due: bus documents expiring within `days` (or expired) and drivers whose licence is expiring, expired or missing',
  })
  async expiring(@Query(zodQuery(ExpiringQuerySchema)) q: ExpiringQueryDto) {
    const [documents, licences] = await Promise.all([
      this.vehicles.expiringDocuments(q.days),
      this.crew.expiringLicences(q.days),
    ]);
    return { days: q.days, documents, licences };
  }

  @Get('vehicles/:id/compliance')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({ summary: 'Road-legality from VERIFIED documents only' })
  async compliance(@UuidParam('id') id: string) {
    return this.fleet.compliance(id as VehicleId);
  }

  @Post('vehicles/:id/maintenance')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Record a maintenance event' })
  async addMaintenance(
    @UuidParam('id') id: string,
    @Body(zodBody(MaintenanceLogSchema)) dto: MaintenanceLogDto,
  ) {
    if (dto.performedOn > todayIn(this.config.domain.timezone))
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Maintenance can only be recorded once it is done — the date is in the future',
      );
    await this.uow.run({ name: 'fleet.addMaintenance', tenantId: requireTenantId() }, async () => {
      await this.vehicles.getById(id as VehicleId); // 404 for an unknown or another operator's bus
      await this.logs.addMaintenance(id as VehicleId, {
        kind: dto.kind,
        description: dto.description,
        odometerKm: dto.odometerKm,
        costMinor: dto.costMinor,
        performedOn: localDate(dto.performedOn),
        nextDueOn: dto.nextDueOn ? localDate(dto.nextDueOn) : undefined,
      });
    });
    return { ok: true };
  }

  @Get('vehicles/:id/maintenance')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({ summary: 'Maintenance history' })
  async listMaintenance(@UuidParam('id') id: string) {
    await this.vehicles.getById(id as VehicleId);
    return { items: await this.logs.listMaintenance(id as VehicleId) };
  }

  /* ── crew ───────────────────────────────────────────────────────────────*/

  @Post('crew')
  @HttpCode(201)
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({ summary: 'Add a crew member' })
  async createCrew(@Body(zodBody(CreateCrewSchema)) dto: CreateCrewDto) {
    const id = await this.crewService.addCrew({
      role: dto.role,
      fullName: dto.fullName,
      phone: dto.phone,
      licenceNo: dto.licenceNo,
      licenceExpiresOn: dto.licenceExpiresOn ? localDate(dto.licenceExpiresOn) : undefined,
      employeeCode: dto.employeeCode,
    });
    return { id };
  }

  @Get('crew')
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({ summary: 'List crew, with how many upcoming duties each holds' })
  async listCrew(@Query(zodQuery(ListCrewQuerySchema)) q: ListCrewQueryDto) {
    return { items: await this.crew.list({ role: q.role, status: q.status }) };
  }

  @Patch('crew/:id')
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary:
      'Edit a crew member, or put them on leave / inactive (refused while they hold upcoming duties)',
  })
  async updateCrew(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateCrewSchema)) dto: UpdateCrewDto,
  ) {
    await this.crewService.updateCrew(id as CrewId, {
      ...dto,
      licenceExpiresOn:
        dto.licenceExpiresOn === undefined || dto.licenceExpiresOn === null
          ? dto.licenceExpiresOn
          : localDate(dto.licenceExpiresOn),
    });
    return this.crew.getById(id as CrewId);
  }

  @Post('crew/duties')
  @HttpCode(201)
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary:
      'Assign a duty (overlap, rest, 24h driving, duty length, continuous driving). overrideReason approves a rule breach — never an overlap.',
  })
  async assignDuty(@Body(zodBody(AssignDutySchema)) dto: AssignDutyDto) {
    const id = await this.crewService.assignDuty({
      crewId: dto.crewId as CrewId,
      tripId: (dto.tripId ?? null) as TripId | null,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      drivingMinutes: dto.drivingMinutes,
      override: dto.overrideReason ? { reason: dto.overrideReason } : undefined,
    });
    return { id };
  }

  @Post('crew/duties/:id/attendance')
  @HttpCode(200)
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary:
      'Mark present (late after 15 min) or absent — absent raises crew.absent for a replacement',
  })
  async attendance(
    @UuidParam('id') id: string,
    @Body(zodBody(AttendanceSchema)) dto: { status: 'present' | 'absent' },
  ) {
    return this.crewService.markAttendance(id as DutyId, dto.status);
  }

  @Get('crew/:id/allowance')
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary:
      'Driving minutes still allowed in the rolling 24h window, and when the crew member is next rested',
  })
  async allowance(@UuidParam('id') id: string) {
    return this.crewService.allowance(id as CrewId);
  }

  @Get('crew-rules')
  @RequirePermission(Permission.CREW_MANAGE)
  async crewRules() {
    return this.crewService.rules();
  }

  @Put('crew-rules')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      'Operator rest rules: min rest, 24h driving cap, max duty length, continuous driving limit',
  })
  async setCrewRules(
    @Body(zodBody(CrewRulesSchema))
    dto: {
      minRestMinutes: number;
      maxDailyDrivingMinutes: number;
      maxDutyMinutes: number;
      maxContinuousDrivingMinutes?: number;
    },
  ) {
    await this.crewService.setRules(dto);
    return { ok: true };
  }

  @Get('crew-compliance')
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary: 'Approved rule exceptions, late / absent / unmarked attendance in a period',
  })
  async crewCompliance(@Query(zodQuery(DateRangeQuerySchema)) q: DateRangeQuery) {
    return { items: await this.crewService.compliance(q.from, q.to) };
  }

  @Get('crew/duties')
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary:
      'Roster: every upcoming assigned duty; ?date=YYYY-MM-DD every duty of that day (attendance sheet); ?tripId= the crew of one trip',
  })
  async listDuties(@Query(zodQuery(ListDutiesQuerySchema)) q: ListDutiesQueryDto) {
    return {
      duties: await this.crew.listDuties(q.date ? localDate(q.date) : undefined, 300, q.tripId),
    };
  }

  @Post('crew/duties/:id/cancel')
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({ summary: 'Cancel a duty' })
  async cancelDuty(@UuidParam('id') id: string) {
    await this.crewService.cancelDuty(id as DutyId);
    return { ok: true };
  }
}

/** A raw-body route only accepts Content-Type: application/octet-stream (parsed to a Buffer in bootstrap). */
function asBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body) && body.length > 0) return body;
  throw new BadRequestError(
    'Send the file as raw bytes with Content-Type: application/octet-stream',
  );
}
