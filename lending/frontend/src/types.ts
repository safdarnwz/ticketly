export interface Offer {
  principalPaise: number;
  processingFeePaise: number;
  gstOnFeePaise: number;
  netDisbursalPaise: number;
  interestPaise: number;
  totalRepayablePaise: number;
  totalCostPaise: number;
  tenureDays: number;
  aprBps: number;
}

export interface Step {
  step: string;
  label: string;
  startsAtSec: number;
  completeBySec: number;
  outcome: 'PASSED' | 'FAILED' | 'REFERRED' | null;
  durationMs: number | null;
  elapsedMs: number | null;
  onTime: boolean | null;
}

export interface AppStatus {
  id: string;
  status: string;
  journeyStartedAt: string;
  elapsedMs: number;
  targetMs: number;
  withinTarget: boolean | null;
  reasons: string[];
  offer: Offer | null;
  offerExpiresAt: string | null;
  steps: Step[];
  loan: null | { id: string; status: string; netDisbursalPaise: number; totalRepayablePaise: number; dueDate: string | null; coolingOffEndsOn: string | null; disbursedAt: string | null };
  payouts: { attempt: number; rail: string; status: string; utr: string | null; failureCode: string | null }[];
}
