import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { FIVE_PERSON_TEAM } from './common/roles';
import { PricingPlan } from './pricing/pricing-plan.entity';
import { StaffUser } from './staff/staff-user.entity';
import { StaffService } from './staff/staff.service';

/**
 * Dev/sandbox seed: the suggested 5-person team and one default pricing plan.
 * The pricing numbers are placeholders; the owner sets real ones in the Owner panel.
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
  const plans = ds.getRepository(PricingPlan);
  if (!(await plans.count())) {
    const owner = await ds.getRepository(StaffUser).findOneByOrFail({ email: 'staff1@example.com' });
    await plans.save(
      plans.create({
        name: 'Default plan for all customers (SANDBOX placeholder)',
        scope: 'ALL', interestUnit: 'PER_ANNUM', interestRatePercent: 18, feeType: 'PERCENT', feeValue: 1, gstPercent: 18, tenureDays: 30,
        minPrincipalPaise: 10_000_00, maxPrincipalPaise: 30_000_00, penalType: 'PERCENT_PER_DAY', penalValue: 0.1, coolingOffDays: 3,
        aprCapPercent: null, createdBy: owner.id,
      }),
    );
    console.log('\nDefault pricing plan created. The owner (staff1) can change it any time from the Owner panel.');
  }
  await app.close();
}
seed();
