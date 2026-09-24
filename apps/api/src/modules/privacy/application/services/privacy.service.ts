import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, getUserId, type UserId } from '@kernel';

import {
  consentState,
  isProcessingAllowed,
  recordConsent,
  type ConsentPurpose,
} from '../../domain/consent';
import { PrivacyRepository } from '../../infrastructure/persistence/privacy.repository';

/**
 * DPDP privacy operations: consent capture, the "right to be forgotten"
 * (erasure), and a callable retention sweep. Consent rules (necessary purposes,
 * latest-wins, no-withdraw-necessary) are pure (domain/consent.ts); erasure
 * ANONYMISES PII while preserving legally-retained financial records
 * (domain/retention.ts), all inside one transaction so a half-erased profile is
 * impossible.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly repo: PrivacyRepository,
    private readonly uow: UnitOfWork,
  ) {}

  private requireCustomer(): UserId {
    const id = getUserId();
    if (!id)
      throw new AppError(ErrorCode.COMMON_UNAUTHENTICATED, 401, { message: 'Sign-in required' });
    return id;
  }

  async setConsent(
    purpose: ConsentPurpose,
    granted: boolean,
    atMs = Date.now(),
  ): Promise<{ state: Record<string, boolean> }> {
    const customerId = this.requireCustomer();
    const events = await this.repo.loadConsentEvents(customerId);
    // Domain validation (e.g. cannot withdraw a necessary purpose) throws here.
    recordConsent(events, { purpose, granted, atMs });
    await this.repo.appendConsent(customerId, purpose, granted, atMs);
    return { state: consentState([...events, { purpose, granted, atMs }]) };
  }

  async myConsents(): Promise<Record<string, boolean>> {
    return consentState(await this.repo.loadConsentEvents(this.requireCustomer()));
  }

  async isAllowed(customerId: UserId, purpose: ConsentPurpose): Promise<boolean> {
    return isProcessingAllowed(purpose, await this.repo.loadConsentEvents(customerId));
  }

  async requestErasure(): Promise<{ requestId: string }> {
    return { requestId: await this.repo.createErasureRequest(this.requireCustomer()) };
  }

  listErasureRequests(status?: string): Promise<unknown[]> {
    return this.repo.listErasureRequests(status);
  }

  /** Fulfil an erasure request: anonymise PII, keep financials, mark done. Platform-wide — no tenant. */
  async processErasure(requestId: string): Promise<{ status: string }> {
    return this.uow.run({ name: 'privacy.processErasure' }, async () => {
      const req = await this.repo.findErasureRequest(requestId);
      if (!req)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: 'Erasure request not found',
        });
      if (req.status === 'processed') return { status: 'processed' }; // idempotent
      await this.repo.anonymiseCustomerPii(req.customerId as UserId);
      await this.repo.markErasureProcessed(requestId);
      return { status: 'processed' };
    });
  }
}
