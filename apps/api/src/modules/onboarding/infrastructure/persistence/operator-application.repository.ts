import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { newId, type Json } from '@kernel';

import type { ApplicationStatus } from '../../domain/application-status';

export interface OperatorApplicationRow {
  id: string;
  status: ApplicationStatus;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  passwordHash: string;
  companyName: string;
  [k: string]: unknown;
}

/**
 * Operator-application persistence. Platform-level (no tenant scope) — these
 * exist before any tenant. Reads run as the platform admin; writes on approval
 * run inside the provisioning transaction.
 */
@Injectable()
export class OperatorApplicationRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: {
    firstName: string; lastName: string; email: string; mobile: string; designation?: string; passwordHash: string;
    companyName: string; companyType?: string; gstNumber?: string; panNumber?: string; registrationNumber?: string;
    officialEmail?: string; companyMobile?: string; website?: string;
    addressLine1?: string; addressLine2?: string; city?: string; state?: string; country?: string; pinCode?: string;
    bankAccountHolder?: string; bankAccountNumber?: string; bankIfsc?: string; bankName?: string;
    business: Json; documents: Json;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO operator_applications
        (id, first_name, last_name, email, mobile, designation, password_hash,
         company_name, company_type, gst_number, pan_number, registration_number,
         official_email, company_mobile, website,
         address_line1, address_line2, city, state, country, pin_code,
         bank_account_holder, bank_account_number, bank_ifsc, bank_name, business, documents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [id, input.firstName, input.lastName, input.email, input.mobile, input.designation ?? null, input.passwordHash,
       input.companyName, input.companyType ?? null, input.gstNumber ?? null, input.panNumber ?? null, input.registrationNumber ?? null,
       input.officialEmail ?? null, input.companyMobile ?? null, input.website ?? null,
       input.addressLine1 ?? null, input.addressLine2 ?? null, input.city ?? null, input.state ?? null, input.country ?? 'India', input.pinCode ?? null,
       input.bankAccountHolder ?? null, input.bankAccountNumber ?? null, input.bankIfsc ? input.bankIfsc.toUpperCase() : null, input.bankName ?? null,
       JSON.stringify(input.business), JSON.stringify(input.documents)],
      { name: 'onboarding.insert', primary: true },
    );
    return id;
  }

  /**
   * Checks for a PENDING or ALREADY-APPROVED application matching any of
   * email/mobile/GST/PAN — apply() calls this before inserting a new one.
   * A REJECTED prior application never blocks a fresh attempt (matching
   * the same "don't permanently lock someone out" principle as customer
   * registration's own reuse logic) — someone who was rejected for a
   * fixable reason (missing document, needs re-review) must be able to
   * apply again. What this DOES stop is the more serious case: someone
   * submitting a SECOND application claiming a GST/PAN that's already
   * tied to a pending-or-approved application — impersonating (or
   * simply duplicating) a business that's already in the review pipeline
   * or already running on the platform.
   */
  async findActiveDuplicate(input: { email: string; mobile: string; gstNumber?: string; panNumber?: string; excludeId?: string }): Promise<{ id: string; matchedOn: string } | null> {
    const row = await this.db.queryOne<{ id: string; matched_on: string }>(
      `SELECT id,
              CASE
                WHEN lower(email) = lower($1) THEN 'email'
                WHEN mobile = $2 THEN 'mobile'
                WHEN $3::text IS NOT NULL AND gst_number = $3 THEN 'gst_number'
                WHEN $4::text IS NOT NULL AND pan_number = $4 THEN 'pan_number'
              END AS matched_on
         FROM operator_applications
        WHERE status IN ('pending', 'approved')
          AND ($5::uuid IS NULL OR id <> $5::uuid)
          AND (lower(email) = lower($1) OR mobile = $2
               OR ($3::text IS NOT NULL AND gst_number = $3)
               OR ($4::text IS NOT NULL AND pan_number = $4))
        LIMIT 1`,
      [input.email, input.mobile, input.gstNumber ?? null, input.panNumber ?? null, input.excludeId ?? null],
      { name: 'onboarding.findActiveDuplicate', primary: true },
    );
    return row ? { id: row.id, matchedOn: row.matched_on } : null;
  }

  async list(status?: ApplicationStatus): Promise<unknown[]> {
    const params: unknown[] = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE oa.status = $1`; }
    return this.db.query(
      `SELECT oa.id, oa.status, oa.first_name AS "firstName", oa.last_name AS "lastName", oa.email, oa.mobile,
              oa.company_name AS "companyName", oa.city, oa.state, oa.created_at AS "createdAt", oa.reviewed_at AS "reviewedAt",
              oa.review_note AS "reviewNote", oa.rejection_reason AS "rejectionReason", oa.reopened_count AS "reopenedCount",
              oa.gst_number AS "gstNumber", oa.pan_verification_status AS "panVerificationStatus",
              t.slug AS "tenantSlug"
         FROM operator_applications oa
         LEFT JOIN tenants t ON t.id = oa.provisioned_tenant_id
         ${where} ORDER BY oa.created_at DESC LIMIT 200`,
      params,
      { name: 'onboarding.list' },
    );
  }

  async getFull(id: string): Promise<Record<string, unknown> | null> {
    return this.db.queryOne(
      `SELECT * FROM operator_applications WHERE id = $1`,
      [id],
      { name: 'onboarding.getFull', primary: true },
    );
  }

  async findForUpdate(id: string): Promise<OperatorApplicationRow | null> {
    const scope = currentTransaction();
    if (!scope) throw new Error('findForUpdate requires a transaction');
    const res = await scope.client.query<OperatorApplicationRow>(
      `SELECT id, status, first_name AS "firstName", last_name AS "lastName", email, mobile, password_hash AS "passwordHash",
              company_name AS "companyName", company_type AS "companyType", gst_number AS "gstNumber",
              official_email AS "officialEmail", company_mobile AS "companyMobile",
              address_line1 AS "addressLine1", address_line2 AS "addressLine2", city, state, country, pin_code AS "pinCode",
              bank_account_holder AS "bankAccountHolder", bank_account_number AS "bankAccountNumber",
              bank_ifsc AS "bankIfsc", bank_name AS "bankName",
              pan_number AS "panNumber", pan_verification_status AS "panVerificationStatus"
         FROM operator_applications WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async markApproved(id: string, tenantId: string, reviewerId: string | null): Promise<void> {
    const scope = currentTransaction();
    await scope!.client.query(
      `UPDATE operator_applications SET status='approved', provisioned_tenant_id=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`,
      [id, tenantId, reviewerId],
    );
  }

  async markRejected(id: string, reason: string, reviewerId: string | null): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('markRejected requires a transaction');
    await scope.client.query(
      `UPDATE operator_applications SET status='rejected', rejection_reason=$2, review_note=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now() WHERE id=$1`,
      [id, reason, reviewerId],
    );
  }

  /** Stays pending; the reason is shown to reviewers and emailed to the applicant ("info requested"). */
  async markOnHold(id: string, reason: string, reviewerId: string | null): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('markOnHold requires a transaction');
    await scope.client.query(
      `UPDATE operator_applications SET review_note=$2, reviewed_by=$3, reviewed_at=now(), updated_at=now() WHERE id=$1`,
      [id, reason, reviewerId],
    );
  }

  /** rejected → pending. The old rejection reason stays in the event history, not on the live row. */
  async markReopened(id: string, reason: string, reviewerId: string | null): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('markReopened requires a transaction');
    await scope.client.query(
      `UPDATE operator_applications SET status='pending', rejection_reason=NULL, review_note=$2, reviewed_by=$3,
              reviewed_at=now(), reopened_count = reopened_count + 1, updated_at=now() WHERE id=$1`,
      [id, reason, reviewerId],
    );
  }

  async recordEvent(input: { applicationId: string; from: ApplicationStatus | null; to: ApplicationStatus; reason: string | null; actorId: string | null }): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('recordEvent requires a transaction');
    await scope.client.query(
      `INSERT INTO operator_application_events (application_id, from_status, to_status, reason, actor_id) VALUES ($1,$2,$3,$4,$5)`,
      [input.applicationId, input.from, input.to, input.reason, input.actorId],
    );
  }

  async events(applicationId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT e.id, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.reason, e.created_at AS "createdAt",
              u.full_name AS "actorName"
         FROM operator_application_events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.application_id = $1 ORDER BY e.created_at, e.id`,
      [applicationId],
      { name: 'onboarding.events' },
    );
  }

  /** Is an operator with this GSTIN already live (e.g. provisioned directly, not via an application)? */
  async liveTenantWithGstin(gstin: string): Promise<{ id: string; displayName: string } | null> {
    const scope = currentTransaction();
    if (!scope) throw new Error('liveTenantWithGstin requires a transaction');
    const res = await scope.client.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM tenants WHERE upper(gstin) = upper($1) AND status <> 'closed' LIMIT 1`,
      [gstin],
    );
    return res.rows[0] ? { id: res.rows[0].id, displayName: res.rows[0].display_name } : null;
  }
}
