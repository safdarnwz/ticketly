import { Module } from '@nestjs/common';

import { RealtimeService } from './application/services/realtime.service';
import { RealtimeController } from './presentation/realtime.controller';

/**
 * Realtime (Part 15). Live seat-availability push over SSE. Framing + seat-delta
 * logic is pure (domain/sse.ts); the service fans out per-trip streams and emits
 * only deltas. `RealtimeService` is exported so the booking flow can publish
 * availability changes (or a Redis subscriber can, at scale).
 */
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
