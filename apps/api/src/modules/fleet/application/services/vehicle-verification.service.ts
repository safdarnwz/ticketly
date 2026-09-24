import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  DomainError,
  ErrorCode,
  NotFoundError,
  getUserId,
  runAsTenant,
  todayIn,
  type Json,
  type TenantId,
  type VehicleId,
  type VehicleTypeId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger } from '@observability';

import { FileService } from '../../../files/application/file.service';
import { MAX_PHOTOS_PER_BUS } from '../../../files/domain/upload-policy';
import { quotaExceeded } from '../../../tenancy/domain/entitlements';
import {
  ALL_DOC_TYPES,
  DOC_LABELS,
  REQUIRED_DOC_TYPES,
  approvalBlockers,
  canTransition,
  computeCompliance,
  minReason,
  normaliseRegistration,
  validateChassis,
  validateDocument,
  validateManufactureYear,
  validateRegistration,
  type VerificationStatus,
} from '../../domain/vehicle-verification';
import {
  VehicleRepository,
  type Vehicle,
  type VehicleDetailsInput,
} from '../../infrastructure/persistence/vehicle.repository';

export interface CreateVehicleRequest extends VehicleDetailsInput {
  registrationNo: string;
  vehicleTypeId: VehicleTypeId;
}

/** Facts printed on the RC — frozen once the platform has verified the bus. */
const RC_LOCKED_FIELDS: (keyof VehicleDetailsInput)[] = [
  'make',
  'model',
  'manufactureYear',
  'chassisNo',
  'engineNo',
  'registeredOwner',
  'registrationDate',
  'registrationState',
  'fuelType',
];

/**
 * ============================================================================
 *  Bus onboarding & verification
 * ============================================================================
 *
 * OPERATOR: add bus (draft) → fill details → upload each document (file goes
 * to object storage under {operator}/vehicles/{REG}/{doc}/…) → submit.
 * SUPER ADMIN: verify / reject each document with a reason → approve the bus
 * only when every required document is verified and in date; reject or
 * suspend with a reason at any point.
 * SYSTEM: a daily job suspends an approved bus whose required paper expires.
 *
 * The registration number is fixed at creation and never editable — the
 * repository has no way to change it and a DB trigger refuses it anyway.
 */
@Injectable()
export class VehicleVerificationService {
  private readonly log: Logger;

  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly files: FileService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.forContext('VehicleVerification');
  }

  /* ───────────────────────── operator ───────────────────────── */

  async create(input: CreateVehicleRequest): Promise<VehicleId> {
    // Plan quota (102): a Starter plan's bus limit is actually enforced now.
    const q = await this.vehicles.quotaState('maxVehicles');
    const limit = quotaExceeded(q.quotas, 'maxVehicles', q.count);
    if (limit !== null)
      throw new DomainError(
        ErrorCode.TENANT_QUOTA_EXCEEDED,
        `Your plan allows ${limit} buses — upgrade your plan to add more`,
      );
    const reg = validateRegistration(input.registrationNo);
    if (!reg.ok) throw new DomainError(ErrorCode.COMMON_VALIDATION, reg.error);
    this.validateDetails(input);
    return this.vehicles.create({
      ...input,
      registrationNo: reg.value,
      chassisNo: input.chassisNo?.toUpperCase().replace(/\s/g, ''),
    });
  }

  /** Bulk add: every row validated like a single add; a bad row is reported, never aborts the batch. */
  async bulkCreate(
    rows: CreateVehicleRequest[],
    each: (row: CreateVehicleRequest) => Promise<unknown>,
  ): Promise<{ imported: number; failed: { row: number; error: string }[] }> {
    let imported = 0;
    const failed: { row: number; error: string }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      try {
        const reg = validateRegistration(rows[i].registrationNo ?? '');
        if (!reg.ok) throw new Error(reg.error);
        if (seen.has(reg.value)) throw new Error(`Duplicate of an earlier row (${reg.value})`);
        seen.add(reg.value);
        await each({ ...rows[i], registrationNo: reg.value });
        imported += 1;
      } catch (e) {
        failed.push({ row: i + 1, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return { imported, failed };
  }

  async updateDetails(
    id: VehicleId,
    input: VehicleDetailsInput & { registrationNo?: string },
  ): Promise<void> {
    await this.uow.run({ name: 'vehicle.updateDetails' }, async () => {
      const v = await this.vehicles.lockById(id);
      if (
        input.registrationNo !== undefined &&
        normaliseRegistration(input.registrationNo) !== v.registrationNo
      ) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'The registration number of a bus can never be changed once added',
        );
      }
      if (
        input.chassisNo &&
        v.chassisNo &&
        input.chassisNo.toUpperCase().replace(/\s/g, '') !== v.chassisNo
      ) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'The chassis number cannot be changed once set',
        );
      }
      if (v.verificationStatus === 'approved' || v.verificationStatus === 'submitted') {
        const touched = RC_LOCKED_FIELDS.filter(
          (f) =>
            input[f] !== undefined &&
            String(input[f]) !== stringOf((v as unknown as Record<string, unknown>)[f]),
        );
        if (touched.length) {
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            `${touched.join(', ')} cannot be edited while the bus is ${v.verificationStatus} — these are verified against the RC. Contact support to correct them.`,
          );
        }
      }
      this.validateDetails(input);
      const { registrationNo: _ignored, ...details } = input;
      void _ignored;
      await this.vehicles.updateDetails(id, {
        ...details,
        chassisNo: details.chassisNo?.toUpperCase().replace(/\s/g, ''),
      });
    });
  }

  /** Step 1 of a document upload: the raw file → {operator}/vehicles/{REG}/{docType}/<id>.<ext>. */
  async uploadDocumentFile(id: VehicleId, docType: string, bytes: Buffer, fileName?: string) {
    const v = await this.vehicles.getById(id);
    if (!ALL_DOC_TYPES.includes(docType) || docType.startsWith('photo_')) {
      throw new DomainError(ErrorCode.COMMON_VALIDATION, `Unknown document type '${docType}'`);
    }
    if (v.status === 'retired')
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Cannot upload documents for a retired bus',
      );
    const f = await this.files.upload({
      purpose: 'vehicle_document',
      bytes,
      fileName,
      sub: [v.registrationNo, docType],
    });
    return { fileId: f.id, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes };
  }

  /* ── photos (no video — video uploads are not supported) ─────────── */

  async addPhoto(id: VehicleId, bytes: Buffer, fileName?: string, caption?: string) {
    const v = await this.vehicles.getById(id);
    if (v.status === 'retired')
      throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Cannot add photos to a retired bus');
    // Cheap pre-check before storing bytes; the row lock below is the real guard against races.
    if ((await this.vehicles.countMedia(id, 'photo')) >= MAX_PHOTOS_PER_BUS) {
      throw new ConflictError(
        `A bus can have at most ${MAX_PHOTOS_PER_BUS} photos — remove one first`,
      );
    }
    const f = await this.files.upload({
      purpose: 'vehicle_photo',
      bytes,
      fileName,
      sub: [v.registrationNo, 'photos'],
    });
    try {
      const mediaId = await this.uow.run({ name: 'vehicle.photo.add' }, async () => {
        await this.vehicles.lockById(id); // serialises concurrent uploads for the same bus
        const count = await this.vehicles.countMedia(id, 'photo');
        if (count >= MAX_PHOTOS_PER_BUS)
          throw new ConflictError(`A bus can have at most ${MAX_PHOTOS_PER_BUS} photos`);
        const mid = await this.vehicles.addMedia(id, {
          kind: 'photo',
          fileId: f.id,
          caption: caption?.trim().slice(0, 120) || null,
          position: count,
        });
        if (count === 0) await this.vehicles.setCoverPhoto(id, f.url);
        return mid;
      });
      return { mediaId, fileId: f.id, url: f.url, kind: 'photo' as const };
    } catch (e) {
      await this.files.remove(f.id).catch(() => undefined); // lost the race / failed: no orphan row
      throw e;
    }
  }

  async removeMedia(id: VehicleId, mediaId: string): Promise<void> {
    await this.uow.run({ name: 'vehicle.media.remove' }, async () => {
      await this.vehicles.lockById(id);
      const removed = await this.vehicles.removeMedia(id, mediaId);
      if (!removed) throw new NotFoundError('Media', mediaId);
      await this.files.remove(removed.fileId);
      const photos = (await this.vehicles.listMedia(id)).filter((m) => m.kind === 'photo');
      const cover = photos[0] ? await this.files.meta(photos[0].fileId) : null;
      await this.vehicles.setCoverPhoto(id, cover ? await this.files.urlFor(cover) : null);
    });
  }

  async listMedia(id: VehicleId) {
    await this.vehicles.getById(id);
    const media = await this.vehicles.listMedia(id);
    return Promise.all(
      media.map(async (m) => {
        const meta = await this.files.meta(m.fileId);
        return { ...m, url: meta ? await this.files.urlFor(meta) : null };
      }),
    );
  }

  async uploadDocument(
    id: VehicleId,
    input: {
      docType: string;
      documentNo?: string;
      validFrom?: string;
      expiresOn: string;
      issuer?: string;
      fileName?: string;
      /** Preferred: id from POST .../documents/file. */
      fileId?: string;
      /** Legacy: whole file as base64 in the JSON body. */
      contentBase64?: string;
    },
  ) {
    const v = await this.vehicles.getById(id);
    if (v.status === 'retired')
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Cannot upload documents for a retired bus',
      );
    const error = validateDocument({
      ...input,
      today: todayIn(),
      registrationNo: v.registrationNo,
    });
    if (error) throw new DomainError(ErrorCode.COMMON_VALIDATION, error);

    if (input.docType.startsWith('photo_'))
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Photos are uploaded under Media, not as documents',
      );
    // Object first (object storage is not transactional), then the version row.
    let file: { id: string };
    if (input.fileId) {
      file = await this.files.requireForPurpose(input.fileId, 'vehicle_document');
      const meta = await this.files.meta(input.fileId);
      if (!meta?.objectKey.includes(`/vehicles/${v.registrationNo}/`)) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'That file was uploaded for a different bus',
        );
      }
    } else if (input.contentBase64) {
      const decoded = Buffer.from(input.contentBase64.replace(/^data:[^,]*,/, ''), 'base64');
      file = await this.files.upload({
        purpose: 'vehicle_document',
        bytes: decoded,
        fileName: input.fileName ?? input.docType,
        sub: [v.registrationNo, input.docType],
      });
    } else {
      throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Attach the document file');
    }
    const docId = await this.uow.run({ name: 'vehicle.uploadDocument' }, async () => {
      await this.vehicles.lockById(id);
      return this.vehicles.addDocumentVersion(id, {
        docType: input.docType,
        documentNo: input.documentNo
          ? input.docType === 'rc'
            ? normaliseRegistration(input.documentNo)
            : input.documentNo.trim()
          : null,
        validFrom: input.validFrom ?? null,
        expiresOn: input.expiresOn,
        issuer: input.issuer ?? null,
        fileId: file.id,
      });
    });
    return { documentId: docId, fileId: file.id, status: 'pending' as const };
  }

  async submit(id: VehicleId): Promise<{ status: VerificationStatus }> {
    return this.uow.run({ name: 'vehicle.submit' }, async () => {
      const v = await this.vehicles.lockById(id);
      if (v.verificationStatus === 'submitted') return { status: v.verificationStatus };
      if (!canTransition(v.verificationStatus, 'submitted', 'operator')) {
        throw new DomainError(
          ErrorCode.COMMON_CONFLICT,
          `A bus that is '${v.verificationStatus}' cannot be submitted for verification`,
        );
      }
      if (v.status === 'retired')
        throw new DomainError(ErrorCode.COMMON_VALIDATION, 'A retired bus cannot be submitted');
      const missing = this.missingDetails(v);
      if (missing.length)
        throw new DomainError(ErrorCode.COMMON_VALIDATION, `Please fill in: ${missing.join(', ')}`);
      const c = computeCompliance(await this.vehicles.documentVersions(id), todayIn());
      if (!c.readyForSubmission) {
        const need = [...c.missing, ...c.rejected, ...c.expired].map((t) => DOC_LABELS[t] ?? t);
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Upload valid copies of: ${need.join(', ')}`,
          details: { compliance: c } as unknown as Json,
        });
      }
      await this.vehicles.setVerification(id, {
        status: 'submitted',
        reason: null,
        actorId: getUserId() ?? null,
      });
      this.events.publish({
        type: 'vehicle.submitted',
        aggregateType: 'vehicle',
        aggregateId: id,
        payload: { registrationNo: v.registrationNo },
      });
      return { status: 'submitted' as const };
    });
  }

  /** Operator pulls a submission back to fix something before the admin looks at it. */
  async withdraw(id: VehicleId): Promise<void> {
    await this.uow.run({ name: 'vehicle.withdraw' }, async () => {
      const v = await this.vehicles.lockById(id);
      if (!canTransition(v.verificationStatus, 'draft', 'operator')) {
        throw new DomainError(
          ErrorCode.COMMON_CONFLICT,
          `Only a submitted bus can be withdrawn (this one is '${v.verificationStatus}')`,
        );
      }
      await this.vehicles.setVerification(id, {
        status: 'draft',
        reason: 'Withdrawn by operator',
        actorId: getUserId() ?? null,
      });
    });
  }

  /** Operational status (active/maintenance/retired). 'active' only for a verified, compliant bus. */
  async setOperationalStatus(
    id: VehicleId,
    status: 'active' | 'maintenance' | 'retired',
  ): Promise<void> {
    await this.uow.run({ name: 'vehicle.setStatus' }, async () => {
      const v = await this.vehicles.lockById(id);
      if (status === 'active') {
        if (v.verificationStatus !== 'approved') {
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            'This bus can only be activated after the platform has verified its documents',
          );
        }
        const c = computeCompliance(await this.vehicles.documentVersions(id), todayIn());
        if (!c.compliant)
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            `Cannot activate: ${approvalBlockers(c).join('; ')}`,
          );
      }
      if (status === 'retired') await this.vehicles.detachFromFutureService(id);
      await this.vehicles.setStatus(id, status);
    });
  }

  async detail(id: VehicleId) {
    const v = await this.vehicles.getById(id);
    const docs = await this.vehicles.documentVersions(id);
    const compliance = computeCompliance(docs, todayIn());
    return {
      vehicle: v,
      documents: docs,
      media: await this.listMedia(id),
      mediaLimits: { photos: MAX_PHOTOS_PER_BUS },
      requiredDocTypes: REQUIRED_DOC_TYPES,
      docLabels: DOC_LABELS,
      compliance,
      approvalBlockers: approvalBlockers(compliance),
      missingDetails: this.missingDetails(v),
      canSubmit:
        canTransition(v.verificationStatus, 'submitted', 'operator') &&
        compliance.readyForSubmission &&
        this.missingDetails(v).length === 0,
    };
  }

  /* ───────────────────────── super admin (cross-tenant) ───────────────────────── */

  async adminList(filter: { verification?: VerificationStatus; search?: string; limit?: number }) {
    return this.uow.run({ name: 'vehicle.admin.list', bypassRls: true }, async (scope) => {
      const res = await scope.client.query<Record<string, unknown>>(
        `SELECT v.id, v.registration_no AS "registrationNo", v.make, v.model, v.manufacture_year AS "manufactureYear",
                v.verification_status AS "verificationStatus", v.verification_reason AS "verificationReason",
                v.submitted_at AS "submittedAt", v.verified_at AS "verifiedAt", v.status,
                t.id AS "tenantId", t.display_name AS "operatorName", t.slug AS "operatorSlug",
                (SELECT count(*) FROM vehicle_documents d WHERE d.vehicle_id = v.id AND d.superseded_at IS NULL AND d.verification_status = 'pending')::int AS "pendingDocuments"
           FROM vehicles v JOIN tenants t ON t.id = v.tenant_id
          WHERE v.deleted_at IS NULL
            AND ($1::text IS NULL OR v.verification_status = $1)
            AND ($2::text IS NULL OR v.registration_no ILIKE '%' || $2 || '%' OR t.display_name ILIKE '%' || $2 || '%')
          ORDER BY (v.verification_status = 'submitted') DESC, v.submitted_at NULLS LAST, v.created_at DESC
          LIMIT $3`,
        [
          filter.verification ?? null,
          filter.search?.trim() || null,
          Math.min(filter.limit ?? 100, 500),
        ],
      );
      return res.rows;
    });
  }

  async adminDetail(vehicleId: VehicleId) {
    return this.asOwner(vehicleId, () => this.detail(vehicleId));
  }

  async adminVerifyDocument(
    vehicleId: VehicleId,
    docId: string,
    decision: 'verified' | 'rejected',
    reason?: string,
  ) {
    return this.asOwner(vehicleId, () =>
      this.uow.run({ name: 'vehicle.admin.doc' }, async () => {
        const v = await this.vehicles.lockById(vehicleId);
        const doc = await this.vehicles.lockDocument(vehicleId, docId);
        if (!doc) throw new NotFoundError('Document', docId);
        if (doc.supersededAt)
          throw new ConflictError(
            'A newer version of this document has been uploaded — review that one instead',
          );
        if (doc.status !== 'pending')
          throw new ConflictError(`This document is already ${doc.status}`);
        if (decision === 'rejected') {
          const err = minReason(reason);
          if (err) throw new DomainError(ErrorCode.COMMON_VALIDATION, err);
        } else {
          if (!doc.hasFile)
            throw new DomainError(
              ErrorCode.COMMON_VALIDATION,
              'Cannot verify a document without an uploaded file',
            );
          if (doc.expiresOn < todayIn())
            throw new DomainError(
              ErrorCode.COMMON_VALIDATION,
              'This document has expired since it was uploaded — reject it and ask for the renewal',
            );
          if (
            doc.docType === 'rc' &&
            doc.documentNo &&
            normaliseRegistration(doc.documentNo) !== v.registrationNo
          ) {
            throw new DomainError(
              ErrorCode.COMMON_VALIDATION,
              'RC number does not match the bus registration',
            );
          }
        }
        const actor = getUserId() ?? null;
        await this.vehicles.setDocumentVerification(docId, {
          status: decision,
          reason: decision === 'rejected' ? reason!.trim() : null,
          actorId: actor,
        });
        if (decision === 'verified')
          await this.vehicles.supersedeOlderVerified(vehicleId, doc.docType, docId);
        this.events.publish({
          type: `vehicle.document_${decision}`,
          aggregateType: 'vehicle',
          aggregateId: vehicleId,
          payload: {
            docType: doc.docType,
            reason: reason ?? null,
            registrationNo: v.registrationNo,
          },
        });
        return { ok: true };
      }),
    );
  }

  async adminDecide(
    vehicleId: VehicleId,
    to: 'approved' | 'rejected' | 'suspended',
    reason?: string,
  ) {
    return this.asOwner(vehicleId, () =>
      this.uow.run({ name: `vehicle.admin.${to}` }, async () => {
        const v = await this.vehicles.lockById(vehicleId);
        if (v.verificationStatus === to) return { status: to, detachedTrips: 0 };
        if (!canTransition(v.verificationStatus, to, 'admin')) {
          throw new DomainError(
            ErrorCode.COMMON_CONFLICT,
            `Cannot mark a '${v.verificationStatus}' bus as ${to}`,
          );
        }
        if (to !== 'approved') {
          const err = minReason(reason);
          if (err) throw new DomainError(ErrorCode.COMMON_VALIDATION, err);
        } else {
          const c = computeCompliance(await this.vehicles.documentVersions(vehicleId), todayIn());
          const blockers = approvalBlockers(c);
          if (blockers.length)
            throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
              message: `Cannot approve: ${blockers.join('; ')}`,
              details: { blockers },
            });
          const missing = this.missingDetails(v);
          if (missing.length)
            throw new DomainError(
              ErrorCode.COMMON_VALIDATION,
              `Bus details incomplete: ${missing.join(', ')}`,
            );
        }
        await this.vehicles.setVerification(vehicleId, {
          status: to,
          reason: reason?.trim() || null,
          actorId: getUserId() ?? null,
        });
        const detachedTrips =
          to === 'suspended' ? await this.vehicles.detachFromFutureService(vehicleId) : 0;
        this.events.publish({
          type: `vehicle.${to}`,
          aggregateType: 'vehicle',
          aggregateId: vehicleId,
          payload: { registrationNo: v.registrationNo, reason: reason ?? null, detachedTrips },
        });
        return { status: to, detachedTrips };
      }),
    );
  }

  async adminFileUrl(vehicleId: VehicleId, docId: string, download: boolean) {
    return this.asOwner(vehicleId, async () => {
      const doc = (
        await this.vehicles.documentVersions(vehicleId, { docId, includeSuperseded: true })
      )[0];
      if (!doc?.fileId) throw new NotFoundError('Document file', docId);
      const meta = await this.files.meta(doc.fileId);
      if (!meta) throw new NotFoundError('File', doc.fileId);
      return {
        url: await this.files.urlFor(meta, { download }),
        meta,
        read: () => this.files.read(meta),
      };
    });
  }

  /* ───────────────────────── system: daily expiry sweep ───────────────────────── */

  /** Suspends every approved bus that no longer has valid verified papers. Returns count per tenant. */
  async suspendExpired(): Promise<number> {
    const rows = await this.uow.run(
      { name: 'vehicle.expirySweep.scan', bypassRls: true },
      async (scope) =>
        (
          await scope.client.query<{ id: string; tenant_id: string }>(
            `SELECT DISTINCT v.id, v.tenant_id FROM vehicles v
           JOIN vehicle_documents d ON d.vehicle_id = v.id
          WHERE v.verification_status = 'approved' AND v.deleted_at IS NULL
            AND d.verification_status = 'verified' AND d.superseded_at IS NULL AND d.expires_on < current_date
            AND d.doc_type = ANY($1)`,
            [REQUIRED_DOC_TYPES as unknown as string[]],
          )
        ).rows,
    );
    let suspended = 0;
    for (const r of rows) {
      try {
        await runAsTenant(r.tenant_id as TenantId, () =>
          this.uow.run(
            { name: 'vehicle.expirySweep', tenantId: r.tenant_id as TenantId },
            async () => {
              const v = await this.vehicles.lockById(r.id as VehicleId);
              if (v.verificationStatus !== 'approved') return;
              const c = computeCompliance(await this.vehicles.documentVersions(v.id), todayIn());
              if (c.compliant) return; // a renewal was verified in the meantime
              const reason = `Automatically suspended: ${approvalBlockers(c).join('; ')}`;
              await this.vehicles.setVerification(v.id, {
                status: 'suspended',
                reason,
                actorId: null,
              });
              const detachedTrips = await this.vehicles.detachFromFutureService(v.id);
              this.events.publish({
                type: 'vehicle.suspended',
                aggregateType: 'vehicle',
                aggregateId: v.id,
                payload: {
                  registrationNo: v.registrationNo,
                  reason,
                  detachedTrips,
                  automatic: true,
                },
              });
              suspended += 1;
            },
          ),
        );
      } catch (e) {
        this.log.error(
          { vehicleId: r.id, err: (e as Error).message },
          'expiry sweep failed for one bus',
        );
      }
    }
    return suspended;
  }

  /* ───────────────────────── helpers ───────────────────────── */

  private async asOwner<T>(vehicleId: VehicleId, fn: () => Promise<T>): Promise<T> {
    const tenantId = await this.uow.run(
      { name: 'vehicle.admin.owner', bypassRls: true },
      async (scope) =>
        (
          await scope.client.query<{ tenant_id: string }>(
            `SELECT tenant_id FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
            [vehicleId],
          )
        ).rows[0]?.tenant_id,
    );
    if (!tenantId) throw new NotFoundError('Vehicle', vehicleId);
    return runAsTenant(tenantId as TenantId, fn);
  }

  private validateDetails(input: VehicleDetailsInput): void {
    const chassis = validateChassis(input.chassisNo);
    if (chassis) throw new DomainError(ErrorCode.COMMON_VALIDATION, chassis);
    const year = validateManufactureYear(input.manufactureYear);
    if (year) throw new DomainError(ErrorCode.COMMON_VALIDATION, year);
    if (
      input.registrationDate &&
      (Number.isNaN(Date.parse(input.registrationDate)) || input.registrationDate > todayIn())
    ) {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Registration date must be a valid date, not in the future',
      );
    }
    if (
      input.registrationDate &&
      input.manufactureYear &&
      Number(input.registrationDate.slice(0, 4)) < input.manufactureYear - 1
    ) {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Registration date cannot be before the manufacture year',
      );
    }
  }

  private missingDetails(v: Vehicle): string[] {
    const need: [keyof Vehicle, string][] = [
      ['make', 'make'],
      ['model', 'model'],
      ['manufactureYear', 'manufacture year'],
      ['chassisNo', 'chassis number'],
      ['engineNo', 'engine number'],
      ['fuelType', 'fuel type'],
      ['registeredOwner', 'registered owner'],
    ];
    return need
      .filter(([k]) => v[k] === null || v[k] === undefined || v[k] === '')
      .map(([, label]) => label);
  }
}

export { ALL_DOC_TYPES };

/** Scalar → string for a changed-field comparison (null/undefined → ''). */
function stringOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}
