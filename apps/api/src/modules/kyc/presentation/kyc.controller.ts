import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ApiStandardErrors, Public, UuidParam, zodBody } from '@http';

import { KycService } from '../application/services/kyc.service';

const CheckPanFormatSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  pan: z.string().min(10).max(10),
});
const VerifyPanSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  pan: z.string().min(10).max(10),
  applicantName: z.string().optional(),
});
const StartAadhaarSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  aadhaarNumber: z.string().min(12).max(14),
});
const SubmitAadhaarOtpSchema = z.object({
  verificationId: z.string().uuid(),
  otp: z.string().min(4).max(8),
});
const VerifyBankAccountSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  accountNumber: z.string().min(4).max(34),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
});

@ApiTags('kyc')
@Controller({ path: 'kyc', version: '1' })
@ApiStandardErrors()
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('pan/check-format')
  @Public()
  @ApiOperation({
    summary:
      'Instant, free, offline PAN format check (structure + holder-type code) — run this before the paid Digio verify',
  })
  async checkPanFormat(
    @Body(zodBody(CheckPanFormatSchema)) dto: z.infer<typeof CheckPanFormatSchema>,
  ) {
    return this.kyc.checkPanFormat(dto.operatorApplicationId, dto.pan);
  }

  @Post('pan/verify')
  @Public()
  @ApiOperation({
    summary: 'Genuine PAN-database match via Digio (paid) — confirms the PAN actually exists',
  })
  async verifyPan(@Body(zodBody(VerifyPanSchema)) dto: z.infer<typeof VerifyPanSchema>) {
    return this.kyc.verifyPanWithDigio(dto.operatorApplicationId, dto.pan, dto.applicantName);
  }

  @Post('aadhaar/start')
  @Public()
  @ApiOperation({
    summary: 'Start Aadhaar OKYC — sends an OTP to the Aadhaar-linked mobile via Digio',
  })
  async startAadhaar(@Body(zodBody(StartAadhaarSchema)) dto: z.infer<typeof StartAadhaarSchema>) {
    return this.kyc.startAadhaarVerification(dto.operatorApplicationId, dto.aadhaarNumber);
  }

  @Post('aadhaar/submit-otp')
  @Public()
  @ApiOperation({ summary: 'Submit the Aadhaar OTP to complete verification' })
  async submitAadhaarOtp(
    @Body(zodBody(SubmitAadhaarOtpSchema)) dto: z.infer<typeof SubmitAadhaarOtpSchema>,
  ) {
    return this.kyc.submitAadhaarOtp(dto.verificationId, dto.otp);
  }

  @Post('bank-account/verify')
  @Public()
  @ApiOperation({
    summary:
      'Verify a bank account (penny-drop / account-aggregator-backed via Digio) — confirms it exists and returns the registered holder name',
  })
  async verifyBankAccount(
    @Body(zodBody(VerifyBankAccountSchema)) dto: z.infer<typeof VerifyBankAccountSchema>,
  ) {
    return this.kyc.verifyBankAccount(dto.operatorApplicationId, dto.accountNumber, dto.ifsc);
  }

  @Get('status/:operatorApplicationId')
  @Public()
  @ApiOperation({
    summary:
      'Current PAN/Aadhaar/bank-account verification status for an in-progress onboarding application',
  })
  async status(@UuidParam('operatorApplicationId') operatorApplicationId: string) {
    return this.kyc.statusForApplication(operatorApplicationId);
  }
}
