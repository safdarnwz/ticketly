import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '@database';
import { AppError, ErrorCode } from '@kernel';
import { Logger } from '@observability';
import { FieldEncryptor } from '@security';

import {
  INTEGRATIONS,
  INTEGRATION_PROVIDERS,
  maskSecret,
  validateIntegrationUpdate,
  type IntegrationConfig,
  type IntegrationProvider,
  type IntegrationSecrets,
  describeIntegration,
  type IntegrationField,
} from '../domain/integration-catalog';

export interface ActiveIntegration<P extends IntegrationProvider> {
  config: IntegrationConfig<P>;
  secrets: IntegrationSecrets<P>;
}

export interface IntegrationView {
  provider: IntegrationProvider;
  label: string;
  kind: string;
  runtime: string;
  /** The form: which settings the provider takes (config shown back, secrets write-only). */
  fields: { config: IntegrationField[]; secrets: IntegrationField[] };
  enabled: boolean;
  configured: boolean;
  config: Record<string, unknown>;
  /** Secret field → masked hint (never the value). */
  secrets: Record<string, string | null>;
  lastTest: { at: Date; ok: boolean; error: string | null } | null;
  updatedAt: Date | null;
}

interface Row {
  provider: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: string | null;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  updated_at: Date;
}

const REFRESH_MS = 30_000;

/**
 * Platform integration credentials (#11–#18), encrypted at rest.
 *
 * Adapters (SMS, WhatsApp, SMTP, Razorpay) call `active(provider)` on the hot
 * path, so it is SYNCHRONOUS and served from an in-memory snapshot. The
 * snapshot is reloaded on every write made through this process and every
 * 30 s otherwise, so a change made on one API instance reaches the others
 * (and the worker) within half a minute without a restart.
 *
 * A provider that is not enabled, or has no stored credentials, returns
 * null — callers then fall back to their environment-variable configuration,
 * so an install that never touches this screen behaves exactly as before.
 */
@Injectable()
export class IntegrationCredentialStore implements OnModuleInit, OnModuleDestroy {
  private readonly log: Logger;
  private snapshot = new Map<
    IntegrationProvider,
    { enabled: boolean; config: Record<string, unknown>; secrets: Record<string, unknown> | null }
  >();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly encryptor: FieldEncryptor,
    logger: Logger,
  ) {
    this.log = logger.forContext('IntegrationCredentials');
  }

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.timer = setInterval(() => void this.reload(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Enabled credentials for a provider, or null (→ use the env-var fallback). */
  active<P extends IntegrationProvider>(provider: P): ActiveIntegration<P> | null {
    const entry = this.snapshot.get(provider);
    if (!entry?.enabled || !entry.secrets) return null;
    return {
      config: entry.config as IntegrationConfig<P>,
      secrets: entry.secrets as IntegrationSecrets<P>,
    };
  }

  /** Saved credentials whether or not the provider is enabled (for a test send), or null. */
  async stored<P extends IntegrationProvider>(provider: P): Promise<ActiveIntegration<P> | null> {
    const row = (await this.rows()).find((r) => r.provider === provider);
    const secrets = row ? this.decrypt(row.secrets) : null;
    if (!row || !secrets) return null;
    return {
      config: row.config as IntegrationConfig<P>,
      secrets: secrets as IntegrationSecrets<P>,
    };
  }

  async list(): Promise<IntegrationView[]> {
    const rows = await this.rows();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return INTEGRATION_PROVIDERS.map((provider) =>
      this.view(provider, byProvider.get(provider) ?? null),
    );
  }

  async get(provider: IntegrationProvider): Promise<IntegrationView> {
    const row = (await this.rows()).find((r) => r.provider === provider) ?? null;
    return this.view(provider, row);
  }

  /** Save config + secrets. Omitted secrets keep their stored value. Does not change `enabled`. */
  async save(
    provider: IntegrationProvider,
    input: { config: unknown; secrets?: Record<string, unknown> },
    actorId: string | null,
  ): Promise<IntegrationView> {
    const existing = (await this.rows()).find((r) => r.provider === provider) ?? null;
    const result = validateIntegrationUpdate(
      provider,
      input,
      existing ? this.decrypt(existing.secrets) : null,
    );
    if (!result.ok)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: result.errors.join('; '),
        details: { errors: result.errors },
      });
    await this.db.execute_(
      `INSERT INTO integration_credentials (provider, config, secrets, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (provider) DO UPDATE
         SET config = EXCLUDED.config, secrets = EXCLUDED.secrets, updated_by = EXCLUDED.updated_by, updated_at = now(),
             last_test_at = NULL, last_test_ok = NULL, last_test_error = NULL`,
      [
        provider,
        JSON.stringify(result.config),
        this.encryptor.encrypt(JSON.stringify(result.secrets)),
        actorId,
      ],
      { name: 'integrations.save', primary: true },
    );
    await this.reload();
    return this.get(provider);
  }

  async setEnabled(
    provider: IntegrationProvider,
    enabled: boolean,
    actorId: string | null,
  ): Promise<IntegrationView> {
    if (enabled) {
      if (INTEGRATIONS[provider].runtime === 'none') {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `${INTEGRATIONS[provider].label} credentials can be stored, but the platform has no ${INTEGRATIONS[provider].label} adapter yet, so it cannot be enabled`,
        });
      }
      const row = (await this.rows()).find((r) => r.provider === provider);
      if (!row?.secrets)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Save ${INTEGRATIONS[provider].label} credentials before enabling it`,
        });
    }
    const affected = await this.db.execute_(
      `UPDATE integration_credentials SET enabled = $2, updated_by = $3, updated_at = now() WHERE provider = $1`,
      [provider, enabled, actorId],
      { name: 'integrations.setEnabled', primary: true },
    );
    if (affected === 0 && enabled)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Integration not configured',
      });
    await this.reload();
    return this.get(provider);
  }

  async recordTest(
    provider: IntegrationProvider,
    ok: boolean,
    error: string | null,
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE integration_credentials SET last_test_at = now(), last_test_ok = $2, last_test_error = $3 WHERE provider = $1`,
      [provider, ok, error?.slice(0, 500) ?? null],
      { name: 'integrations.recordTest', primary: true },
    );
  }

  /** Key rotation (#120): rewrite every stored secret still under a retired key. Returns the count. */
  async reencryptAll(): Promise<number> {
    let n = 0;
    for (const row of await this.rows()) {
      if (!this.encryptor.needsReencryption(row.secrets)) continue;
      const plain = this.encryptor.decrypt(row.secrets);
      await this.db.execute_(
        `UPDATE integration_credentials SET secrets = $2 WHERE provider = $1 AND secrets = $3`,
        [row.provider, this.encryptor.encrypt(plain), row.secrets],
        { name: 'integrations.reencrypt', primary: true },
      );
      n++;
    }
    if (n > 0) await this.reload();
    return n;
  }

  /** Stored secrets per key id. */
  async encryptionCensus(): Promise<Record<string, number>> {
    const census: Record<string, number> = {};
    for (const row of await this.rows()) {
      if (!row.secrets) continue;
      const key = this.encryptor.keyIdOf(row.secrets) ?? 'plaintext';
      census[key] = (census[key] ?? 0) + 1;
    }
    return census;
  }

  private async reload(): Promise<void> {
    try {
      const rows = await this.rows();
      const next = new Map<
        IntegrationProvider,
        {
          enabled: boolean;
          config: Record<string, unknown>;
          secrets: Record<string, unknown> | null;
        }
      >();
      for (const r of rows) {
        if (!(INTEGRATION_PROVIDERS as string[]).includes(r.provider)) continue;
        next.set(r.provider as IntegrationProvider, {
          enabled: r.enabled,
          config: r.config,
          secrets: this.decrypt(r.secrets),
        });
      }
      this.snapshot = next;
    } catch (err) {
      // Keep serving the last good snapshot (or the env fallback) — a DB blip
      // must not take SMS/email down with it.
      this.log.warn(
        { err },
        'could not refresh integration credentials; keeping previous snapshot',
      );
    }
  }

  private async rows(): Promise<Row[]> {
    return this.db.query<Row>(
      `SELECT provider, enabled, config, secrets, last_test_at, last_test_ok, last_test_error, updated_at FROM integration_credentials`,
      [],
      { name: 'integrations.rows', primary: true },
    );
  }

  private decrypt(stored: string | null): Record<string, unknown> | null {
    if (!stored) return null;
    try {
      return JSON.parse(this.encryptor.decrypt(stored) ?? 'null') as Record<string, unknown> | null;
    } catch (err) {
      this.log.error(
        { err },
        'integration secrets could not be decrypted (ENCRYPTION_KEY changed?)',
      );
      return null;
    }
  }

  private view(provider: IntegrationProvider, row: Row | null): IntegrationView {
    const def = INTEGRATIONS[provider];
    const secrets = row ? this.decrypt(row.secrets) : null;
    const secretFields = Object.keys(def.secrets.shape);
    return {
      provider,
      label: def.label,
      kind: def.kind,
      runtime: def.runtime,
      fields: describeIntegration(provider),
      enabled: row?.enabled ?? false,
      configured: Boolean(row?.secrets),
      config: row?.config ?? {},
      secrets: Object.fromEntries(
        secretFields.map((f) => {
          const v = secrets?.[f];
          return [f, typeof v === 'string' && v.length > 0 ? maskSecret(v) : null];
        }),
      ),
      lastTest: row?.last_test_at
        ? { at: row.last_test_at, ok: Boolean(row.last_test_ok), error: row.last_test_error }
        : null,
      updatedAt: row?.updated_at ?? null,
    };
  }
}
