import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, zodBody } from '@http';
import { type BookingId, type Uuid } from '@kernel';

import { AncillaryService } from '../application/services/ancillary.service';

const AttachAncillarySchema = z.object({
  bookingId: z.string().uuid(),
  items: z
    .array(z.object({ ancillaryId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
    .min(1),
});
const UpsertAncillarySchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  kind: z.enum(['insurance', 'meal', 'luggage', 'priority', 'other']),
  priceMinor: z.number().int().min(0),
  perPassenger: z.boolean().default(true),
});

/** Customer-facing add-on (insurance, meals, luggage) endpoints, and the operator-facing catalogue-management endpoint. */
@ApiTags('ancillary')
@ApiBearerAuth('bearer')
@Controller({ path: 'me/ancillaries', version: '1' })
@ApiStandardErrors()
export class AncillaryController {
  constructor(private readonly ancillary: AncillaryService) {}

  @Get()
  @RequirePermission(Permission.BOOKING_READ)
  @ApiOperation({ summary: 'Add-on catalogue (insurance, meals, luggage, …)' })
  async catalogue() {
    return { items: await this.ancillary.listCatalogue() };
  }

  @Post('attach')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.BOOKING_CREATE)
  @ApiOperation({ summary: 'Attach add-ons to a booking' })
  async attach(@Body(zodBody(AttachAncillarySchema)) dto: z.infer<typeof AttachAncillarySchema>) {
    return this.ancillary.attach(
      dto.bookingId as BookingId,
      dto.items.map((i) => ({ ancillaryId: i.ancillaryId as Uuid, quantity: i.quantity })),
    );
  }

  @Post('catalogue')
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Operator: create/update an ancillary service' })
  async upsertAncillary(
    @Body(zodBody(UpsertAncillarySchema)) dto: z.infer<typeof UpsertAncillarySchema>,
  ) {
    return { id: await this.ancillary.upsert(dto) };
  }
}
