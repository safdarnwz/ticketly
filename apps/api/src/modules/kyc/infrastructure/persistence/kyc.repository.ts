import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

export type KycDocumentType = 'pan' | 'aadhaar' | 'bank_account';
export type KycVerificationStatus = 'pending' | 'otp_sent' | 'verified' | 'failed' | 'expired';

export interface KycVerificationRow {
  id: string;
  operatorApplicationId: string;
  documentType: KycDocumentType;
  status: KycVerificationStatus;
  provider: string;
  providerReference: string | null;
  verifiedName: string | null;
  maskedNumber: string | null;
  ifsc: string | null;
  failureReason: string | null;
  verifiedAt: Date | null;
}

const SELECT_COLUMNS = `id, operator_application_id AS "operatorApplicationId", document_type AS "documentType", status,
       provider, provider_reference AS "providerReference", verified_name AS "verifiedName",
       masked_number AS "maskedNumber", ifsc, failure_reason AS "failureReason", verified_at AS "verifiedAt"`;

/**
 * Platform-level (no tenant_id, no RLS) — an operator application doesn't
 * belong to a tenant yet; the tenant is only created on approval. Same
 * pattern as operator_applications itself.
 */
@Injectable()
export class KycRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    operatorApplicationId: string;
    documentType: KycDocumentType;
    provider: string;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO kyc_verifications (id, operator_application_id, document_type, provider, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [id, input.operatorApplicationId, input.documentType, input.provider],
      { name: 'kyc.create', primary: true },
    );
    return id;
  }

  /** Records that an OTP has been sent (Aadhaar flow) — providerReference is Digio's own request id, needed to submit the matching OTP back. */
  async markOtpSent(id: string, providerReference: string): Promise<void> {
    await this.db.execute_(
      `UPDATE kyc_verifications SET status = 'otp_sent', provider_reference = $2 WHERE id = $1`,
      [id, providerReference],
      { name: 'kyc.markOtpSent', primary: true },
    );
  }

  async markVerified(
    id: string,
    input: {
      verifiedName: string;
      maskedNumber: string;
      ifsc?: string;
      providerReference?: string;
    },
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE kyc_verifications SET status = 'verified', verified_name = $2, masked_number = $3, ifsc = coalesce($4, ifsc), provider_reference = coalesce($5, provider_reference), verified_at = now() WHERE id = $1`,
      [
        id,
        input.verifiedName,
        input.maskedNumber,
        input.ifsc ?? null,
        input.providerReference ?? null,
      ],
      { name: 'kyc.markVerified', primary: true },
    );
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.db.execute_(
      `UPDATE kyc_verifications SET status = 'failed', failure_reason = $2 WHERE id = $1`,
      [id, reason],
      { name: 'kyc.markFailed', primary: true },
    );
  }

  async findById(id: string): Promise<KycVerificationRow | null> {
    return this.db.queryOne<KycVerificationRow>(
      `SELECT ${SELECT_COLUMNS} FROM kyc_verifications WHERE id = $1`,
      [id],
      { name: 'kyc.findById' },
    );
  }

  async listForApplication(operatorApplicationId: string): Promise<KycVerificationRow[]> {
    return this.db.query<KycVerificationRow>(
      `SELECT ${SELECT_COLUMNS} FROM kyc_verifications WHERE operator_application_id = $1 ORDER BY created_at DESC`,
      [operatorApplicationId],
      { name: 'kyc.listForApplication' },
    );
  }

  async updateApplicationStatus(
    operatorApplicationId: string,
    documentType: KycDocumentType,
    status: KycVerificationStatus,
  ): Promise<void> {
    const column =
      documentType === 'pan'
        ? 'pan_verification_status'
        : documentType === 'aadhaar'
          ? 'aadhaar_verification_status'
          : 'bank_account_verification_status';
    await this.db.execute_(
      `UPDATE operator_applications SET ${column} = $2 WHERE id = $1`,
      [operatorApplicationId, status],
      { name: 'kyc.updateApplicationStatus', primary: true },
    );
  }
}
