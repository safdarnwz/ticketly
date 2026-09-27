import { createBrowserRouter, Navigate } from 'react-router-dom';

import { SURFACE } from '@/lib/host';

// Shared
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { BecomeOperatorPage } from '@/pages/BecomeOperatorPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Customer (www.ticketly.com)
import { CustomerLayout } from '@/components/customer/CustomerLayout';
import { LegalPage } from '@/pages/legal/LegalPage';
import { TrackingPage } from '@/pages/tracking/TrackingPage';
import { ConnectingResultsPage } from '@/pages/connections/ConnectingResultsPage';
import { ConnectingCheckoutPage } from '@/pages/connections/ConnectingCheckoutPage';
import { HomePage } from '@/pages/customer/HomePage';
import { ResultsPage } from '@/pages/customer/ResultsPage';
import { TripPage } from '@/pages/customer/TripPage';
import { CheckoutPage } from '@/pages/customer/CheckoutPage';
import { ConfirmationPage } from '@/pages/customer/ConfirmationPage';
import { IntegrationsPage } from '@/pages/settings/IntegrationsPage';
import { SecurityPage } from '@/pages/settings/SecurityPage';
import { BusinessRulesPage } from '@/pages/settings/BusinessRulesPage';
import { RoleTemplatesPage } from '@/pages/settings/RoleTemplatesPage';
import { SystemPage } from '@/pages/settings/SystemPage';
import { VehicleApprovalsPage } from '@/pages/admin/VehicleApprovalsPage';
import { PartnersPage } from '@/pages/admin/PartnersPage';
import { BillingPage } from '@/pages/admin/BillingPage';
import { HealthPage } from '@/pages/admin/HealthPage';
import { ManageBookingPage } from '@/pages/customer/ManageBookingPage';
import { AccountPage } from '@/pages/customer/AccountPage';

// Both staff consoles share this shell (app.ticketly.com / app.<slug>.ticketly.com)
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';

// Tenant admin (app.<slug>.ticketly.com) — one operator's own trading operations
import { TripsPage } from '@/pages/trips/TripsPage';
import { VehicleDetailPage } from '@/pages/fleet/VehicleDetailPage';
import { TripChartPage } from '@/pages/trips/TripChartPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { RoutesPage } from '@/pages/routes/RoutesPage';
import { FleetPage } from '@/pages/fleet/FleetPage';
import { OperationsPage } from '@/pages/operations/OperationsPage';
import { SchedulePage } from '@/pages/schedule/SchedulePage';
import { PricingPage } from '@/pages/pricing/PricingPage';
import { DistributionPage } from '@/pages/distribution/DistributionTabs';
import { BankDetailsPage } from '@/pages/settings/BankDetailsPage';
import { RefundPolicyPage } from '@/pages/settings/RefundPolicyPage';
import { ConnectionsPage } from '@/pages/settings/ConnectionsPage';
import { TemplatesPage } from '@/pages/settings/TemplatesPage';
import { BrandingPage } from '@/pages/settings/BrandingPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { PromotionsPage } from '@/pages/promotions/PromotionsPage';
import { PlatformSettingsPage } from '@/pages/settings/PlatformSettingsPage';
import { StaffTripPage } from '@/pages/storefront/StaffTripPage';
import { BranchesPage } from '@/pages/branches/BranchesPage';
import { StaffPage } from '@/pages/staff/StaffPage';
import { CompanyProfilePage } from '@/pages/settings/CompanyProfilePage';
import { PlatformBillsPage } from '@/pages/settings/PlatformBillsPage';
import { MyAccountPage } from '@/pages/staff/MyAccountPage';
import { AgentHomePage } from '@/pages/agent/AgentHomePage';
import { AgentBookingsPage } from '@/pages/agent/AgentBookingsPage';
import { AgentBookingPage } from '@/pages/agent/AgentBookingPage';
import { AgentStatementPage } from '@/pages/agent/AgentStatementPage';
import { AgentHelpPage } from '@/pages/agent/AgentHelpPage';
import { CrewHomePage } from '@/pages/crew/CrewHomePage';
import { CrewTripPage } from '@/pages/crew/CrewTripPage';
import { CustomersPage } from '@/pages/crm/CustomersPage';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { AnnouncementsPage } from '@/pages/announcements/AnnouncementsPage';
import { SearchPage } from '@/pages/storefront/SearchPage';
import { BookingsPage } from '@/pages/bookings/BookingsPage';
import { BookingDetailPage } from '@/pages/bookings/BookingDetailPage';
import { RefundsPage } from '@/pages/refunds/RefundsPage';
import { ReviewsPage } from '@/pages/reviews/ReviewsPage';
import { SupportPage } from '@/pages/support/SupportPage';

// Super admin (app.ticketly.com) — platform-level, cross-tenant, PLUS
// everything platform-wide rather than per-operator (see migration 0018)
import { OperatorsPage } from '@/pages/admin/OperatorsPage';
import { TenantsPage } from '@/pages/admin/TenantsPage';
import { AnalyticsPage } from '@/pages/admin/AnalyticsPage';
import { LiveBookingsPage } from '@/pages/admin/LiveBookingsPage';
import { EscalationsPage } from '@/pages/admin/EscalationsPage';
import { CmsPage } from '@/pages/cms/CmsPage';
import { FraudPage } from '@/pages/fraud/FraudPage';
import { I18nPage } from '@/pages/i18n/I18nPage';
import { PrivacyPage } from '@/pages/privacy/PrivacyPage';
import { AppearancePage } from '@/pages/settings/AppearancePage';

const authRoutes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/become-operator', element: <BecomeOperatorPage /> },
];

const customerRouter = createBrowserRouter([
  ...authRoutes,
  {
    element: <CustomerLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/results', element: <ResultsPage /> },
      { path: '/trip', element: <TripPage /> },
      { path: '/checkout', element: <CheckoutPage /> },
      { path: '/confirmation', element: <ConfirmationPage /> },
      { path: '/account', element: <AccountPage /> },
      { path: '/bookings/:id/manage', element: <ManageBookingPage /> },
      { path: '/legal/:slug', element: <LegalPage /> },
      { path: '/track/:token', element: <TrackingPage /> },
      { path: '/connecting/results', element: <ConnectingResultsPage /> },
      { path: '/connecting/checkout', element: <ConnectingCheckoutPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/** app.<slug>.ticketly.com — a single operator's own staff console: their trading operations only. */
const tenantAdminRouter = createBrowserRouter([
  ...authRoutes,
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/trips', element: <TripsPage /> },
          { path: '/trips/:id', element: <TripChartPage /> },
          { path: '/routes', element: <RoutesPage /> },
          { path: '/fleet', element: <FleetPage /> },
          { path: '/operations', element: <OperationsPage /> },
          { path: '/fleet/vehicles/:id', element: <VehicleDetailPage /> },
          { path: '/schedule', element: <SchedulePage /> },
          { path: '/pricing', element: <PricingPage /> },
          { path: '/distribution', element: <DistributionPage /> },
          { path: '/promotions', element: <PromotionsPage /> },
          {
            path: '/settings', element: <SettingsPage />, children: [
              { path: 'profile', element: <CompanyProfilePage /> },
              { path: 'bills', element: <PlatformBillsPage /> },
              { path: 'bank-details', element: <BankDetailsPage /> },
              { path: 'refund-policy', element: <RefundPolicyPage /> },
              { path: 'connections', element: <ConnectionsPage /> },
              { path: 'templates', element: <TemplatesPage /> },
              { path: 'branding', element: <BrandingPage /> },
            ],
          },
          { path: '/branches', element: <BranchesPage /> },
          { path: '/staff', element: <StaffPage /> },
          { path: '/me', element: <MyAccountPage /> },
          { path: '/agent', element: <AgentHomePage /> },
          { path: '/agent/bookings', element: <AgentBookingsPage /> },
          { path: '/agent/bookings/:id', element: <AgentBookingPage /> },
          { path: '/agent/statement', element: <AgentStatementPage /> },
          { path: '/agent/help', element: <AgentHelpPage /> },
          { path: '/crew', element: <CrewHomePage /> },
          { path: '/crew/trips/:tripId', element: <CrewTripPage /> },
          { path: '/legal/:slug', element: <LegalPage /> },
          { path: '/customers', element: <CustomersPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/search', element: <SearchPage /> },
          { path: '/staff-trip', element: <StaffTripPage /> },
          { path: '/bookings', element: <BookingsPage /> },
          { path: '/bookings/:pnr', element: <BookingDetailPage /> },
          { path: '/refunds', element: <RefundsPage /> },
          { path: '/reviews', element: <ReviewsPage /> },
          { path: '/support', element: <SupportPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

/**
 * app.ticketly.com — the platform/super-admin console. No per-operator
 * trading screens live here — only cross-tenant operator management, plus
 * the platform-wide modules from migration 0018 (one storefront's content,
 * shared fraud review, one i18n/FX catalog, DPDP privacy, the console theme).
 */
const superAdminRouter = createBrowserRouter([
  ...authRoutes,
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Navigate to="/admin/tenants" replace /> },
          { path: '/admin/tenants', element: <TenantsPage /> },
          { path: '/admin/operators', element: <OperatorsPage /> },
          { path: '/admin/analytics', element: <AnalyticsPage /> },
          { path: '/admin/bookings', element: <LiveBookingsPage /> },
          { path: '/admin/escalations', element: <EscalationsPage /> },
          { path: '/admin/vehicles', element: <VehicleApprovalsPage /> },
          { path: '/admin/partners', element: <PartnersPage /> },
          { path: '/admin/billing', element: <BillingPage /> },
          { path: '/admin/health', element: <HealthPage /> },
          { path: '/cms', element: <CmsPage /> },
          { path: '/fraud', element: <FraudPage /> },
          {
            path: '/settings', element: <PlatformSettingsPage />, children: [
              { path: 'integrations', element: <IntegrationsPage /> },
              { path: 'security', element: <SecurityPage /> },
              { path: 'business-rules', element: <BusinessRulesPage /> },
              { path: 'role-templates', element: <RoleTemplatesPage /> },
              { path: 'system', element: <SystemPage /> },
              { path: 'appearance', element: <AppearancePage /> },
              { path: 'i18n', element: <I18nPage /> },
              { path: 'privacy', element: <PrivacyPage /> },
            ],
          },
          { path: '/announcements', element: <AnnouncementsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

export const router =
  SURFACE === 'superAdmin' ? superAdminRouter : SURFACE === 'tenantAdmin' ? tenantAdminRouter : customerRouter;
