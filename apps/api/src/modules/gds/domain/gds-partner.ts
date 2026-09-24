/**
 * GDS partner vocabulary — mirrors the CHECK constraints on gds_partners and
 * gds_agreements so the API, the service and the database agree.
 */

/** An online travel aggregator, or a multi-operator agent. */
export const PARTNER_KINDS = ['ota', 'agent'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

/** `pending` until the platform first activates the partner. */
export const PARTNER_STATUSES = ['pending', 'active', 'suspended'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** Statuses the platform admin may set (a partner never goes back to pending). */
export const SETTABLE_PARTNER_STATUSES = ['active', 'suspended'] as const;
export type SettablePartnerStatus = (typeof SETTABLE_PARTNER_STATUSES)[number];

/** Prepaid partners spend a deposit; postpaid partners spend a credit limit. */
export const BILLING_MODES = ['prepaid', 'postpaid'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

/** An operator's agreement to distribute through one partner. */
export const AGREEMENT_STATUSES = ['active', 'paused'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
