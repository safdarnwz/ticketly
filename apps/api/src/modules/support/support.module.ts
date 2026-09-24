import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { SupportController } from './presentation/support.controller';
import { SupportRepository } from './infrastructure/persistence/support.repository';
import { SupportService } from './application/services/support.service';

/**
 * Customer support (Part 14). Tickets with an append-only message thread and a
 * small state machine (open ⇄ pending → resolved → closed). Transition rules
 * live in domain/ticket-state.ts.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [SupportController],
  providers: [SupportRepository, SupportService],
  exports: [SupportService],
})
export class SupportModule {}
