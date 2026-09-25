import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import { AppError, ErrorCode, newId, type Json, type UserId } from '@kernel';
import { PasswordHasher } from '@security';

import { Mailer, renderOperatorStatusEmail } from '../../../notification';
import { FileService } from '../../../files/application/file.service';
import {
  approvalBlockers,
  assertReview,
  type ApplicationStatus,
} from '../../domain/application-status';
import { OperatorApplicationRepository } from '../../infrastructure/persistence/operator-application.repository';
import { PlatformPoliciesService } from '../../../platform-settings';
import { TenantProvisioningService } from '../../../tenancy';

export interface ApplyInput {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  designation?: string;
  password: string;
  companyName: string;
  companyType?: string;
  gstNumber?: string;
  panNumber?: string;
  registrationNumber?: string;
  officialEmail?: string;
  companyMobile?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  pinCode?: string;
  bankAccountHolder?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
  business?: Record<string, unknown>;
  documents?: Record<string, unknown>;
}

/**
 * Operator onboarding. A public applicant submits a "Become an Operator" form; a
 * super/platform admin reviews it. Approval provisions a tenant + an
 * operator-admin user (assigned the `operator_admin` role) in one transaction,
 * and emails the applicant; rejection records a reason and emails them. The
 * applicant's chosen password is hashed at apply time and used to create the
 * user on approval — never stored or emailed in plaintext.
 *
 * The assigned slug is NOT internal — it becomes the operator's own login URL,
 * `https://app.<slug>.ticketly.com`, which is the ONLY host that tenant's
 * staff can sign in on (enforced by `AuthService.isAllowedOnSurface`). The
 * approve response and the approval email both surface this URL so the
 * platform admin and the applicant see it immediately.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly repo: OperatorApplicationRepository,
    private readonly hasher: PasswordHasher,
    private readonly mailer: Mailer,
    private readonly uow: UnitOfWork,
    private readonly config: AppConfig,
    private readonly files: FileService,
    private readonly policies: PlatformPoliciesService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  async apply(input: ApplyInput): Promise<{ applicationId: string; status: 'pending' }> {
    const duplicate = await this.repo.findActiveDuplicate({
      email: input.email,
      mobile: input.mobile,
      gstNumber: input.gstNumber,
      panNumber: input.panNumber,
    });
    if (duplicate) {
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: `An application with this ${duplicate.matchedOn.replace('_', ' ')} is already pending or approved`,
      });
    }
    // Every referenced document must be a real platform-scope upload made for
    // an application — a random uuid, or another operator's file id, is refused.
    for (const [docType, fileId] of Object.entries(input.documents ?? {})) {
      await this.files.requireForPurpose(String(fileId), 'application_document').catch(() => {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Document '${docType}' was not uploaded correctly — please upload it again`,
        });
      });
    }
    await this.policies.assertPasswordAcceptable(input.password);
    const passwordHash = await this.hasher.hash(input.password);
    const applicationId = await this.repo.insert({
      ...input,
      passwordHash,
      business: (input.business ?? {}) as Json,
      documents: (input.documents ?? {}) as Json,
    });
    return { applicationId, status: 'pending' };
  }

  async uploadApplicationDocument(docType: string, body: unknown, fileName?: string) {
    const allowed = [
      'gst_certificate',
      'pan_card',
      'cancelled_cheque',
      'aadhaar',
      'business_registration',
      'fleet_list',
      'other',
    ];
    if (!allowed.includes(docType))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `docType must be one of: ${allowed.join(', ')}`,
      });
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 400, {
        message: 'Send the file as raw bytes with Content-Type: application/octet-stream',
      });
    }
    const f = await this.files.upload({
      purpose: 'application_document',
      bytes: body,
      fileName,
      sub: ['applications', docType],
    });
    return { fileId: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, mimeType: f.mimeType };
  }

  async applicationDocumentUrl(
    applicationId: string,
    docType: string,
  ): Promise<{ url: string | null; fileName: string }> {
    const app = await this.repo.getFull(applicationId);
    if (!app)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Application not found' });
    const fileId = (app.documents as Record<string, string> | null)?.[docType];
    if (!fileId)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: `No '${docType}' document on this application`,
      });
    const meta = await this.files.meta(fileId);
    if (!meta)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Document file not found' });
    return { url: await this.files.urlFor(meta, { download: false }), fileName: meta.fileName };
  }

  async list(status?: 'pending' | 'approved' | 'rejected'): Promise<unknown[]> {
    const rows = await this.repo.list(status);
    // Attach the console URL for already-approved rows too, not just the one
    // just approved in this session — so a page refresh doesn't lose it.
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      const slug = r.tenantSlug as string | null;
      return slug ? { ...r, consoleUrl: this.consoleUrlFor(slug) } : r;
    });
  }

  async get(id: string): Promise<Record<string, unknown>> {
    const app = await this.repo.getFull(id);
    if (!app)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Application not found' });
    // Never expose the stored password hash.
    delete app.password_hash;
    const a = app as Record<string, string | null>;
    // Readiness is shown BEFORE the admin clicks approve, so they see exactly what is missing.
    const blockers =
      a.status === 'pending'
        ? approvalBlockers({
            companyName: a.company_name,
            email: a.email,
            mobile: a.mobile,
            gstNumber: a.gst_number,
            panNumber: a.pan_number,
            panVerificationStatus: a.pan_verification_status,
            bankAccountHolder: a.bank_account_holder,
            bankAccountNumber: a.bank_account_number,
            bankIfsc: a.bank_ifsc,
          })
        : [];
    return { ...app, approvalBlockers: blockers, events: await this.repo.events(id) };
  }

  /** Approve → provision tenant + operator-admin user + role, then email. */
  async approve(
    id: string,
    reviewerId: UserId | null,
    note?: string,
  ): Promise<{ tenantId: string; operatorUserId: string; slug: string; consoleUrl: string }> {
    const result = await this.uow.run<{
      tenantId: string;
      operatorUserId: string;
      email: string;
      name: string;
      slug: string;
    }>({ name: 'onboarding.approve', bypassRls: true }, async () => {
      // Row lock: a concurrent reject/hold of the same application waits,
      // then sees 'approved' and fails cleanly — never two decisions.
      const app = await this.repo.findForUpdate(id);
      if (!app)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Application not found' });
      assertReview(app.status, 'approve', note);

      const blockers = approvalBlockers(app);
      if (blockers.length) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Cannot approve yet: ${blockers.join('; ')}`,
          details: { blockers },
        });
      }
      const live = await this.repo.liveTenantWithGstin(String(app.gstNumber));
      if (live) {
        throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
          message: `An operator with GSTIN ${String(app.gstNumber)} is already live on the platform (${live.displayName})`,
          details: { tenantId: live.id },
        });
      }

      // The slug is PUBLIC (the operator's console address) and must be
      // unique: the company name plus a short random suffix.
      const slug = `${slugify(app.companyName)}-${newId().slice(-6)}`;
      const registeredAddress =
        [app.addressLine1, app.addressLine2, app.city, app.state, app.pinCode]
          .map((part) => (typeof part === 'string' ? part.trim() : ''))
          .filter((part) => part.length > 0)
          .join(', ') || null;
      const { tenantId, ownerId } = await this.provisioning.provision({
        slug,
        legalName: app.companyName,
        displayName: app.companyName,
        contactEmail: app.officialEmail ?? app.email,
        contactPhone: app.companyMobile ?? app.mobile,
        business: {
          bank: {
            holder: app.bankAccountHolder ?? null,
            accountNumber: app.bankAccountNumber ?? null,
            ifsc: app.bankIfsc ?? null,
            name: app.bankName ?? null,
          },
          gstin: app.gstNumber ?? null,
          registeredAddress,
        },
        // The applicant signs in with the password chosen when applying.
        owner: {
          fullName: `${app.firstName} ${app.lastName}`.trim(),
          email: app.email,
          phone: app.mobile,
          passwordHash: app.passwordHash,
        },
      });

      await this.repo.markApproved(id, tenantId, reviewerId);
      await this.repo.recordEvent({
        applicationId: id,
        from: 'pending',
        to: 'approved',
        reason: note?.trim() || null,
        actorId: reviewerId,
      });
      return {
        tenantId,
        operatorUserId: ownerId,
        email: app.email,
        name: `${app.firstName} ${app.lastName}`.trim(),
        slug,
      };
    });

    const consoleUrl = this.consoleUrlFor(result.slug);

    await this.mailer
      .send({
        to: result.email,
        subject: 'Your Ticketly operator application is approved',
        html: renderOperatorStatusEmail({ name: result.name, status: 'approved', consoleUrl }),
      })
      .catch(() => undefined);

    return {
      tenantId: result.tenantId,
      operatorUserId: result.operatorUserId,
      slug: result.slug,
      consoleUrl,
    };
  }

  /** `https://app.<slug>.ticketly.com` — the operator's own, and ONLY, console URL. */
  private consoleUrlFor(slug: string): string {
    const baseDomain = new URL(this.config.app.publicBaseUrl).hostname;
    return `https://app.${slug}.${baseDomain}`;
  }

  async reject(id: string, reason: string, reviewerId: UserId | null): Promise<void> {
    await this.transition(id, 'reject', reason, reviewerId, async () =>
      this.repo.markRejected(id, reason.trim(), reviewerId),
    );
  }

  /** Keep it pending but record why — typically "please send X". Emailed to the applicant. */
  async hold(id: string, reason: string, reviewerId: UserId | null): Promise<void> {
    await this.transition(id, 'hold', reason, reviewerId, async () =>
      this.repo.markOnHold(id, reason.trim(), reviewerId),
    );
  }

  /**
   * rejected → pending. Re-checks duplicates first: while this application
   * sat rejected, the same company may have re-applied (or been approved) —
   * reopening would then create two live applications for one business.
   */
  async reopen(id: string, reason: string, reviewerId: UserId | null): Promise<void> {
    await this.transition(id, 'reopen', reason, reviewerId, async (app) => {
      const dup = await this.repo.findActiveDuplicate({
        email: app.email,
        mobile: app.mobile,
        gstNumber: (app.gstNumber as string | null) ?? undefined,
        panNumber: (app.panNumber as string | null) ?? undefined,
        excludeId: id,
      });
      if (dup) {
        throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
          message: `Cannot reopen — another application with the same ${dup.matchedOn.replace('_', ' ')} is already pending or approved`,
          details: { applicationId: dup.id },
        });
      }
      await this.repo.markReopened(id, reason.trim(), reviewerId);
    });
  }

  /** Shared: lock, validate the move, apply, write history — one transaction — then email. */
  private async transition(
    id: string,
    action: 'reject' | 'hold' | 'reopen',
    reason: string,
    reviewerId: UserId | null,
    apply: (
      app: Awaited<ReturnType<OperatorApplicationRepository['findForUpdate']>> & object,
    ) => Promise<void>,
  ): Promise<void> {
    const to: ApplicationStatus = action === 'reject' ? 'rejected' : 'pending';
    const app = await this.uow.run({ name: `onboarding.${action}` }, async () => {
      const row = await this.repo.findForUpdate(id);
      if (!row)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Application not found' });
      assertReview(row.status, action, reason);
      await apply(row);
      await this.repo.recordEvent({
        applicationId: id,
        from: row.status,
        to,
        reason: reason.trim(),
        actorId: reviewerId,
      });
      return row;
    });
    const emailStatus =
      action === 'reject' ? 'rejected' : action === 'hold' ? 'on_hold' : 'reopened';
    await this.mailer
      .send({
        to: app.email,
        subject:
          action === 'reject'
            ? 'Update on your Ticketly operator application'
            : action === 'hold'
              ? 'Action needed on your Ticketly operator application'
              : 'Your Ticketly operator application is under review again',
        html: renderOperatorStatusEmail({
          name: `${app.firstName} ${app.lastName}`,
          status: emailStatus,
          reason: reason.trim(),
        }),
      })
      .catch(() => undefined); // an email failure must never undo a recorded decision
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'operator'
  );
}
