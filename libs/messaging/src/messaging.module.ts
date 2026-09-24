import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { ObservabilityModule } from '@observability';

import { EventBus } from './event-bus';

@Global()
@Module({
  imports: [DatabaseModule, ObservabilityModule],
  providers: [EventBus],
  exports: [EventBus],
})
export class MessagingModule {}
