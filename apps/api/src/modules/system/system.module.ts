import { Module } from '@nestjs/common';

import { MetricsController } from './presentation/metrics.controller';

@Module({ controllers: [MetricsController] })
export class SystemModule {}
