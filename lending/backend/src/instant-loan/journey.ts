/**
 * The 5-minute instant disbursal journey. Each step has a target "complete by" offset
 * measured from the moment the customer finishes OTP login (t = 0).
 */
export enum JourneyStep {
  OTP_LOGIN = 'OTP_LOGIN',
  KYC = 'KYC',
  BANK_VERIFICATION = 'BANK_VERIFICATION',
  CREDIT_RISK = 'CREDIT_RISK',
  APPROVAL = 'APPROVAL',
  KFS_ESIGN = 'KFS_ESIGN',
  DISBURSAL = 'DISBURSAL',
}

export const STEP_TARGETS: { step: JourneyStep; startsAtSec: number; completeBySec: number; label: string }[] = [
  { step: JourneyStep.OTP_LOGIN, startsAtSec: 0, completeBySec: 30, label: 'Mobile OTP Login' },
  { step: JourneyStep.KYC, startsAtSec: 30, completeBySec: 90, label: 'KYC Verification' },
  { step: JourneyStep.BANK_VERIFICATION, startsAtSec: 90, completeBySec: 150, label: 'Bank Account Verification' },
  { step: JourneyStep.CREDIT_RISK, startsAtSec: 150, completeBySec: 210, label: 'Credit & Risk Assessment' },
  { step: JourneyStep.APPROVAL, startsAtSec: 210, completeBySec: 240, label: 'Loan Approval' },
  { step: JourneyStep.KFS_ESIGN, startsAtSec: 240, completeBySec: 300, label: 'KFS & E-Sign' },
  { step: JourneyStep.DISBURSAL, startsAtSec: 300, completeBySec: 300, label: 'Digital Disbursement' },
];

export enum ApplicationStatus {
  STARTED = 'STARTED',
  KYC_VERIFIED = 'KYC_VERIFIED',
  BANK_VERIFIED = 'BANK_VERIFIED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  KFS_ACCEPTED = 'KFS_ACCEPTED',
  ESIGN_PENDING = 'ESIGN_PENDING',
  DISBURSING = 'DISBURSING',
  DISBURSED = 'DISBURSED',
  DISBURSAL_FAILED = 'DISBURSAL_FAILED',
  EXPIRED = 'EXPIRED',
}

const S = ApplicationStatus;
export const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  [S.STARTED]: [S.KYC_VERIFIED, S.REJECTED, S.EXPIRED],
  [S.KYC_VERIFIED]: [S.BANK_VERIFIED, S.REJECTED, S.EXPIRED],
  [S.BANK_VERIFIED]: [S.APPROVED, S.REJECTED, S.MANUAL_REVIEW, S.EXPIRED],
  [S.MANUAL_REVIEW]: [S.APPROVED, S.REJECTED, S.EXPIRED],
  [S.APPROVED]: [S.KFS_ACCEPTED, S.EXPIRED],
  [S.KFS_ACCEPTED]: [S.ESIGN_PENDING, S.EXPIRED],
  [S.ESIGN_PENDING]: [S.DISBURSING, S.EXPIRED],
  [S.DISBURSING]: [S.DISBURSED, S.DISBURSAL_FAILED],
  [S.DISBURSED]: [],
  [S.DISBURSAL_FAILED]: [],
  [S.REJECTED]: [],
  [S.EXPIRED]: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
