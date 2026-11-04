import { Role } from '../common/roles';

export interface CustomerPrincipal {
  typ: 'customer';
  sub: string;
  mobile: string;
  /** Epoch ms when OTP login succeeded: t = 0 of the instant journey. */
  loginAt: number;
  otpMs: number;
}

export interface StaffPrincipal {
  typ: 'staff';
  sub: string;
  roles: Role[];
}

export type Principal = CustomerPrincipal | StaffPrincipal;
