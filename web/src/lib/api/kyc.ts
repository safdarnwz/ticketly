import { get, post } from './client';

export const kycApi = {
  checkPanFormat: (operatorApplicationId: string, pan: string) =>
    post<{ wellFormed: boolean; reason?: string }>('/v1/kyc/pan/check-format', { operatorApplicationId, pan }),

  verifyPan: (operatorApplicationId: string, pan: string, applicantName?: string) =>
    post<{ matched: boolean; nameAtPan?: string; reason?: string }>('/v1/kyc/pan/verify', { operatorApplicationId, pan, applicantName }),

  startAadhaar: (operatorApplicationId: string, aadhaarNumber: string) =>
    post<{ verificationId: string }>('/v1/kyc/aadhaar/start', { operatorApplicationId, aadhaarNumber }),

  submitAadhaarOtp: (verificationId: string, otp: string) =>
    post<{ verified: boolean; name?: string; maskedAadhaar?: string; reason?: string }>('/v1/kyc/aadhaar/submit-otp', { verificationId, otp }),

  verifyBankAccount: (operatorApplicationId: string, accountNumber: string, ifsc: string) =>
    post<{ verified: boolean; nameAtBank?: string; reason?: string }>('/v1/kyc/bank-account/verify', { operatorApplicationId, accountNumber, ifsc }),

  status: (operatorApplicationId: string) =>
    get<{ id: string; documentType: string; status: string; verifiedName: string | null; maskedNumber: string | null }[]>(`/v1/kyc/status/${operatorApplicationId}`),
};
