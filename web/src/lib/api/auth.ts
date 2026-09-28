import { get, post } from './client';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface Principal { userId: string | null; tenantId: string | null; actorType: string; roles: string[]; permissions: string[] }

export const authApi = {
  /** Who I am and what my roles let me do right now. */
  me: () => get<Principal>('/v1/auth/me'),
  /** Unified login — identifier is an email OR a mobile number. */
  login: (identifier: string, password: string) =>
    post<AuthTokens>('/v1/auth/login', { identifier, password }),

  /** Is this email/mobile already registered? (pay-time fork) */
  checkIdentity: (identifier: string) =>
    post<{ registered: boolean; channel: 'email' | 'phone' }>('/v1/auth/check-identity', { identifier }),

  /** Register a customer → sends an Email OTP. */
  register: (input: { fullName: string; email: string; mobile: string; password: string }) =>
    post<{ challengeId: string; email: string }>('/v1/auth/register', input),

  /** Verify the registration Email OTP → activates + auto-logs-in. */
  verifyRegistration: (email: string, code: string) =>
    post<AuthTokens>('/v1/auth/register/verify', { email, code }),

  refresh: (refreshToken: string) => post<AuthTokens>('/v1/auth/refresh', { refreshToken }),
  logout: (refreshToken: string) => post<void>('/v1/auth/logout', { refreshToken }),
  /** Every session of mine ends, this one included. */
  logoutAll: () => post<void>('/v1/auth/logout-all', {}),
  /** Change my own password; my other sessions end, this one stays. */
  changePassword: (currentPassword: string, newPassword: string) => post<void>('/v1/auth/password', { currentPassword, newPassword }),

  /** Step 1 of forgot-password: send a code to email/mobile. */
  requestPasswordResetOtp: (identity: string) =>
    post<{ challengeId: string; expiresInSeconds: number }>('/v1/auth/otp/request', { identity, purpose: 'password_reset' }),

  /** Step 2: verify the code and set a new password. */
  confirmPasswordReset: (identity: string, code: string, newPassword: string) =>
    post<{ ok: boolean }>('/v1/auth/password-reset/confirm', { identity, code, newPassword }),
};
