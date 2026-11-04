import { AuditLog } from './audit/audit-log.entity';
import { OtpChallenge } from './auth/otp-challenge.entity';
import { BankAccount } from './customers/bank-account.entity';
import { Customer } from './customers/customer.entity';
import { Disbursement } from './disbursement/disbursement.entity';
import { JourneyEvent } from './instant-loan/journey-event.entity';
import { LoanApplication } from './instant-loan/loan-application.entity';
import { Loan } from './instant-loan/loan.entity';
import { PricingPolicy } from './pricing/pricing-policy.entity';
import { StaffUser } from './staff/staff-user.entity';

export const ENTITIES = [AuditLog, OtpChallenge, BankAccount, Customer, Disbursement, JourneyEvent, LoanApplication, Loan, PricingPolicy, StaffUser];
