import { Type } from 'class-transformer';
import { Equals, IsArray, IsEmail, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
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
export class KycDto {
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'PAN format: ABCDE1234F' }) pan: string;
  @IsString() @Length(3, 200) fullName: string;
  @IsISO8601({ strict: true }) dateOfBirth: string;
  @Equals(true, { message: 'KYC consent is required' }) consentKyc: boolean;
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
export class EsignCompleteDto {
  @Matches(/^\d{6}$/) otp: string;
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
export class PolicyDraftDto {
  @IsString() @Length(3, 120) name: string;
  @IsInt() @Min(0) @Max(100_000) annualInterestBps: number;
  @IsInt() @Min(0) @Max(5000) processingFeeBps: number;
  @IsInt() @Min(0) @Max(5000) gstOnFeeBps: number;
  @IsInt() @Min(1) @Max(365) tenureDays: number;
  @IsInt() @Min(100) minPrincipalPaise: number;
  @IsInt() @Min(100) maxPrincipalPaise: number;
  @IsInt() @Min(1) aprCapBps: number;
  @IsInt() @Min(1) @Max(30) coolingOffDays: number;
  @IsString() @Length(5, 2000) penalChargesText: string;
}
export class ActivatePolicyDto {
  @IsString() @Length(3, 200) boardApprovalRef: string;
}
