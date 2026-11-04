import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { Equals, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Role } from '../common/roles';

export class RequestOtpDto {
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian mobile number' }) mobile: string;
}
export class VerifyOtpDto {
  @IsUUID() challengeId: string;
  @Matches(/^[6-9]\d{9}$/) mobile: string;
  @Matches(/^\d{6}$/) otp: string;
}
export class StartApplicationDto {
  @IsOptional() @IsString() @MaxLength(128) deviceId?: string;
}
export class KycStartDto {
  @Equals(true, { message: 'KYC consent is required' }) consentKyc: boolean;
}
/** Sandbox only: what DigiLocker would have returned. */
export class SandboxKycDto {
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN format: ABCDE1234F' }) pan: string;
  @IsString() @Length(3, 200) fullName: string;
  @IsISO8601({ strict: true }) dateOfBirth: string;
}
export class BankAccountDto {
  @Matches(/^\d{9,18}$/, { message: 'Account number must be 9–18 digits' }) accountNumber: string;
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'Invalid IFSC' }) ifsc: string;
}
export class AssessmentDto {
  @Type(() => Number) @IsInt() @Min(1000) @Max(10_00_000) requestedAmount: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_00_00_000) monthlyIncome: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_00_00_000) existingMonthlyEmi: number;
  @IsIn(['SALARIED', 'SELF_EMPLOYED']) employmentType: 'SALARIED' | 'SELF_EMPLOYED';
  @Equals(true, { message: 'Credit bureau consent is required' }) consentBureau: boolean;
}
export class AcceptKfsDto {
  @Matches(/^[a-f0-9]{64}$/) kfsHash: string;
  @Equals(true, { message: 'You must confirm you have read the KFS' }) consentKfs: boolean;
}
export class SandboxEsignDto {
  @Matches(/^\d{6}$/) otp: string;
}
export class SandboxPayDto {
  @IsIn(['PAID', 'FAILED']) outcome: 'PAID' | 'FAILED';
  @IsOptional() @IsIn(['UPI', 'NETBANKING', 'DEBIT_CARD']) method?: string;
}
export class RepayDto {
  /** Rupees. Omit to pay the full outstanding amount. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount?: number;
}
export class ReviewDto {
  @IsIn(['APPROVE', 'REJECT']) decision: 'APPROVE' | 'REJECT';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1000) approvedAmount?: number;
  @IsString() @Length(5, 500) note: string;
}
export class StaffLoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
  @Matches(/^\d{6}$/) totp: string;
}
export class CreateStaffDto {
  @IsEmail() email: string;
  @IsString() @Length(2, 200) name: string;
  @IsString() @Length(2, 120) title: string;
  @IsString() @MinLength(12) password: string;
  @IsArray() @IsEnum(Role, { each: true }) roles: Role[];
}
/** Owner's pricing plan form. Amounts in rupees; rates in percent. */
export class PlanDto {
  @IsString() @Length(2, 120) name: string;
  @IsIn(['ALL', 'CUSTOMER']) scope: 'ALL' | 'CUSTOMER';
  @IsOptional() @Matches(/^[6-9]\d{9}$/, { message: 'customerMobile must be a 10-digit mobile number' }) customerMobile?: string | null;
  @IsOptional() @IsString() @MaxLength(120) customerLabel?: string | null;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsISO8601() validFrom?: string | null;
  @IsOptional() @IsISO8601() validUntil?: string | null;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsIn(['PER_DAY', 'PER_ANNUM']) interestUnit: 'PER_DAY' | 'PER_ANNUM';
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(1000) interestRatePercent: number;
  @IsIn(['PERCENT', 'FLAT']) feeType: 'PERCENT' | 'FLAT';
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(10_00_000) feeValue: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100) gstPercent: number;
  @IsInt() @Min(1) @Max(365) tenureDays: number;
  @IsInt() @Min(1) @Max(1_00_00_000) minAmount: number;
  @IsInt() @Min(1) @Max(1_00_00_000) maxAmount: number;
  @IsOptional() @IsIn(['NONE', 'PERCENT_PER_DAY', 'FLAT_PER_DAY']) penalType?: 'NONE' | 'PERCENT_PER_DAY' | 'FLAT_PER_DAY';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) penalValue?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) coolingOffDays?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) aprCapPercent?: number | null;
}
export class UpdatePlanDto extends PartialType(PlanDto) {}
