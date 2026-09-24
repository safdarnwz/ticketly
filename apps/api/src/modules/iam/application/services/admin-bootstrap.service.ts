import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';

import { AppConfig } from '@config';

import { UnitOfWork } from '@database';
import { createContext, newId, runWithContext, type UserId } from '@kernel';
import { Logger } from '@observability';
import { PasswordHasher } from '@security';

import { User } from '../../domain/user.entity';
import { UserRepository } from '../../infrastructure/persistence/user.repository';

/**
 * Seeds the platform SUPER ADMIN from the environment on startup.
 *
 * Email/phone are stored ENCRYPTED with a blind index, so a plain SQL seed can't
 * create a login-capable admin (it can't compute the blind index). This runs
 * inside the app — where the encryptor + password hasher live. Configure with:
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME (optional)
 *
 * Idempotent in TWO senses, not just one:
 *  - Won't create a second user for the same email on restart.
 *  - ALSO re-checks the `super_admin` role grant on EVERY boot, even for an
 *    already-existing user. Without this, booting once before running
 *    `db/seeds/roles.seed.sql` (so the `super_admin` role row didn't exist
 *    yet) would silently create the user with NO role — and every later
 *    restart would see "user already exists" and never go back to fix it,
 *    leaving a login that always 401s even with the right password.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly log: Logger;

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    logger: Logger,
    private readonly config: AppConfig,
  ) {
    this.log = logger.forContext('AdminBootstrap');
  }

  async onApplicationBootstrap(): Promise<void> {
    const {
      superAdminEmail: email,
      superAdminPassword: password,
      superAdminName,
    } = this.config.bootstrap;
    if (!email || !password) return;

    await runWithContext(createContext({ actorType: 'system' }), async () => {
      try {
        const existing = await this.users.findByEmailGlobal(email);
        let userId: UserId;

        if (existing) {
          userId = existing.id;
        } else {
          const hash = await this.hasher.hash(password);
          const admin = User.create(newId() as UserId, {
            tenantId: null,
            kind: 'staff',
            fullName: superAdminName,
            email,
            phone: null,
            passwordHash: hash,
            status: 'active',
          });
          await this.uow.run({ name: 'bootstrap.superAdmin' }, async () => {
            await this.users.insert(admin);
          });
          userId = admin.id;
          this.log.info({ email }, 'Super admin user created from environment');
        }

        await this.uow.run({ name: 'bootstrap.superAdminRole' }, async (scope) => {
          const role = await scope.client.query<{ id: string }>(
            `SELECT id FROM roles WHERE code = 'super_admin' AND tenant_id IS NULL AND deleted_at IS NULL LIMIT 1`,
          );
          if (!role.rows[0]) {
            this.log.error(
              { email },
              "Super admin user exists but the 'super_admin' role row is missing — " +
                'run db/seeds/roles.seed.sql, then restart. Login will 401 until then.',
            );
            return;
          }
          const grant = await scope.client.query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)
             ON CONFLICT DO NOTHING RETURNING user_id`,
            [userId, role.rows[0].id],
          );
          if (grant.rows[0]) this.log.info({ email }, 'Super admin role granted');
        });
      } catch (e) {
        this.log.error({ err: e }, 'Super admin bootstrap failed');
      }
    });
  }
}
