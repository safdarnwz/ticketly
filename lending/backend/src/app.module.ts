import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController, StaffAuthController } from './admin/admin.controller';
import { MetricsService } from './admin/metrics.service';
import { AuditModule } from './audit/audit.module';
import { AuthService } from './auth/auth.service';
import { AppConfigModule } from './config/config.module';
import { APP_CONFIG, AppConfig } from './config/configuration';
import { dataSourceOptions } from './database/data-source';
import { DisbursementService } from './disbursement/disbursement.service';
import { PayoutWebhookController } from './disbursement/webhook.controller';
import { ENTITIES } from './entities';
import { CustomerAuthController, InstantLoanController } from './instant-loan/customer.controller';
import { InstantLoanService } from './instant-loan/instant-loan.service';
import { JourneyRecorder } from './instant-loan/journey.recorder';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsService } from './jobs.service';
import { PricingService } from './pricing/pricing.service';
import { StaffService } from './staff/staff.service';
import { SandboxController } from './integrations/sandbox/sandbox.controller';
import { LoansController } from './repayment/loans.controller';
import { NotifierService } from './repayment/notifier.service';
import { RepaymentService } from './repayment/repayment.service';

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({ ...dataSourceOptions(c.databaseUrl), migrationsRun: true }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.registerAsync({ global: true, inject: [APP_CONFIG], useFactory: (c: AppConfig) => ({ secret: c.jwtSecret }) }),
    ScheduleModule.forRoot(),
    AuditModule,
    IntegrationsModule,
  ],
  controllers: [CustomerAuthController, InstantLoanController, LoansController, StaffAuthController, AdminController, PayoutWebhookController, SandboxController],
  providers: [AuthService, StaffService, PricingService, InstantLoanService, JourneyRecorder, DisbursementService, MetricsService, JobsService, RepaymentService, NotifierService],
})
export class AppModule {}
