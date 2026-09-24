import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, Idempotent, Public, UuidParam, zodBody } from '@http';

import {
  ConfirmConnectionSchema,
  HoldConnectionSchema,
  type ConfirmConnectionDto,
  type HoldConnectionDto,
} from './dto/connection.dto';
import { ConnectingBookingService } from '../application/services/connecting-booking.service';

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
  async hold(@Body(zodBody(HoldConnectionSchema)) dto: HoldConnectionDto) {
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
  async cancel(@UuidParam('id') id: string) {
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
    @UuidParam('id') id: string,
    @Body(zodBody(ConfirmConnectionSchema)) dto: ConfirmConnectionDto,
  ) {
    return this.connections.confirmConnection(id, dto.leg1Instrument, dto.leg2Instrument);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Both legs status + PNRs for a connection' })
  async details(@UuidParam('id') id: string) {
    return this.connections.getConnectionDetails(id);
  }
}
