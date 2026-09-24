import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RateLimit,
  RequirePermission,
  zodBody,
} from '@http';
import { type BookingId, type Uuid } from '@kernel';

import { AncillaryService } from '../application/services/ancillary.service';
import {
  AttachAncillarySchema,
  UpsertAncillarySchema,
  type AttachAncillaryDto,
  type UpsertAncillaryDto,
} from './dto/ancillary.dto';

/** Customer-facing add-on (insurance, meals, luggage) endpoints, and the operator-facing catalogue-management endpoint. */
@ApiTags('ancillary')
@ApiBearerAuth('bearer')
@Controller({ path: 'me/ancillaries', version: '1' })
@ApiStandardErrors()
export class AncillaryController {
  constructor(private readonly ancillary: AncillaryService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Add-on catalogue (insurance, meals, luggage, …)' })
  async catalogue() {
    return { items: await this.ancillary.listCatalogue() };
  }

  /**
   * Part of checkout, like hold / payment intent / charge: allowed only while
   * the booking is held (awaiting payment), so it is open to guest checkout.
   */
  @Post('attach')
  @HttpCode(200)
  @Public()
  @RateLimit(30, 60_000, 'ip')
  @Idempotent()
  @ApiOperation({ summary: 'Attach add-ons to a held booking (checkout, before payment)' })
  async attach(@Body(zodBody(AttachAncillarySchema)) dto: AttachAncillaryDto) {
    return this.ancillary.attach(
      dto.bookingId as BookingId,
      dto.items.map((i) => ({ ancillaryId: i.ancillaryId as Uuid, quantity: i.quantity })),
    );
  }

  @Post('catalogue')
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Operator: create/update an ancillary service' })
  async upsertAncillary(@Body(zodBody(UpsertAncillarySchema)) dto: UpsertAncillaryDto) {
    return { id: await this.ancillary.upsert(dto) };
  }
}
