/**
 * Roles of the platform. One customer role plus eleven staff roles for the admin panel.
 * Staff permissions follow least privilege and maker-checker: no single role can both
 * create and activate pricing, or approve and disburse its own loan.
 */
export enum Role {
  CUSTOMER = 'CUSTOMER',
  SUPER_ADMIN = 'SUPER_ADMIN',
  COMPLIANCE_OFFICER = 'COMPLIANCE_OFFICER',
  CREDIT_RISK_MANAGER = 'CREDIT_RISK_MANAGER',
  CREDIT_ANALYST = 'CREDIT_ANALYST',
  OPERATIONS_MANAGER = 'OPERATIONS_MANAGER',
  KYC_VERIFIER = 'KYC_VERIFIER',
  FINANCE_MANAGER = 'FINANCE_MANAGER',
  COLLECTION_AGENT = 'COLLECTION_AGENT',
  CUSTOMER_SUPPORT = 'CUSTOMER_SUPPORT',
  GRIEVANCE_OFFICER = 'GRIEVANCE_OFFICER',
  AUDITOR = 'AUDITOR',
}

export enum Permission {
  STAFF_MANAGE = 'staff.manage',
  PRICING_DRAFT = 'pricing.draft',
  PRICING_ACTIVATE = 'pricing.activate',
  PRICING_VIEW = 'pricing.view',
  APPLICATION_VIEW = 'application.view',
  APPLICATION_REVIEW = 'application.review',
  DISBURSAL_VIEW = 'disbursal.view',
  DISBURSAL_RETRY = 'disbursal.retry',
  RECONCILE = 'reconcile.run',
  METRICS_VIEW = 'metrics.view',
  AUDIT_VIEW = 'audit.view',
}

const P = Permission;
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.CUSTOMER]: [],
  [Role.SUPER_ADMIN]: [P.STAFF_MANAGE, P.METRICS_VIEW, P.AUDIT_VIEW],
  [Role.COMPLIANCE_OFFICER]: [P.PRICING_ACTIVATE, P.PRICING_VIEW, P.APPLICATION_VIEW, P.METRICS_VIEW, P.AUDIT_VIEW],
  [Role.CREDIT_RISK_MANAGER]: [P.PRICING_DRAFT, P.PRICING_VIEW, P.APPLICATION_VIEW, P.METRICS_VIEW],
  [Role.CREDIT_ANALYST]: [P.APPLICATION_VIEW, P.APPLICATION_REVIEW],
  [Role.OPERATIONS_MANAGER]: [P.APPLICATION_VIEW, P.DISBURSAL_VIEW, P.DISBURSAL_RETRY, P.METRICS_VIEW],
  [Role.KYC_VERIFIER]: [P.APPLICATION_VIEW],
  [Role.FINANCE_MANAGER]: [P.DISBURSAL_VIEW, P.RECONCILE, P.METRICS_VIEW],
  [Role.COLLECTION_AGENT]: [],
  [Role.CUSTOMER_SUPPORT]: [P.APPLICATION_VIEW],
  [Role.GRIEVANCE_OFFICER]: [P.APPLICATION_VIEW],
  [Role.AUDITOR]: [P.PRICING_VIEW, P.APPLICATION_VIEW, P.DISBURSAL_VIEW, P.METRICS_VIEW, P.AUDIT_VIEW],
};

export const STAFF_ROLES: Role[] = Object.values(Role).filter((r) => r !== Role.CUSTOMER);

export function permissionsFor(roles: Role[]): Set<Permission> {
  return new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
}

/**
 * A small team (e.g. 5 employees) holds several roles each. These pairs may never be held
 * by the same person, so maker-checker survives even with very few staff.
 */
export const CONFLICTING_ROLE_PAIRS: [Role, Role][] = [
  [Role.CREDIT_RISK_MANAGER, Role.COMPLIANCE_OFFICER], // drafts pricing vs activates pricing
  [Role.COLLECTION_AGENT, Role.GRIEVANCE_OFFICER], // collects vs hears complaints about collection
  [Role.SUPER_ADMIN, Role.AUDITOR], // manages users vs audits them
  [Role.CREDIT_ANALYST, Role.AUDITOR],
  [Role.FINANCE_MANAGER, Role.AUDITOR],
];

export function findRoleConflicts(roles: Role[]): [Role, Role][] {
  const set = new Set(roles);
  return CONFLICTING_ROLE_PAIRS.filter(([a, b]) => set.has(a) && set.has(b));
}

/** Suggested setup for a 5-person company. Used by the seed script and the docs. */
export const FIVE_PERSON_TEAM: { title: string; roles: Role[] }[] = [
  { title: 'Founder / Director', roles: [Role.SUPER_ADMIN, Role.CREDIT_RISK_MANAGER] },
  { title: 'Compliance & Grievance Head', roles: [Role.COMPLIANCE_OFFICER, Role.GRIEVANCE_OFFICER] },
  { title: 'Finance & Accounts', roles: [Role.FINANCE_MANAGER] },
  { title: 'Credit & Operations', roles: [Role.CREDIT_ANALYST, Role.OPERATIONS_MANAGER, Role.KYC_VERIFIER] },
  { title: 'Support & Collections', roles: [Role.CUSTOMER_SUPPORT, Role.COLLECTION_AGENT] },
];
