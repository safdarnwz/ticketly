import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ApiStandardErrors, Idempotent, Public, zodBody } from '@http';

import { ConnectingBookingService } from '../application/services/connecting-booking.service';

const LegSchema = z.object({
  tenantId: z.string().uuid(),
  quoteId: z.string(),
  seatNumbers: z.array(z.string()).min(1),
  passengers: z
    .array(
      z.object({
        seatNumber: z.string(),
        fullName: z.string().min(1),
        age: z.number().int().min(1).max(120).optional(),
        gender: z.string().optional(),
      }),
    )
    .min(1),
});
const HoldConnectionSchema = z.object({
  leg1: LegSchema,
  leg2: LegSchema,
  contactPhone: z.string().min(6),
  contactEmail: z.string().email().optional(),
  customerId: z.string().uuid().optional(),
});

@ApiTags('connections')
@Controller({ path: 'connections', version: '1' })
@ApiStandardErrors()
export class ConnectingBookingController {
  constructor(private readonly connections: ConnectingBookingService) {}

  @Post('hold')
  @HttpCode(200)
  @Public()
  @Idempotent()
  @ApiOperation({
    summary:
      'Hold seats on both legs of a connecting journey - rolls back leg 1 automatically if leg 2 is unavailable. Pay for each leg separately afterward (each stays its own operator own charge).',
  })
  async hold(@Body(zodBody(HoldConnectionSchema)) dto: z.infer<typeof HoldConnectionSchema>) {
    return this.connections.holdConnection(dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Public()
  @Idempotent()
  @ApiOperation({
    summary:
      'Cancel both legs of a connecting journey - each leg refunds under its own operator cancellation policy',
  })
  async cancel(@Param('id') id: string) {
    return this.connections.cancelConnection(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Public()
  @Idempotent()
  @ApiOperation({
    summary:
      'Pay for and confirm both legs. If leg 2 fails after leg 1 succeeds, leg 1 stays confirmed - the response tells you leg 2 needs a retry.',
  })
  async confirm(
    @Param('id') id: string,
    @Body() dto: { leg1Instrument: unknown; leg2Instrument: unknown },
  ) {
    return this.connections.confirmConnection(id, dto.leg1Instrument, dto.leg2Instrument);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Both legs status + PNRs for a connection' })
  async details(@Param('id') id: string) {
    return this.connections.getConnectionDetails(id);
  }
}
