import { UuidParam } from '@http';
import { Controller, Sse } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Observable, map } from 'rxjs';

import { type TripId } from '@kernel';

import { RealtimeService, type SeatUpdate } from '../application/services/realtime.service';

interface MessageEvent {
  data: string | object;
  type?: string;
  id?: string;
  retry?: number;
}

/**
 * Realtime seat availability over Server-Sent Events. A storefront opens
 * `GET /v1/realtime/trips/:tripId/seats` and receives `seat.update` events as
 * seats are taken or freed — no polling.
 */
@ApiTags('realtime')
@Controller({ path: 'realtime', version: '1' })
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('trips/:tripId/seats')
  @ApiOperation({ summary: 'Live seat-availability stream (SSE)' })
  seats(@UuidParam('tripId') tripId: string): Observable<MessageEvent> {
    return this.realtime
      .stream(tripId as TripId)
      .pipe(map((u: SeatUpdate): MessageEvent => ({ type: u.type, data: u.data })));
  }
}
