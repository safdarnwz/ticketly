import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ApiStandardErrors, Public, RateLimit, zodBody } from '@http';
import { getContext } from '@kernel';

import { CurrentUser, type AuthPrincipal } from './decorators/current-user.decorator';
import {
  CheckIdentitySchema,
  type CheckIdentityDto,
  LoginSchema,
  type LoginDto,
  RefreshSchema,
  type RefreshDto,
  RegisterCustomerSchema,
  type RegisterCustomerDto,
  RequestOtpSchema,
  type RequestOtpDto,
  ResetPasswordSchema,
  type ResetPasswordDto,
  VerifyOtpSchema,
  type VerifyOtpDto,
  VerifyRegistrationSchema,
  type VerifyRegistrationDto,
} from './dto/auth.dto';
import { AuthService } from '../application/services/auth.service';

/**
 * Authentication endpoints. All are `@Public()` (they establish identity rather
 * than requiring it) but heavily rate-limited per IP, because login and OTP are
 * the two most-attacked routes on any platform.
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
@ApiStandardErrors()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit(10, 60_000, 'ip')
  @ApiOperation({ summary: 'Unified login — email OR mobile number + password (any role)' })
  async login(@Body(zodBody(LoginSchema)) dto: LoginDto, @Req() req: FastifyRequest) {
    const ctx = getContext();
    return this.auth.passwordLogin({
      identifier: (dto.identifier ?? dto.email) as string,
      password: dto.password,
      tenantId: ctx?.tenantId ?? null,
      loginSurface: ctx?.extra?.authSurface as
        'customer' | 'superAdmin' | 'tenantAdmin' | 'unresolved' | undefined,
      userAgent: ctx?.userAgent,
      ip: req.ip,
    });
  }

  @Public()
  @Post('check-identity')
  @HttpCode(200)
  @RateLimit(20, 60_000, 'ip')
  @ApiOperation({ summary: 'Is this email/mobile already registered? (pay-time fork)' })
  async checkIdentity(@Body(zodBody(CheckIdentitySchema)) dto: CheckIdentityDto) {
    return this.auth.checkIdentity(dto.identifier);
  }

  @Public()
  @Post('register')
  @HttpCode(202)
  @RateLimit(5, 60_000, 'ip')
  @ApiOperation({ summary: 'Register a customer and send an Email OTP' })
  async register(@Body(zodBody(RegisterCustomerSchema)) dto: RegisterCustomerDto) {
    return this.auth.registerCustomer(dto);
  }

  @Public()
  @Post('register/verify')
  @HttpCode(200)
  @RateLimit(10, 60_000, 'ip')
  @ApiOperation({ summary: 'Verify the registration Email OTP → activate + auto-login' })
  async verifyRegistration(
    @Body(zodBody(VerifyRegistrationSchema)) dto: VerifyRegistrationDto,
    @Req() req: FastifyRequest,
  ) {
    const ctx = getContext();
    return this.auth.verifyRegistration({
      email: dto.email,
      code: dto.code,
      userAgent: ctx?.userAgent,
      ip: req.ip,
    });
  }

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  @RateLimit(5, 60_000, 'ip')
  @ApiOperation({ summary: 'Request a one-time code (customer login)' })
  async requestOtp(@Body(zodBody(RequestOtpSchema)) dto: RequestOtpDto) {
    const ctx = getContext();
    return this.auth.requestOtp({
      identity: dto.identity,
      purpose: dto.purpose,
      tenantId: ctx?.tenantId ?? null,
    });
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @RateLimit(10, 60_000, 'ip')
  @ApiOperation({ summary: 'Verify a one-time code and receive tokens' })
  async verifyOtp(@Body(zodBody(VerifyOtpSchema)) dto: VerifyOtpDto, @Req() req: FastifyRequest) {
    const ctx = getContext();
    return this.auth.verifyOtp({
      identity: dto.identity,
      code: dto.code,
      fullName: dto.fullName,
      tenantId: ctx?.tenantId ?? null,
      userAgent: ctx?.userAgent,
      ip: req.ip,
    });
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  @RateLimit(10, 60_000, 'ip')
  @ApiOperation({
    summary:
      "Reset a forgotten password — request the code first via otp/request with purpose='password_reset'",
  })
  async resetPassword(@Body(zodBody(ResetPasswordSchema)) dto: ResetPasswordDto) {
    const ctx = getContext();
    await this.auth.resetPasswordWithOtp({
      identity: dto.identity,
      code: dto.code,
      newPassword: dto.newPassword,
      tenantId: ctx?.tenantId ?? null,
    });
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit(30, 60_000, 'ip')
  @ApiOperation({ summary: 'Rotate a refresh token' })
  async refresh(@Body(zodBody(RefreshSchema)) dto: RefreshDto, @Req() req: FastifyRequest) {
    return this.auth.refresh(dto.refreshToken, { userAgent: getContext()?.userAgent, ip: req.ip });
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@Body(zodBody(RefreshSchema)) dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  async logoutAll(@CurrentUser() user: AuthPrincipal): Promise<void> {
    if (user.userId) await this.auth.logoutAll(user.userId);
  }

  @Get('me')
  @ApiOperation({ summary: 'The current authenticated principal' })
  me(@CurrentUser() user: AuthPrincipal) {
    return {
      userId: user.userId,
      tenantId: user.tenantId,
      actorType: user.actorType,
      roles: user.roles,
      permissions: [...user.permissions],
    };
  }
}
