import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';
import { AppError, ErrorCode, type UserId } from '@kernel';

import { CustomerRepository } from '../infrastructure/persistence/customer.repository';
import {
  BlacklistCustomerSchema,
  CustomerPreferencesSchema,
  type BlacklistCustomerDto,
  type CustomerPreferencesDto,
} from './dto/crm.dto';

@ApiTags('crm')
@ApiBearerAuth('bearer')
@Controller({ path: 'customers', version: '1' })
@ApiStandardErrors()
export class CrmController {
  constructor(private readonly customers: CustomerRepository) {}

  @Get('search')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Search customers by name (partial) or exact phone/email' })
  async search(@Query('q') q?: string) {
    if (!q?.trim()) return { items: [] };
    return { items: await this.customers.search(q) };
  }

  @Get(':id')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({
    summary: 'Customer profile — spend, booking count, frequent-traveller flag, blacklist status',
  })
  async profile(@UuidParam('id') id: string) {
    const profile = await this.customers.profile(id as UserId);
    if (!profile)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Customer not found' });
    return profile;
  }

  @Get(':id/bookings')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: "A customer's booking history" })
  async bookings(@UuidParam('id') id: string) {
    return { items: await this.customers.bookingHistory(id as UserId) };
  }

  @Post(':id/blacklist')
  @RequirePermission(Permission.BOOKING_CANCEL)
  @ApiOperation({
    summary:
      'Blacklist a customer — blocks NEW bookings; existing bookings and their history stay fully visible to support',
  })
  async blacklist(
    @UuidParam('id') id: string,
    @Body(zodBody(BlacklistCustomerSchema)) dto: BlacklistCustomerDto,
  ) {
    await this.customers.setBlacklist(id as UserId, true, dto.reason);
    return { ok: true };
  }

  @Post(':id/unblacklist')
  @RequirePermission(Permission.BOOKING_CANCEL)
  @ApiOperation({ summary: 'Remove a customer from the blacklist' })
  async unblacklist(@UuidParam('id') id: string) {
    await this.customers.setBlacklist(id as UserId, false);
    return { ok: true };
  }

  @Post(':id/preferences')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({
    summary:
      "Update a customer's saved preferences (seat position, meal, notification channel, etc.) — merges with existing",
  })
  async setPreferences(
    @UuidParam('id') id: string,
    @Body(zodBody(CustomerPreferencesSchema)) preferences: CustomerPreferencesDto,
  ) {
    await this.customers.setPreferences(id as UserId, preferences);
    return { ok: true };
  }
}
