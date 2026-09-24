import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { CrewAppController } from './presentation/crew-app.controller';
import { CrewAppService } from './application/services/crew-app.service';

@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [CrewAppController],
  providers: [CrewAppService],
  exports: [CrewAppService],
})
export class CrewAppModule {}
