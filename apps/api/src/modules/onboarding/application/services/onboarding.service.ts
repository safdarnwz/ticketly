import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { DatabaseService, UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  newId,
  runWithContext,
  createContext,
  type Json,
  type TenantId,
  type UserId,
} from '@kernel';
import { PasswordHasher } from '@security';

import { User, UserRepository } from '../../../iam';
import { Mailer, renderOperatorStatusEmail, NotificationService } from '../../../notification';
import { FileService } from '../../../files/application/file.service';
import { defaultLogoSvg } from '../../../files/domain/default-logo';
import { Logger } from '@observability';
import {
  approvalBlockers,
  assertReview,
  type ApplicationStatus,
} from '../../domain/application-status';
import { OperatorApplicationRepository } from '../../infrastructure/persistence/operator-application.repository';
import { PlatformPoliciesService } from '../../../platform-settings';

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
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly mailer: Mailer,
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly config: AppConfig,
    private readonly notifications: NotificationService,
    private readonly files: FileService,
    private readonly logger: Logger,
    private readonly policies: PlatformPoliciesService,
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
    }>({ name: 'onboarding.approve' }, async (scope) => {
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

      // 1) Provision the tenant. The slug becomes PUBLIC — it's the second
      // label of the operator's own login URL, app.<slug>.ticketly.com — so
      // it must be unique. A short id suffix guarantees that without a
      // retry loop; `slugify` keeps it URL-safe and readable.
      const tenantId = newId();
      const slug = `${slugify(app.companyName)}-${tenantId.slice(0, 6)}`;
      // Registered address for the tax invoice: company address line 1/2 +
      // city/state/pincode, joined into one display string — the invoice
      // doesn't need these as separate structured fields, just a readable
      // address block matching what appears on the operator's own GST
      // registration certificate.
      const registeredAddress =
        [app.addressLine1, app.addressLine2, app.city, app.state, app.pinCode]
          .map((part) => (typeof part === 'string' ? part.trim() : ''))
          .filter((part) => part.length > 0)
          .join(', ') || null;
      await scope.client.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, status, contact_email, contact_phone,
                                 bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_details_updated_at,
                                 gstin, registered_address)
           VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,
                   CASE WHEN $8::text IS NOT NULL THEN now() ELSE NULL END,
                   $11,$12)`,
        [
          tenantId,
          slug,
          app.companyName,
          app.companyName,
          app.officialEmail ?? app.email,
          app.companyMobile ?? app.mobile,
          app.bankAccountHolder ?? null,
          app.bankAccountNumber ?? null,
          app.bankIfsc ?? null,
          app.bankName ?? null,
          app.gstNumber ?? null,
          registeredAddress,
        ],
      );

      // 1b) Default notification templates — WITHOUT this, notify()
      // silently sends NOTHING for this tenant forever (it looks up a
      // template by tenant+eventType and just skips the whole event if
      // none exists — no error, no log, nothing). Every operator needs
      // at least these on day one, or their customers never receive a
      // single booking confirmation, cancellation, or refund SMS/email.
      await this.notifications.seedDefaults(tenantId as TenantId, [
        {
          eventType: 'booking.confirmed',
          channel: 'sms',
          body: 'Booking confirmed! PNR {{pnr}}. Have a safe journey.',
        },
        {
          eventType: 'booking.confirmed',
          channel: 'email',
          subject: 'Your ticket — PNR {{pnr}}',
          body: 'Your booking is confirmed. PNR: {{pnr}}.',
        },
        {
          eventType: 'booking.cancelled',
          channel: 'sms',
          body: 'Booking {{pnr}} cancelled. Refund of {{refundAmount}} initiated.',
        },
        {
          eventType: 'booking.seats_cancelled',
          channel: 'sms',
          body: 'Seat(s) {{seats}} on booking {{pnr}} cancelled. Refund of {{refund}} initiated. Your other seats remain confirmed.',
        },
        {
          eventType: 'booking.cancelled',
          channel: 'email',
          subject: 'Booking cancelled — PNR {{pnr}}',
          body: 'Your booking {{pnr}} has been cancelled. Refund: {{refundAmount}}.',
        },
        {
          eventType: 'refund.settled',
          channel: 'sms',
          body: 'Refund of {{refundAmount}} for PNR {{pnr}} has been processed.',
        },
        {
          eventType: 'trip.delayed',
          channel: 'sms',
          body: 'Your trip (PNR {{pnr}}) is delayed. New departure: {{newTime}}.',
        },
        {
          eventType: 'trip.reminder.12h',
          channel: 'sms',
          body: 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Have a safe journey!',
        },
        {
          eventType: 'trip.reminder.12h',
          channel: 'whatsapp',
          body: 'Hi! Your trip *{{pnr}}* is coming up.\n\nBoarding: *{{fromStopName}}*, around {{boardingAt}}\nAlighting: *{{toStopName}}*, around {{droppingAt}}\nPassenger(s): {{passengerNames}}\n\nWe will send your exact pickup point and bus details 4 hours before boarding.',
        },
        {
          eventType: 'trip.reminder.12h',
          channel: 'email',
          subject: 'Your upcoming trip — PNR {{pnr}}',
          body: 'Your trip is coming up.\n\nPNR: {{pnr}}\nBoarding: {{fromStopName}} (around {{boardingAt}})\nAlighting: {{toStopName}} (around {{droppingAt}})\nPassenger(s): {{passengerNames}}\n\nWe will send your exact pickup point, driver and bus details 4 hours before boarding.',
        },
        {
          eventType: 'trip.reminder.4h',
          channel: 'sms',
          body: 'Boarding in 4h — PNR {{pnr}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Track live: {{trackingUrl}}',
        },
        {
          eventType: 'trip.reminder.4h',
          channel: 'whatsapp',
          body: 'Your bus boards in 4 hours! *{{pnr}}*\n\n📍 Pickup: *{{pickup.stopName}}*\n{{pickup.landmark}}\n{{pickup.address}}\n\n🚌 Bus number: *{{busNumber}}*\n👨\u200d✈️ Driver(s): {{driversList}}\n🧑\u200d💼 Attendant(s): {{attendantsList}}\n\n📍 Track live location: {{trackingUrl}}\n\nPlease reach 15 minutes early.',
        },
        {
          eventType: 'trip.reminder.4h',
          channel: 'email',
          subject: 'Boarding in 4 hours — PNR {{pnr}}',
          body: 'Your bus boards in 4 hours.\n\nPickup point: {{pickup.stopName}}\nLandmark: {{pickup.landmark}}\nAddress: {{pickup.address}}\n\nBus number: {{busNumber}}\nDriver(s): {{driversList}}\nAttendant(s): {{attendantsList}}\n\nTrack live location: {{trackingUrl}}\n\nPlease reach your pickup point 15 minutes early.',
        },
        {
          eventType: 'connection.at_risk',
          channel: 'sms',
          body: 'Your connecting bus (PNR {{pnr}}) is running {{delayMinutes}} min late. Only {{marginMinutes}} min margin left for your next bus. We are monitoring this for you.',
        },
        {
          eventType: 'connection.broken',
          channel: 'sms',
          body: 'Your connecting bus (PNR {{pnr}}) is delayed by {{delayMinutes}} min and may miss your next connection. Please contact support for help rebooking.',
        },
        {
          eventType: 'incident.critical',
          channel: 'sms',
          body: 'EMERGENCY ({{type}}) reported on trip {{tripId}} at {{time}}. Location: {{location}}. {{description}} — acknowledge in the Ticketly console now.',
        },
        {
          eventType: 'incident.critical',
          channel: 'email',
          subject: 'EMERGENCY: {{type}} reported — acknowledge now',
          body: 'An emergency ({{type}}) was reported at {{time}} on trip {{tripId}}.\nLocation: {{location}}\nDetails: {{description}}\n\nOpen the Ticketly console → Incidents to acknowledge it.',
        },
        {
          eventType: 'waitlist.seats_available',
          channel: 'sms',
          body: 'Good news! {{seatCount}} seat(s) just opened up on {{routeName}} ({{journeyDate}}). Book quickly — seats go to whoever books first: {{bookUrl}}',
        },
        {
          eventType: 'waitlist.seats_available',
          channel: 'email',
          subject: 'Seats available: {{routeName}} on {{journeyDate}}',
          body: 'Seats you were waiting for have opened up on {{routeName}} ({{journeyDate}}).\n\nThis is not a reservation — the seats go to whoever books first.\nBook now: {{bookUrl}}',
        },
      ]);

      // 2) Create the operator-admin user (reusing the applicant's hashed password).
      const operatorUser = User.create(newId() as UserId, {
        tenantId: tenantId as TenantId,
        kind: 'staff',
        fullName: `${app.firstName} ${app.lastName}`.trim(),
        email: app.email,
        phone: app.mobile,
        passwordHash: app.passwordHash,
        status: 'active',
      });
      // insert() encrypts PII; run in the new tenant's context for RLS.
      await runWithContext(
        createContext({ tenantId: tenantId as TenantId, actorType: 'system' }),
        async () => {
          await this.users.insert(operatorUser);
        },
      );

      // 3) Grant the operator_admin system role.
      const role = await scope.client.query<{ id: string }>(
        `SELECT id FROM roles WHERE code = 'operator_admin' AND tenant_id IS NULL AND deleted_at IS NULL LIMIT 1`,
      );
      if (role.rows[0]) {
        await scope.client.query(
          `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [operatorUser.id, role.rows[0].id, reviewerId],
        );
      }

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
        operatorUserId: operatorUser.id,
        email: app.email,
        name: `${app.firstName} ${app.lastName}`.trim(),
        slug,
      };
    });

    const consoleUrl = this.consoleUrlFor(result.slug);

    // Operator's storage folder starts with a branded default logo:
    //   {slug}/branding/logo.svg
    // Outside the approval transaction on purpose — object storage is not
    // transactional, and a storage hiccup must never block an approval. The
    // operator can upload their own logo any time; this just guarantees one.
    await this.provisionDefaultLogo(result.tenantId as TenantId, result.name, String(result.slug));

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

  private async provisionDefaultLogo(
    tenantId: TenantId,
    _ownerName: string,
    _slug: string,
  ): Promise<void> {
    try {
      await runWithContext(createContext({ tenantId, actorType: 'system' }), async () => {
        const company =
          (
            await this.db.queryOne<{ display_name: string }>(
              `SELECT display_name FROM tenants WHERE id = $1`,
              [tenantId],
              { name: 'onboarding.companyName', primary: true },
            )
          )?.display_name ?? 'Operator';
        const logo = await this.files.store({
          purpose: 'tenant_logo',
          folder: 'branding',
          fixedName: 'logo',
          fileName: 'logo.svg',
          bytes: Buffer.from(defaultLogoSvg(company), 'utf8'),
          visibility: 'public',
          allowSvg: true,
          allowedMimes: ['image/svg+xml'],
        });
        await this.db.execute_(
          `UPDATE tenants SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('logoFileId', $2::text, 'logoObjectKey', $3::text, 'logoCdnUrl', $4::text)
            WHERE id = $1`,
          [tenantId, logo.id, logo.objectKey, logo.url],
          { name: 'onboarding.setDefaultLogo', primary: true },
        );
      });
    } catch (e) {
      this.logger
        .forContext('Onboarding')
        .warn(
          { tenantId, err: (e as Error).message },
          'default logo not created — operator can upload one later',
        );
    }
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
