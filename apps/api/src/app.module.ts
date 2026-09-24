import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { HttpModule } from '@http';
import { MessagingModule } from '@messaging';
import { ObservabilityModule } from '@observability';

import { HealthModule } from './modules/health/health.module';
import { SystemModule } from './modules/system/system.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { IamModule } from './modules/iam/iam.module';
import { MasterDataModule } from './modules/master-data/master-data.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SearchModule } from './modules/search/search.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { BookingModule } from './modules/booking/booking.module';
import { PaymentModule } from './modules/payment/payment.module';
import { NotificationModule } from './modules/notification/notification.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { CrewAppModule } from './modules/crew-app/crew-app.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { DistributionModule } from './modules/distribution/distribution.module';
import { AmendmentsModule } from './modules/amendments/amendments.module';
import { AncillaryModule } from './modules/ancillary/ancillary.module';
import { DepartureControlModule } from './modules/departure-control/departure-control.module';
import { RefundModule } from './modules/refunds/refund.module';
import { InvoiceModule } from './modules/invoicing/invoice.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { ReviewModule } from './modules/reviews/review.module';
import { SupportModule } from './modules/support/support.module';
import { CmsModule } from './modules/cms/cms.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { AppearanceModule } from './modules/appearance/appearance.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { BranchesModule } from './modules/branches/branches.module';
import { AgentsModule } from './modules/agents/agents.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { TripVehicleModule } from './modules/trip-vehicle/trip-vehicle.module';
import { TripExpensesModule } from './modules/trip-expenses/trip-expenses.module';
import { DemandModule } from './modules/demand/demand.module';
import { GdsModule } from './modules/gds/gds.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { CrmModule } from './modules/crm/crm.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { LegalModule } from './modules/legal/legal.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { KycModule } from './modules/kyc/kyc.module';

/**
 * ============================================================================
 *  Application composition root
 * ============================================================================
 *
 * ARCHITECTURE: a **modular monolith**, not microservices — and that is a
 * deliberate choice, not a shortcut.
 *
 *  - Seat inventory, pricing and booking share tight transactional invariants.
 *    Splitting them across services replaces a 2ms transaction with a
 *    distributed saga, and buys the double-booking bugs that come with it.
 *  - One deployable means no version skew between "search" and "book" at 9pm on
 *    the day Diwali tickets open.
 *  - Module boundaries are enforced *in code* (each module exposes only its
 *    public service; cross-module talk is via `EventBus`), so if a context ever
 *    genuinely needs its own scaling profile — GPS ingest is the likely first
 *    candidate — it lifts out into its own process without a rewrite. Part 9's
 *    ingest app is exactly that: same modules, different entry point.
 *
 * PLATFORM MODULES (this file, below) are `@Global()` and provide
 * infrastructure. FEATURE MODULES are added by Parts 2-10 and depend only on
 * the platform and on each other's published events.
 */
@Module({
  imports: [
    // ── platform ──────────────────────────────────────────────────────────
    ConfigModule,
    ObservabilityModule,
    DatabaseModule,
    CacheModule,
    MessagingModule,
    HttpModule,

    // ── operational endpoints ─────────────────────────────────────────────
    HealthModule,
    SystemModule,

    // ── feature modules ───────────────────────────────────────────────────
    TenancyModule, // Part 2 — operators, plans, provisioning
    IamModule, // Part 2 — auth, users, roles, sessions, api keys, audit
    MasterDataModule, // Part 3 — geography, stops, seat layouts, vehicle types, routes
    FleetModule, // Part 4 — vehicles, documents, maintenance, crew, duty roster
    SchedulingModule, // Part 5 — services, trips, segment-wise inventory
    PricingModule, // Part 6 — fare plans, dynamic pricing, coupons, quotes
    SearchModule, // Part 6 — sub-10ms trip search
    PromotionsModule, // Sponsored-listings ("Prio" badge) — super-admin rate card + operator purchase
    BookingModule, // Part 7 — hold/confirm/cancel, PNR, tickets, refunds
    PaymentModule, // Part 8 — payments, double-entry ledger, settlements
    NotificationModule, // Part 9 — templates + delivery engine
    TrackingModule, // Part 9 — GPS ingestion, live position & ETA
    CrewAppModule, // Part 9 — manifest, boarding scan, trip start/stop
    ReportingModule, // Part 10 — materialized-view analytics & exports
    DistributionModule, // Part 10 — OTA/channel-partner API
    AmendmentsModule, // Part 11 — reschedule, seat-change
    AncillaryModule, // Add-on services (insurance, meals, luggage) — loyalty points, referrals, and wallet were all removed from the product
    DepartureControlModule, // Part 13 — trip chart + closeout reconciliation
    RefundModule, // Part 13 — refund lifecycle (source/alternate-account, gateway reconcile)
    InvoiceModule, // Part 13 — GST tax invoices + credit notes (gapless numbering)
    StorefrontModule, // Part 14 — filtered search, round-trip, connecting journeys
    ReviewModule, // Part 14 — verified-traveller reviews & ratings
    SupportModule, // Part 14 — support tickets + message thread
    CmsModule, // Part 14 — content pages, banners, promotional offers
    FraudModule, // Part 14 — booking risk scoring + review queue
    TicketsModule, // Part 15 — signed QR boarding tokens + printable e-ticket
    RealtimeModule, // Part 15 — live seat availability over SSE
    I18nModule, // Part 15 — translations + multi-currency conversion
    PrivacyModule, // Part 15 — DPDP consent + right-to-be-forgotten erasure
    AppearanceModule, // Global Settings → Appearance (per-tenant/role design system)
    OnboardingModule, // Operator onboarding (Become an Operator) + super-admin review
    BranchesModule, // multi-branch/counter locations
    AgentsModule, // B2B agent network (GDS distribution)
    QuotasModule, // seat allocations for agents / branches
    TripVehicleModule, // change the bus of a trip (re-seating)
    TripExpensesModule, // trip expenses + P&L
    DemandModule, // waitlist + occupancy forecast
    GdsModule, // platform GDS: OTAs / multi-operator agents
    IncidentsModule, // incidents, SOS, lost & found, shift notes, dispatch reports
    CrmModule, // customer search, profile, blacklist, preferences
    AnnouncementsModule, // platform-wide broadcast banners
    LegalModule, // Terms/Privacy/Refund-Policy/Grievance-Officer pages (Consumer Protection E-Commerce Rules 2020, IT Rules 2021)
    ConnectionsModule, // cross-operator connecting-journey search + booking (e.g. Delhi -> Kolkata -> Bhubaneswar)
    KycModule, // PAN format-check + DigiLocker document verification for operator onboarding
  ],
})
export class AppModule {}
