import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, zodBody } from '@http';

import { ConcessionRepository } from '../infrastructure/persistence/concession.repository';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RuleSchema = z.object({
  category: z.enum(['child', 'senior', 'student', 'defence', 'disabled']),
  discountPct: z.number().min(0).max(100),
  minAge: z.number().int().min(0).max(120).nullable().default(null),
  maxAge: z.number().int().min(0).max(120).nullable().default(null),
  requiresIdProof: z.boolean().default(false),
  validFrom: ymd.nullable().default(null),
  validTo: ymd.nullable().default(null),
  maxPerBooking: z.number().int().min(1).max(10).nullable().default(null),
  active: z.boolean().default(true),
}).refine((r) => r.minAge === null || r.maxAge === null || r.minAge <= r.maxAge, { message: 'Minimum age cannot exceed maximum age' })
  .refine((r) => !r.validFrom || !r.validTo || r.validFrom <= r.validTo, { message: 'Concession start date must be on or before its end date' });
const PolicySchema = z.object({
  adultAge: z.number().int().min(12).max(21), infantMaxAge: z.number().int().min(1).max(6),
  infantFeeMinor: z.number().int().min(0).max(1_000_000), allowUnaccompaniedMinors: z.boolean(),
});

/** Operator: passenger concessions (senior, student, defence, child, disabled) and passenger policy (infants, minors). */
@ApiTags('concessions')
@ApiBearerAuth('bearer')
@Controller({ path: 'concessions', version: '1' })
@ApiStandardErrors()
export class ConcessionController {
  constructor(private readonly repo: ConcessionRepository) {}

  @Get()
  @RequirePermission(Permission.FARE_READ)
  async get() { return { rules: await this.repo.rules(), policy: await this.repo.policy(), bookingWindow: await this.repo.bookingWindow() }; }

  @Put('rules')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Create or update one category concession (age band, ID proof, validity window, per-booking limit)' })
  async rule(@Body(zodBody(RuleSchema)) dto: z.infer<typeof RuleSchema>) { await this.repo.upsertRule(dto); return { ok: true }; }

  @Put('booking-window')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'How many days ahead sales open (null = no limit) and how many minutes before departure they close' })
  async bookingWindow(@Body(zodBody(z.object({ maxAdvanceDays: z.number().int().min(1).max(365).nullable(), minMinutesBeforeDeparture: z.number().int().min(0).max(1440) }))) dto: { maxAdvanceDays: number | null; minMinutesBeforeDeparture: number }) {
    await this.repo.setBookingWindow(dto);
    return { ok: true };
  }

  @Put('policy')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Adult age, infant age limit and fee, and whether unaccompanied minors may book' })
  async policy(@Body(zodBody(PolicySchema)) dto: z.infer<typeof PolicySchema>) { await this.repo.setPolicy(dto); return { ok: true }; }
}
