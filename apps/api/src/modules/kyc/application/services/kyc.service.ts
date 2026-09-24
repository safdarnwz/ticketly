import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode } from '@kernel';

import { checkPanFormat } from '../../domain/pan';
import {
  generateAadhaarOtp, maskAccountNumber, submitAadhaarOtp, verifyBankAccount, verifyPan,
  type DigioConfig,
} from '../../infrastructure/digio/digio-client';
import { KycRepository, type KycDocumentType } from '../../infrastructure/persistence/kyc.repository';

/**
 * Three verification paths for operator onboarding:
 *
 *  - PAN format-check: instant, offline, free — confirms the PAN is
 *    STRUCTURALLY valid (see pan.ts for exactly what this can and can't
 *    prove). Always available, no configuration needed. Run this FIRST as
 *    a cheap sanity check before ever calling the paid Digio API.
 *
 *  - PAN Digio-match / Aadhaar OKYC / bank-account verification: genuine
 *    third-party confirmation via Digio (digio.in), a PAID KYC-as-a-service
 *    provider — requires DIGIO_CLIENT_ID / DIGIO_CLIENT_SECRET to be
 *    configured. Aadhaar is a two-step OTP flow (generate, then submit);
 *    PAN-match and bank-account are single synchronous calls.
 *
 * COMPLIANCE: a full Aadhaar number must never be logged, stored, or
 * returned to any caller — every Aadhaar-handling path here only ever
 * touches Digio's ALREADY-MASKED result (digio-client.ts's own
 * maskAadhaar), never a raw number from the request or response.
 */
@Injectable()
export class KycService {
  constructor(private readonly repo: KycRepository) {}

  private digioConfig(): DigioConfig | null {
    const clientId = process.env.DIGIO_CLIENT_ID;
    const clientSecret = process.env.DIGIO_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, environment: process.env.DIGIO_ENV === 'production' ? 'production' : 'sandbox' };
  }

  private requireDigio(): DigioConfig {
    const config = this.digioConfig();
    if (!config) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Digio is not configured on this deployment (DIGIO_CLIENT_ID/DIGIO_CLIENT_SECRET). Digio is a paid KYC provider — sign up at digio.in to enable this.',
      });
    }
    return config;
  }

  /** Instant, free, no configuration required. */
  async checkPanFormat(operatorApplicationId: string, pan: string): Promise<{ wellFormed: boolean; reason?: string }> {
    const result = checkPanFormat(pan);
    const kycId = await this.repo.create({ operatorApplicationId, documentType: 'pan', provider: 'format_check' });
    if (result.wellFormed) {
      await this.repo.markVerified(kycId, { verifiedName: '', maskedNumber: pan.trim().toUpperCase() });
    } else {
      await this.repo.markFailed(kycId, result.reason ?? 'Invalid PAN format');
      await this.repo.updateApplicationStatus(operatorApplicationId, 'pan', 'failed');
    }
    return { wellFormed: result.wellFormed, reason: result.reason };
  }

  /** A genuine PAN-database match via Digio — run checkPanFormat() first; there is no point paying for a lookup on a structurally-invalid PAN. */
  async verifyPanWithDigio(operatorApplicationId: string, pan: string, applicantName?: string): Promise<{ matched: boolean; nameAtPan?: string; reason?: string }> {
    const config = this.requireDigio();
    const kycId = await this.repo.create({ operatorApplicationId, documentType: 'pan', provider: 'digio' });
    try {
      const result = await verifyPan(config, pan, applicantName);
      if (result.matched) {
        await this.repo.markVerified(kycId, { verifiedName: result.nameAtPan ?? '', maskedNumber: pan.trim().toUpperCase() });
        await this.repo.updateApplicationStatus(operatorApplicationId, 'pan', 'verified');
        return { matched: true, nameAtPan: result.nameAtPan ?? undefined };
      }
      await this.repo.markFailed(kycId, `PAN status: ${result.panStatus ?? 'not found'}`);
      await this.repo.updateApplicationStatus(operatorApplicationId, 'pan', 'failed');
      return { matched: false, reason: `PAN could not be verified (status: ${result.panStatus ?? 'not found'})` };
    } catch (err) {
      await this.repo.markFailed(kycId, (err as Error).message);
      await this.repo.updateApplicationStatus(operatorApplicationId, 'pan', 'failed');
      throw new AppError(ErrorCode.PAYMENT_GATEWAY_ERROR, 502, { message: 'PAN verification service is currently unavailable — please try again shortly' });
    }
  }

  /** Step 1 of Aadhaar OKYC — sends an OTP to the Aadhaar-linked mobile. Returns OUR verification-record id (never Digio's raw id, and never the Aadhaar number) for the frontend to hold onto until the OTP screen submits. */
  async startAadhaarVerification(operatorApplicationId: string, aadhaarNumber: string): Promise<{ verificationId: string }> {
    const config = this.requireDigio();
    const digits = aadhaarNumber.replace(/\D/g, '');
    if (digits.length !== 12) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Aadhaar number must be 12 digits' });
    }
    const kycId = await this.repo.create({ operatorApplicationId, documentType: 'aadhaar', provider: 'digio' });
    try {
      const session = await generateAadhaarOtp(config, digits);
      await this.repo.markOtpSent(kycId, session.digioRequestId);
      return { verificationId: kycId };
    } catch (err) {
      await this.repo.markFailed(kycId, (err as Error).message);
      throw new AppError(ErrorCode.PAYMENT_GATEWAY_ERROR, 502, { message: 'Could not send Aadhaar OTP — please try again shortly' });
    }
  }

  /** Step 2 — the OTP the applicant received. Never accepts or returns a raw Aadhaar number; only OUR verificationId (from step 1) identifies which pending request this OTP belongs to. */
  async submitAadhaarOtp(verificationId: string, otp: string): Promise<{ verified: boolean; name?: string; maskedAadhaar?: string; reason?: string }> {
    const config = this.requireDigio();
    const record = await this.repo.findById(verificationId);
    if (!record || record.documentType !== 'aadhaar') throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Aadhaar verification session not found' });
    if (record.status !== 'otp_sent') throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `This verification is ${record.status}, not awaiting an OTP` });
    if (!record.providerReference) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'No pending OTP request for this verification' });

    try {
      const result = await submitAadhaarOtp(config, record.providerReference, otp);
      if (result.verified) {
        await this.repo.markVerified(verificationId, { verifiedName: result.name ?? '', maskedNumber: result.maskedAadhaar });
        await this.repo.updateApplicationStatus(record.operatorApplicationId, 'aadhaar', 'verified');
        return { verified: true, name: result.name ?? undefined, maskedAadhaar: result.maskedAadhaar };
      }
      await this.repo.markFailed(verificationId, 'OTP did not verify with UIDAI');
      await this.repo.updateApplicationStatus(record.operatorApplicationId, 'aadhaar', 'failed');
      return { verified: false, reason: 'Incorrect OTP or verification failed' };
    } catch (err) {
      await this.repo.markFailed(verificationId, (err as Error).message);
      await this.repo.updateApplicationStatus(record.operatorApplicationId, 'aadhaar', 'failed');
      throw new AppError(ErrorCode.PAYMENT_GATEWAY_ERROR, 502, { message: 'Aadhaar verification service is currently unavailable — please try again shortly' });
    }
  }

  /** Bank account verification — a single synchronous penny-drop / account-aggregator-backed call; confirms the account exists and returns the registered holder name for the caller to compare against the applicant's stated name. */
  async verifyBankAccount(operatorApplicationId: string, accountNumber: string, ifsc: string): Promise<{ verified: boolean; nameAtBank?: string; reason?: string }> {
    const config = this.requireDigio();
    const kycId = await this.repo.create({ operatorApplicationId, documentType: 'bank_account', provider: 'digio' });
    try {
      const result = await verifyBankAccount(config, accountNumber, ifsc);
      if (result.verified) {
        await this.repo.markVerified(kycId, { verifiedName: result.nameAtBank ?? '', maskedNumber: maskAccountNumber(accountNumber), ifsc: ifsc.toUpperCase() });
        await this.repo.updateApplicationStatus(operatorApplicationId, 'bank_account', 'verified');
        return { verified: true, nameAtBank: result.nameAtBank ?? undefined };
      }
      await this.repo.markFailed(kycId, result.failureReason ?? 'Bank account could not be verified');
      await this.repo.updateApplicationStatus(operatorApplicationId, 'bank_account', 'failed');
      return { verified: false, reason: result.failureReason ?? undefined };
    } catch (err) {
      await this.repo.markFailed(kycId, (err as Error).message);
      await this.repo.updateApplicationStatus(operatorApplicationId, 'bank_account', 'failed');
      throw new AppError(ErrorCode.PAYMENT_GATEWAY_ERROR, 502, { message: 'Bank verification service is currently unavailable — please try again shortly' });
    }
  }

  async statusForApplication(operatorApplicationId: string) {
    return this.repo.listForApplication(operatorApplicationId);
  }
}
