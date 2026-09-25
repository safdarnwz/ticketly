import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type TenantId, type UserId } from '@kernel';
import { FieldEncryptor } from '@security';

import { User, type UserKind, type UserProps, type UserStatus } from '../../domain/user.entity';

interface UserRow {
  id: UserId;
  tenant_id: TenantId | null;
  kind: UserKind;
  status: UserStatus;
  email: string | null;
  phone: string | null;
  full_name: string;
  password_hash: string | null;
  failed_logins: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  mfa_enabled: boolean;
  metadata: Record<string, unknown>;
  version: number;
  created_at: Date;
}

/**
 * User repository.
 *
 * PII columns (email, phone) are stored ENCRYPTED and are looked up through a
 * deterministic **blind index** rather than by matching the ciphertext (which
 * is non-deterministic and therefore unsearchable). So "find the user for this
 * phone" hashes the phone the same way it was hashed on write and matches on
 * `phone_blind`. The plaintext is decrypted only when a row is materialised
 * into the domain.
 */
@Injectable()
export class UserRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryptor: FieldEncryptor,
  ) {}

  private static readonly COLUMNS = `
    id, tenant_id, kind, status, email, phone, full_name, password_hash,
    failed_logins, locked_until, last_login_at, mfa_enabled, metadata, version, created_at`;

  async findById(id: UserId): Promise<User | null> {
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${UserRepository.COLUMNS} FROM users
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantScope(), id],
      { name: 'user.findById', primary: true },
    );
    return row ? this.toDomain(row) : null;
  }

  /** Staff users counting towards the plan quota: active, not deleted. */
  async countActiveStaff(): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM users
        WHERE tenant_id = $1 AND kind = 'staff' AND status = 'active' AND deleted_at IS NULL`,
      [requireTenantId()],
      { name: 'user.countActiveStaff', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findByBlind('email_blind', this.encryptor.blindIndex(email));
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.findByBlind('phone_blind', this.encryptor.blindIndex(phone));
  }

  /**
   * Global email/phone lookup that IGNORES tenant scope — this is how unified
   * login works without an operator slug in the URL: a login identifies the user
   * across all operators by their (globally unique) email or mobile.
   */
  async findByEmailGlobal(email: string): Promise<User | null> {
    return this.findByBlindGlobal('email_blind', this.encryptor.blindIndex(email));
  }
  async findByPhoneGlobal(phone: string): Promise<User | null> {
    return this.findByBlindGlobal('phone_blind', this.encryptor.blindIndex(phone));
  }
  /** When the password was last set — drives the password-expiry policy (#29). */
  async passwordChangedAt(userId: UserId, tenantId: TenantId | null): Promise<Date | null> {
    const row = await this.db.queryOne<{ password_changed_at: Date }>(
      `SELECT password_changed_at FROM users WHERE id = $1`,
      [userId],
      { name: 'user.passwordChangedAt', primary: true, tenantId },
    );
    return row?.password_changed_at ?? null;
  }

  private async findByBlindGlobal(column: string, blind: string | null): Promise<User | null> {
    if (!blind) return null;
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${UserRepository.COLUMNS} FROM users WHERE ${column} = $1 AND deleted_at IS NULL LIMIT 1`,
      [blind],
      { name: 'user.findByBlindGlobal', primary: true },
    );
    return row ? this.toDomain(row) : null;
  }

  /** Cross-tenant lookup used ONLY by platform admin (bypasses tenant scope). */
  async findByIdGlobal(id: UserId): Promise<User | null> {
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${UserRepository.COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
      { name: 'user.findByIdGlobal', primary: true },
    );
    return row ? this.toDomain(row) : null;
  }

  async insert(user: User): Promise<void> {
    const p = user.snapshot();
    await this.db.execute_(
      `INSERT INTO users
         (id, tenant_id, kind, status, email, email_blind, phone, phone_blind,
          full_name, password_hash, failed_logins, locked_until, last_login_at,
          mfa_enabled, metadata, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        user.id,
        p.tenantId,
        p.kind,
        p.status,
        this.encryptor.encrypt(p.email),
        this.encryptor.blindIndex(p.email),
        this.encryptor.encrypt(p.phone),
        this.encryptor.blindIndex(p.phone),
        p.fullName,
        p.passwordHash,
        p.failedLogins,
        p.lockedUntil,
        p.lastLoginAt,
        p.mfaEnabled,
        JSON.stringify(p.metadata),
        user.version,
        p.createdAt,
      ],
      { name: 'user.insert', primary: true },
    );
  }

  async update(user: User, expectedVersion: number): Promise<boolean> {
    const p = user.snapshot();
    const affected = await this.db.execute_(
      `UPDATE users SET
         status=$3, email=$4, email_blind=$5, phone=$6, phone_blind=$7, full_name=$8,
         password_hash=$9, failed_logins=$10, locked_until=$11, last_login_at=$12,
         mfa_enabled=$13, metadata=$14, version = version + 1, updated_at = now()
       WHERE tenant_id IS NOT DISTINCT FROM $1 AND id=$2 AND version=$15 AND deleted_at IS NULL`,
      [
        p.tenantId,
        user.id,
        p.status,
        this.encryptor.encrypt(p.email),
        this.encryptor.blindIndex(p.email),
        this.encryptor.encrypt(p.phone),
        this.encryptor.blindIndex(p.phone),
        p.fullName,
        p.passwordHash,
        p.failedLogins,
        p.lockedUntil,
        p.lastLoginAt,
        p.mfaEnabled,
        JSON.stringify(p.metadata),
        expectedVersion,
      ],
      { name: 'user.update', primary: true },
    );
    return affected > 0;
  }

  private async findByBlind(column: string, blind: string | null): Promise<User | null> {
    if (!blind) return null;
    const row = await this.db.queryOne<UserRow>(
      `SELECT ${UserRepository.COLUMNS} FROM users
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND ${column} = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [this.tenantScope(), blind],
      { name: 'user.findByBlind', primary: true },
    );
    return row ? this.toDomain(row) : null;
  }

  private tenantScope(): TenantId | null {
    // Platform-admin users have a null tenant; when acting inside a tenant we
    // scope to it. requireTenantId throws outside any context, which is correct
    // for a tenant-scoped path.
    try {
      return requireTenantId();
    } catch {
      return null;
    }
  }

  private toDomain(row: UserRow): User {
    const props: UserProps = {
      tenantId: row.tenant_id,
      kind: row.kind,
      status: row.status,
      email: this.encryptor.decrypt(row.email),
      phone: this.encryptor.decrypt(row.phone),
      fullName: row.full_name,
      passwordHash: row.password_hash,
      failedLogins: row.failed_logins,
      lockedUntil: row.locked_until,
      lastLoginAt: row.last_login_at,
      mfaEnabled: row.mfa_enabled,
      metadata: row.metadata as Record<string, never>,
      createdAt: row.created_at,
    };
    return User.rehydrate(row.id, props, row.version);
  }
}
