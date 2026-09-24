import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import {
  newId,
  NotFoundError,
  requireTenantId,
  type LocalDate,
  type SeatLayoutId,
  type UserId,
  type VehicleId,
  type VehicleTypeId,
} from '@kernel';

import type { VehicleDocument, PermitType } from '../../domain/document-expiry';
import type { DocVerification, DocVersion, VerificationStatus } from '../../domain/vehicle-verification';

registerConstraintMessages({
  vehicles_tenant_id_registration_no_key: 'A vehicle with this registration already exists',
  vehicles_registration_global_uq: 'This registration number is already listed on the platform (possibly by another operator). Contact support if this bus is yours.',
  vehicles_chassis_global_uq: 'This chassis number is already registered on the platform',
  vehicle_registration_immutable: 'The registration number of a bus can never be changed once added',
  vehicle_chassis_immutable: 'The chassis number of a bus can never be changed once set',
  vehicle_not_verified: 'This bus is not verified by the platform yet and cannot be put into service',
  vehicle_documents_one_pending_uq: 'A submission for this document is already awaiting review',
  vehicle_documents_valid_range: 'Valid-from date cannot be after the expiry date',
  vehicle_media_photo_only: 'Only photos can be attached to a bus',
  vehicle_media_file_id_key: 'This file is already attached',
});

export interface VehicleMedia {
  id: string;
  kind: 'photo';
  fileId: string;
  caption: string | null;
  position: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export type VehicleStatus = 'active' | 'maintenance' | 'retired';

export interface Vehicle {
  id: VehicleId;
  registrationNo: string;
  vehicleTypeId: VehicleTypeId;
  seatLayoutId: SeatLayoutId | null;
  status: VehicleStatus;
  make: string | null;
  model: string | null;
  odometerKm: number;
  photoUrl?: string | null;
  serviceNote?: string | null;
  permitType?: PermitType | null;
  verificationStatus: VerificationStatus;
  verificationReason: string | null;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  manufactureYear: number | null;
  chassisNo: string | null;
  engineNo: string | null;
  fuelType: string | null;
  bodyColor: string | null;
  registeredOwner: string | null;
  registrationState: string | null;
  registrationDate: string | null;
  gpsDeviceId: string | null;
  hasAc: boolean | null;
  createdAt?: Date;
}

export interface VehicleDetailsInput {
  make?: string;
  model?: string;
  manufactureYear?: number;
  chassisNo?: string;
  engineNo?: string;
  fuelType?: string;
  bodyColor?: string;
  registeredOwner?: string;
  registrationState?: string;
  registrationDate?: string;
  gpsDeviceId?: string;
  hasAc?: boolean;
  seatLayoutId?: SeatLayoutId;
  photoUrl?: string;
}

export interface DocumentVersionRow extends DocVersion {
  issuer: string | null;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  rejectionReason: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

const VEHICLE_COLS = `id, registration_no, vehicle_type_id, seat_layout_id, status, make, model, odometer_km, photo_url, service_note,
  permit_type, verification_status, verification_reason, submitted_at, verified_at, manufacture_year, chassis_no, engine_no,
  fuel_type, body_color, registered_owner, registration_state, registration_date::text AS registration_date, gps_device_id, has_ac, created_at`;

@Injectable()
export class VehicleRepository {
  constructor(private readonly db: DatabaseService) {}

  /** New buses always start as 'draft' — never live until the platform verifies their papers. */
  async create(input: VehicleDetailsInput & { registrationNo: string; vehicleTypeId: VehicleTypeId }): Promise<VehicleId> {
    const id = newId() as VehicleId;
    await this.db.execute_(
      `INSERT INTO vehicles (id, tenant_id, registration_no, vehicle_type_id, seat_layout_id, make, model, manufacture_year, photo_url,
                            chassis_no, engine_no, fuel_type, body_color, registered_owner, registration_state, registration_date,
                            gps_device_id, has_ac, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'draft')`,
      [id, requireTenantId(), input.registrationNo, input.vehicleTypeId, input.seatLayoutId ?? null, input.make ?? null,
        input.model ?? null, input.manufactureYear ?? null, input.photoUrl ?? null, input.chassisNo ?? null, input.engineNo ?? null,
        input.fuelType ?? null, input.bodyColor ?? null, input.registeredOwner ?? null, input.registrationState ?? null,
        input.registrationDate ?? null, input.gpsDeviceId ?? null, input.hasAc ?? null],
      { name: 'vehicle.create', primary: true },
    );
    return id;
  }

  /**
   * Update descriptive details. registration_no is NOT a parameter at all —
   * there is no code path that can change it (and a DB trigger backs that up).
   * chassis_no only fills a NULL (trigger again).
   */
  async updateDetails(id: VehicleId, input: VehicleDetailsInput): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE vehicles SET
         make = coalesce($3, make), model = coalesce($4, model), manufacture_year = coalesce($5, manufacture_year),
         chassis_no = coalesce(chassis_no, $6), engine_no = coalesce($7, engine_no), fuel_type = coalesce($8, fuel_type),
         body_color = coalesce($9, body_color), registered_owner = coalesce($10, registered_owner),
         registration_state = coalesce($11, registration_state), registration_date = coalesce($12::date, registration_date),
         gps_device_id = coalesce($13, gps_device_id), has_ac = coalesce($14, has_ac),
         seat_layout_id = coalesce($15, seat_layout_id), photo_url = coalesce($16, photo_url),
         version = version + 1
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id, input.make ?? null, input.model ?? null, input.manufactureYear ?? null, input.chassisNo ?? null,
        input.engineNo ?? null, input.fuelType ?? null, input.bodyColor ?? null, input.registeredOwner ?? null,
        input.registrationState ?? null, input.registrationDate ?? null, input.gpsDeviceId ?? null, input.hasAc ?? null,
        input.seatLayoutId ?? null, input.photoUrl ?? null],
      { name: 'vehicle.updateDetails', primary: true },
    );
    if (affected === 0) throw new NotFoundError('Vehicle', id);
  }

  async setPhotoAndNote(id: VehicleId, input: { photoUrl?: string; serviceNote?: string }): Promise<void> {
    await this.db.execute_(
      `UPDATE vehicles SET photo_url = coalesce($3, photo_url), service_note = coalesce($4, service_note) WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, input.photoUrl ?? null, input.serviceNote ?? null],
      { name: 'vehicle.setPhotoAndNote', primary: true },
    );
  }

  async findById(id: VehicleId, forUpdate = false): Promise<Vehicle | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT ${VEHICLE_COLS} FROM vehicles WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
      [requireTenantId(), id],
      { name: 'vehicle.findById', primary: forUpdate },
    );
    return row ? map(row) : null;
  }

  async getById(id: VehicleId): Promise<Vehicle> {
    const found = await this.findById(id);
    if (!found) throw new NotFoundError('Vehicle', id);
    return found;
  }

  /** Row lock for every verification transition. */
  async lockById(id: VehicleId): Promise<Vehicle> {
    const found = await this.findById(id, true);
    if (!found) throw new NotFoundError('Vehicle', id);
    return found;
  }

  /** Paginated + searchable — by registration number or make/model — for the fleet console's list view. */
  async list(input: { status?: VehicleStatus; verification?: VerificationStatus; search?: string; page?: number; pageSize?: number } = {}): Promise<{ items: Vehicle[]; total: number }> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
    const conditions = ['tenant_id = $1', 'deleted_at IS NULL'];
    const params: unknown[] = [requireTenantId()];
    if (input.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
    if (input.verification) { params.push(input.verification); conditions.push(`verification_status = $${params.length}`); }
    if (input.search?.trim()) {
      params.push(`%${input.search.trim()}%`);
      conditions.push(`(registration_no ILIKE $${params.length} OR make ILIKE $${params.length} OR model ILIKE $${params.length})`);
    }
    const where = conditions.join(' AND ');
    const total = await this.db.queryOne<{ n: string }>(`SELECT count(*) AS n FROM vehicles WHERE ${where}`, params, { name: 'vehicle.count' });
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.db.query<Row>(
      `SELECT ${VEHICLE_COLS} FROM vehicles WHERE ${where} ORDER BY registration_no LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
      { name: 'vehicle.list' },
    );
    return { items: rows.map(map), total: Number(total?.n ?? 0) };
  }

  async setStatus(id: VehicleId, status: VehicleStatus): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE vehicles SET status=$3, version=version+1, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [requireTenantId(), id, status],
      { name: 'vehicle.setStatus', primary: true },
    );
    if (affected === 0) throw new NotFoundError('Vehicle', id);
  }

  async setVerification(id: VehicleId, input: { status: VerificationStatus; reason: string | null; actorId: UserId | null }): Promise<void> {
    await this.db.execute_(
      `UPDATE vehicles SET verification_status = $3, verification_reason = $4,
              submitted_at = CASE WHEN $3 = 'submitted' THEN now() ELSE submitted_at END,
              verified_at  = CASE WHEN $3 = 'approved' THEN now() ELSE verified_at END,
              verified_by  = CASE WHEN $3 IN ('approved', 'rejected', 'suspended') THEN $5::uuid ELSE verified_by END,
              version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id, input.status, input.reason, input.actorId],
      { name: 'vehicle.setVerification', primary: true },
    );
  }

  /**
   * A suspended bus must not stay attached to future departures: unassign it
   * from every future trip and from any service that defaults to it. Returns
   * how many future trips now need a replacement bus.
   */
  async detachFromFutureService(id: VehicleId): Promise<number> {
    const tenantId = requireTenantId();
    const trips = await this.db.execute_(
      `UPDATE trips SET vehicle_id = NULL WHERE tenant_id = $1 AND vehicle_id = $2 AND departs_at > now()`,
      [tenantId, id],
      { name: 'vehicle.detachTrips', primary: true },
    );
    await this.db.execute_(
      `UPDATE services SET default_vehicle_id = NULL WHERE tenant_id = $1 AND default_vehicle_id = $2`,
      [tenantId, id],
      { name: 'vehicle.detachServices', primary: true },
    );
    return trips;
  }

  /* ── documents ──────────────────────────────────────────────────────────*/

  /**
   * Add a new document VERSION (pending review). An earlier still-pending
   * upload of the same type is superseded — the admin only ever reviews the
   * latest — while an earlier VERIFIED version is kept until a newer one is
   * verified, so a renewal in review never takes a compliant bus off the road.
   */
  async addDocumentVersion(vehicleId: VehicleId, doc: {
    docType: string; documentNo?: string | null; validFrom?: string | null; expiresOn: string; issuer?: string | null; fileId: string;
  }): Promise<string> {
    const tenantId = requireTenantId();
    await this.db.execute_(
      `UPDATE vehicle_documents SET superseded_at = now()
        WHERE tenant_id = $1 AND vehicle_id = $2 AND doc_type = $3 AND verification_status IN ('pending', 'rejected') AND superseded_at IS NULL`,
      [tenantId, vehicleId, doc.docType],
      { name: 'vehicle.doc.supersedePending', primary: true },
    );
    const id = newId();
    await this.db.execute_(
      `INSERT INTO vehicle_documents (id, tenant_id, vehicle_id, doc_type, document_no, valid_from, expires_on, issuer, file_id, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
      [id, tenantId, vehicleId, doc.docType, doc.documentNo?.trim() || null, doc.validFrom ?? null, doc.expiresOn,
        doc.issuer ?? null, doc.fileId],
      { name: 'vehicle.doc.insert', primary: true },
    );
    return id;
  }

  /** Kept for existing callers: now a thin wrapper that requires an uploaded file. */
  async upsertDocument(vehicleId: VehicleId, doc: { docType: string; documentNo?: string; validFrom?: LocalDate; expiresOn: LocalDate; issuer?: string; fileId: string }): Promise<void> {
    await this.addDocumentVersion(vehicleId, doc);
  }

  async lockDocument(vehicleId: VehicleId, docId: string): Promise<DocumentVersionRow | null> {
    const rows = await this.documentVersions(vehicleId, { docId, forUpdate: true, includeSuperseded: true });
    return rows[0] ?? null;
  }

  async setDocumentVerification(docId: string, input: { status: DocVerification; reason: string | null; actorId: UserId | null }): Promise<void> {
    await this.db.execute_(
      `UPDATE vehicle_documents SET verification_status = $3, rejection_reason = $4,
              verified_by = $5, verified_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), docId, input.status, input.reason, input.actorId],
      { name: 'vehicle.doc.setVerification', primary: true },
    );
  }

  /** Once a newer version is verified, older verified versions of that type are history. */
  async supersedeOlderVerified(vehicleId: VehicleId, docType: string, keepId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE vehicle_documents SET superseded_at = now()
        WHERE tenant_id = $1 AND vehicle_id = $2 AND doc_type = $3 AND id <> $4
          AND verification_status = 'verified' AND superseded_at IS NULL`,
      [requireTenantId(), vehicleId, docType, keepId],
      { name: 'vehicle.doc.supersedeVerified', primary: true },
    );
  }

  async documentVersions(vehicleId: VehicleId, opts: { docId?: string; forUpdate?: boolean; includeSuperseded?: boolean } = {}): Promise<DocumentVersionRow[]> {
    const rows = await this.db.query<DocRow>(
      `SELECT d.id, d.doc_type, d.document_no, d.valid_from::text AS valid_from, d.expires_on::text AS expires_on, d.issuer,
              d.verification_status, d.rejection_reason, d.verified_at, d.superseded_at::text AS superseded_at, d.created_at,
              d.file_id, f.file_name, f.mime_type, f.size_bytes
         FROM vehicle_documents d
         LEFT JOIN stored_files f ON f.id = d.file_id
        WHERE d.tenant_id = $1 AND d.vehicle_id = $2
          AND ($3::uuid IS NULL OR d.id = $3::uuid)
          AND ($4::boolean OR d.superseded_at IS NULL)
        ORDER BY d.doc_type, d.created_at DESC
        ${opts.forUpdate ? 'FOR UPDATE OF d' : ''}`,
      [requireTenantId(), vehicleId, opts.docId ?? null, opts.includeSuperseded ?? false],
      { name: 'vehicle.doc.versions', primary: !!opts.forUpdate },
    );
    return rows.map((r) => ({
      id: r.id, docType: r.doc_type, documentNo: r.document_no, validFrom: r.valid_from, expiresOn: r.expires_on,
      status: r.verification_status, hasFile: !!r.file_id, supersededAt: r.superseded_at, issuer: r.issuer,
      fileId: r.file_id, fileName: r.file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes,
      rejectionReason: r.rejection_reason, verifiedAt: r.verified_at, createdAt: r.created_at,
    }));
  }

  /**
   * Documents that currently COUNT for road-legality (verified, current
   * version). Unverified uploads are deliberately excluded — an operator
   * typing in a date is not proof of anything.
   */
  async loadDocuments(vehicleId: VehicleId): Promise<VehicleDocument[]> {
    const rows = await this.db.query<{ doc_type: string; valid_from: LocalDate | null; expires_on: LocalDate }>(
      `SELECT doc_type, valid_from, expires_on FROM vehicle_documents
        WHERE tenant_id = $1 AND vehicle_id = $2 AND verification_status = 'verified' AND superseded_at IS NULL`,
      [requireTenantId(), vehicleId],
      { name: 'vehicle.loadDocuments' },
    );
    return rows.map((r) => ({ type: r.doc_type, validFrom: r.valid_from, expiresOn: r.expires_on }));
  }

  /* ── media (photos only) ─────────────────────────────────────────────────*/

  /** The operator's plan quota (null = unlimited / no plan) and current non-retired bus count. */
  async quotaState(key: string): Promise<{ quotas: Record<string, number>; count: number }> {
    const row = await this.db.queryOne<{ quotas: Record<string, unknown> | null; n: string }>(
      `SELECT p.quotas, (SELECT count(*) FROM vehicles v WHERE v.tenant_id = t.id AND v.status <> 'retired') AS n
         FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
      [requireTenantId()], { name: 'vehicle.quotaState', primary: true });
    const quotas: Record<string, number> = {};
    for (const [k, v] of Object.entries(row?.quotas ?? {})) if (typeof v === 'number') quotas[k] = v;
    void key;
    return { quotas, count: Number(row?.n ?? 0) };
  }

  async listMedia(vehicleId: VehicleId): Promise<VehicleMedia[]> {
    return this.db.query<VehicleMedia>(
      `SELECT m.id, m.kind, m.file_id AS "fileId", m.caption, m.position, m.created_at AS "createdAt",
              f.file_name AS "fileName", f.mime_type AS "mimeType", f.size_bytes AS "sizeBytes"
         FROM vehicle_media m JOIN stored_files f ON f.id = m.file_id
        WHERE m.tenant_id = $1 AND m.vehicle_id = $2 AND m.deleted_at IS NULL
        ORDER BY m.position, m.created_at`,
      [requireTenantId(), vehicleId],
      { name: 'vehicle.media.list' },
    );
  }

  async countMedia(vehicleId: VehicleId, kind: 'photo'): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM vehicle_media WHERE tenant_id = $1 AND vehicle_id = $2 AND kind = $3 AND deleted_at IS NULL`,
      [requireTenantId(), vehicleId, kind],
      { name: 'vehicle.media.count', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  async addMedia(vehicleId: VehicleId, input: { kind: 'photo'; fileId: string; caption?: string | null; position: number }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO vehicle_media (id, tenant_id, vehicle_id, kind, file_id, caption, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, requireTenantId(), vehicleId, input.kind, input.fileId, input.caption ?? null, input.position],
      { name: 'vehicle.media.add', primary: true },
    );
    return id;
  }

  async removeMedia(vehicleId: VehicleId, mediaId: string): Promise<{ fileId: string } | null> {
    const row = await this.db.queryOne<{ file_id: string }>(
      `UPDATE vehicle_media SET deleted_at = now()
        WHERE tenant_id = $1 AND vehicle_id = $2 AND id = $3 AND deleted_at IS NULL RETURNING file_id`,
      [requireTenantId(), vehicleId, mediaId],
      { name: 'vehicle.media.remove', primary: true },
    );
    return row ? { fileId: row.file_id } : null;
  }

  /** The cover photo used in lists (first photo). */
  async setCoverPhoto(vehicleId: VehicleId, url: string | null): Promise<void> {
    await this.db.execute_(`UPDATE vehicles SET photo_url = $3 WHERE tenant_id = $1 AND id = $2`, [requireTenantId(), vehicleId, url], { name: 'vehicle.setCover', primary: true });
  }

  async getPermitType(vehicleId: VehicleId): Promise<PermitType | null> {
    const row = await this.db.queryOne<{ permit_type: PermitType | null }>(
      `SELECT permit_type FROM vehicles WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), vehicleId],
      { name: 'vehicle.getPermitType' },
    );
    return row?.permit_type ?? null;
  }

  async setPermitType(vehicleId: VehicleId, permitType: PermitType): Promise<void> {
    await this.db.execute_(
      `UPDATE vehicles SET permit_type = $3, version = version + 1 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), vehicleId, permitType],
      { name: 'vehicle.setPermitType', primary: true },
    );
  }
}

interface Row {
  id: VehicleId; registration_no: string; vehicle_type_id: VehicleTypeId;
  seat_layout_id: SeatLayoutId | null; status: VehicleStatus;
  make: string | null; model: string | null; odometer_km: number;
  photo_url?: string | null; service_note?: string | null; permit_type?: PermitType | null;
  verification_status: VerificationStatus; verification_reason: string | null; submitted_at: Date | null; verified_at: Date | null;
  manufacture_year: number | null; chassis_no: string | null; engine_no: string | null; fuel_type: string | null;
  body_color: string | null; registered_owner: string | null; registration_state: string | null; registration_date: string | null;
  gps_device_id: string | null; has_ac: boolean | null; created_at: Date;
}
interface DocRow {
  id: string; doc_type: string; document_no: string | null; valid_from: string | null; expires_on: string; issuer: string | null;
  verification_status: DocVerification; rejection_reason: string | null; verified_at: Date | null; superseded_at: string | null;
  created_at: Date; file_id: string | null; file_name: string | null; mime_type: string | null; size_bytes: number | null;
}
export function map(r: Row): Vehicle {
  return {
    id: r.id, registrationNo: r.registration_no, vehicleTypeId: r.vehicle_type_id,
    seatLayoutId: r.seat_layout_id, status: r.status, make: r.make, model: r.model, odometerKm: r.odometer_km,
    photoUrl: r.photo_url, serviceNote: r.service_note, permitType: r.permit_type ?? null,
    verificationStatus: r.verification_status, verificationReason: r.verification_reason, submittedAt: r.submitted_at,
    verifiedAt: r.verified_at, manufactureYear: r.manufacture_year, chassisNo: r.chassis_no, engineNo: r.engine_no,
    fuelType: r.fuel_type, bodyColor: r.body_color, registeredOwner: r.registered_owner, registrationState: r.registration_state,
    registrationDate: r.registration_date, gpsDeviceId: r.gps_device_id, hasAc: r.has_ac, createdAt: r.created_at,
  };
}
