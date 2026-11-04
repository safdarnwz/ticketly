import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { FIVE_PERSON_TEAM } from './common/roles';
import { PolicyStatus, PricingPolicy } from './pricing/pricing-policy.entity';
import { StaffUser } from './staff/staff-user.entity';
import { StaffService } from './staff/staff.service';

/**
 * Dev/sandbox seed: the suggested 5-person team and one ACTIVE pricing policy.
 * The pricing numbers are placeholders for testing only. The real numbers must come from the
 * board-approved interest-rate policy.
 */
async function seed() {
  process.env.DISABLE_JOBS = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ds = app.get<DataSource>(getDataSourceToken());
  const staff = app.get(StaffService);
  if (!(await ds.getRepository(StaffUser).count())) {
    console.log('\nStaff accounts (save the TOTP secrets in an authenticator app):');
    for (const [i, m] of FIVE_PERSON_TEAM.entries()) {
      const r = await staff.create({ email: `staff${i + 1}@example.com`, name: m.title, title: m.title, password: 'ChangeMe-123456', roles: m.roles }, null);
      console.log(`  ${r.email.padEnd(22)} ${m.title.padEnd(30)} roles=${m.roles.join(',')}  totp=${r.totpSecret}`);
    }
  }
  const policies = ds.getRepository(PricingPolicy);
  if (!(await policies.count({ where: { status: PolicyStatus.ACTIVE } }))) {
    const founder = await ds.getRepository(StaffUser).findOneByOrFail({ email: 'staff1@example.com' });
    const compliance = await ds.getRepository(StaffUser).findOneByOrFail({ email: 'staff2@example.com' });
    await policies.save(
      policies.create({
        name: 'SANDBOX placeholder – 18% p.a., 1% fee, 30 days',
        annualInterestBps: 1800, processingFeeBps: 100, gstOnFeeBps: 1800, tenureDays: 30,
        minPrincipalPaise: 10_000_00, maxPrincipalPaise: 30_000_00, aprCapBps: 3600, coolingOffDays: 3,
        penalChargesText: 'Penal charge of 2% per month on the overdue amount only, after the due date. No compounding, no capitalisation.',
        status: PolicyStatus.ACTIVE, createdBy: founder.id, activatedBy: compliance.id, boardApprovalRef: 'SANDBOX-NOT-BOARD-APPROVED', activatedAt: new Date(),
      }),
    );
    console.log('\nActive pricing policy created (sandbox placeholder).');
  }
  await app.close();
}
seed();
