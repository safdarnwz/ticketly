import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { AppConfig } from '@config';
import { AppError, ErrorCode, todayIn } from '@kernel';

import { concessionRuleProblem, policyProblem } from '../domain/passenger-categories';
import { ApiStandardErrors, Public, RateLimit, RequirePermission, zodBody, zodQuery } from '@http';

import { ConcessionRepository } from '../infrastructure/persistence/concession.repository';
import {
  BookingWindowSchema,
  ConcessionRuleSchema,
  AccessibleSeatRuleSchema,
  PassengerPolicySchema,
  type BookingWindowDto,
  type ConcessionRuleDto,
  type AccessibleSeatRuleDto,
  type PassengerPolicyDto,
  CheckoutConcessionQuerySchema,
  type CheckoutConcessionQueryDto,
} from './dto/concession.dto';

/** Operator: passenger concessions (senior, student, defence, child, disabled) and passenger policy (infants, minors). */
@ApiTags('concessions')
@ApiBearerAuth('bearer')
@Controller({ path: 'concessions', version: '1' })
@ApiStandardErrors()
export class ConcessionController {
  constructor(
    private readonly repo: ConcessionRepository,
    private readonly config: AppConfig,
  ) {}

  /**
   * What a passenger can claim at checkout on this operator: the active
   * concessions valid on the journey date, and the age rules. Public (the
   * storefront sends X-Tenant-Id of the chosen trip); read-only.
   */
  @Get('checkout')
  @Public()
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({ summary: 'Concessions and passenger age rules a customer can use at checkout' })
  async checkout(@Query(zodQuery(CheckoutConcessionQuerySchema)) q: CheckoutConcessionQueryDto) {
    const [rules, policy] = await Promise.all([this.repo.rules(), this.repo.policy()]);
    return {
      concessions: rules
        .filter(
          (r) =>
            r.active &&
            (!q.journeyDate ||
              ((!r.validFrom || r.validFrom <= q.journeyDate) &&
                (!r.validTo || r.validTo >= q.journeyDate))),
        )
        .map((r) => ({
          category: r.category,
          discountPct: r.discountPct,
          minAge: r.minAge,
          maxAge: r.maxAge,
          requiresIdProof: r.requiresIdProof,
          maxPerBooking: r.maxPerBooking,
        })),
      policy,
    };
  }

  @Get()
  @RequirePermission(Permission.FARE_READ)
  async get() {
    return {
      rules: await this.repo.rules(),
      policy: await this.repo.policy(),
      bookingWindow: await this.repo.bookingWindow(),
      accessibleSeats: { releaseHours: await this.repo.accessibleReleaseHours() },
    };
  }

  @Put('rules')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary:
      'Create or update one category concession (age band, ID proof, validity window, per-booking limit)',
  })
  async rule(@Body(zodBody(ConcessionRuleSchema)) dto: ConcessionRuleDto) {
    const problem = concessionRuleProblem(
      dto,
      await this.repo.policy(),
      todayIn(this.config.domain.timezone),
    );
    if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
    await this.repo.upsertRule(dto);
    return { ok: true };
  }

  @Put('booking-window')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary:
      'How many days ahead sales open (null = no limit) and how many minutes before departure they close',
  })
  async bookingWindow(@Body(zodBody(BookingWindowSchema)) dto: BookingWindowDto) {
    await this.repo.setBookingWindow(dto);
    return { ok: true };
  }

  @Put('accessible-seats')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary:
      'Disability-friendly seats are kept for passengers in the disabled category until this many hours before departure (null = always)',
  })
  async accessibleSeats(@Body(zodBody(AccessibleSeatRuleSchema)) dto: AccessibleSeatRuleDto) {
    await this.repo.setAccessibleReleaseHours(dto.releaseHours);
    return { ok: true, releaseHours: dto.releaseHours };
  }

  @Put('policy')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary: 'Adult age, infant age limit and fee, and whether unaccompanied minors may book',
  })
  async policy(@Body(zodBody(PassengerPolicySchema)) dto: PassengerPolicyDto) {
    const problem = policyProblem(dto, await this.repo.rules());
    if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
    await this.repo.setPolicy(dto);
    return { ok: true };
  }
}
