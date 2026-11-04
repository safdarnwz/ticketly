import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CustomerPrincipal } from '../auth/auth.types';
import { CurrentUser, CustomerAuthGuard } from '../auth/guards';
import { AcceptKfsDto, AssessmentDto, BankAccountDto, EsignCompleteDto, KycDto, RequestOtpDto, StartApplicationDto, VerifyOtpDto } from './dto';
import { InstantLoanService } from './instant-loan.service';

@Controller('auth')
export class CustomerAuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request') @HttpCode(200)
  request(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.mobile);
  }

  @Post('otp/verify') @HttpCode(200)
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.challengeId, dto.mobile, dto.otp);
  }
}

@Controller('applications')
@UseGuards(CustomerAuthGuard)
export class InstantLoanController {
  constructor(private readonly svc: InstantLoanService) {}

  @Post()
  start(@CurrentUser() u: CustomerPrincipal, @Body() dto: StartApplicationDto, @Ip() ip: string) {
    return this.svc.start(u, ip ?? null, dto.deviceId ?? null);
  }

  @Get(':id')
  status(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.status(id, u);
  }

  @Post(':id/kyc') @HttpCode(200)
  kyc(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: KycDto) {
    return this.svc.kyc(id, u, dto);
  }

  @Post(':id/bank-account') @HttpCode(200)
  bank(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BankAccountDto) {
    return this.svc.bankAccount(id, u, dto);
  }

  @Post(':id/assessment') @HttpCode(200)
  assess(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssessmentDto) {
    return this.svc.assess(id, u, dto);
  }

  @Get(':id/kfs')
  kfs(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.kfs(id, u);
  }

  @Post(':id/kfs/accept') @HttpCode(200)
  accept(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptKfsDto) {
    return this.svc.acceptKfs(id, u, dto);
  }

  @Post(':id/esign/initiate') @HttpCode(200)
  esignInit(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.esignInitiate(id, u);
  }

  @Post(':id/esign/complete') @HttpCode(200)
  esignDone(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EsignCompleteDto) {
    return this.svc.esignComplete(id, u, dto.otp);
  }
}
