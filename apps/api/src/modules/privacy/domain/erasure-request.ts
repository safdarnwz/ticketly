/** A DPDP erasure request: pending until the platform processes (anonymises) or rejects it. */
export const ERASURE_STATUSES = ['pending', 'processed', 'rejected'] as const;
export type ErasureStatus = (typeof ERASURE_STATUSES)[number];
