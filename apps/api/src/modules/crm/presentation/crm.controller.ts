import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, zodBody, zodQuery } from '@http';
import { getUserId, isUuid, NotFoundError } from '@kernel';

import {
  CustomerRepository,
  mobileKey,
  type CustomerKey,
} from '../infrastructure/persistence/customer.repository';
import {
  BlockCustomerSchema,
  CustomerListQuerySchema,
  type BlockCustomerDto,
  type CustomerListQueryDto,
} from './dto/crm.dto';

/**
 * The operator's customers, from its own bookings. A customer is addressed by
 * their account id (booked signed in) or their 10-digit mobile (guest).
 */
@ApiTags('crm')
@ApiBearerAuth('bearer')
@Controller({ path: 'customers', version: '1' })
@ApiStandardErrors()
export class CrmController {
  constructor(private readonly customers: CustomerRepository) {}

  @Get()
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({
    summary:
      'Customers who booked with this operator — search name / mobile / email / PNR, frequent or blocked',
  })
  async list(@Query(zodQuery(CustomerListQuerySchema)) q: CustomerListQueryDto) {
    const rows = await this.customers.list({
      q: q.q,
      filter: q.filter,
      offset: (q.page - 1) * q.limit,
      limit: q.limit + 1,
    });
    return { items: rows.slice(0, q.limit), page: q.page, hasMore: rows.length > q.limit };
  }

  @Get(':key')
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'A customer: totals, block, and their bookings with this operator' })
  async profile(@Param('key') raw: string) {
    const key = this.key(raw);
    const profile = await this.customers.profile(key);
    if (!profile) throw new NotFoundError('Customer', raw);
    const [history, block] = await Promise.all([
      this.customers.bookingHistory(key),
      this.customers.blockFor(key),
    ]);
    return { ...profile, block, history };
  }

  @Post(':key/block')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_CANCEL)
  @ApiOperation({
    summary:
      'Block a customer from booking with this operator (account and mobile) — their bookings stay as they are',
  })
  async block(
    @Param('key') raw: string,
    @Body(zodBody(BlockCustomerSchema)) dto: BlockCustomerDto,
  ) {
    const key = this.key(raw);
    const profile = await this.customers.profile(key);
    if (!profile) throw new NotFoundError('Customer', raw);
    await this.customers.block({
      customerId: profile.customerId,
      phone: mobileKey(profile.phone),
      reason: dto.reason,
      by: getUserId() ?? null,
    });
    return { ok: true };
  }

  @Post(':key/unblock')
  @HttpCode(200)
  @RequirePermission(Permission.BOOKING_CANCEL)
  @ApiOperation({ summary: 'Let a blocked customer book again' })
  async unblock(@Param('key') raw: string) {
    const key = this.key(raw);
    const profile = await this.customers.profile(key);
    if (!profile) throw new NotFoundError('Customer', raw);
    if (!(await this.customers.unblock(profile.customerId, mobileKey(profile.phone))))
      throw new NotFoundError('Block', raw);
    return { ok: true };
  }

  private key(raw: string): CustomerKey {
    if (isUuid(raw)) return { customerId: raw };
    const phone = mobileKey(raw);
    if (!phone || raw.replace(/\D/g, '').length > 12) throw new NotFoundError('Customer', raw);
    return { phone };
  }
}
