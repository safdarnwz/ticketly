import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode } from '@kernel';

import { PlatformSettingsRepository } from '../infrastructure/platform-settings.repository';
import {
  agentCreditPolicyError,
  normaliseAgentCreditPolicy,
  type AgentCreditPolicy,
} from '../domain/agent-credit-policy';
import {
  dataRetentionErrors,
  normaliseDataRetention,
  type DataRetentionPolicy,
} from '../domain/data-retention';
import { DEFAULT_GST_SLABS, gstSlabErrors, type GstSlab } from '../domain/gst-slabs';
import { invalidAllowlistEntries } from '../domain/ip-allowlist';
import {
  normalisePasswordPolicy,
  passwordViolations,
  type PasswordPolicy,
} from '../domain/password-policy';
import {
  normaliseSuspiciousLoginPolicy,
  type SuspiciousLoginPolicy,
} from '../domain/suspicious-login';

export const POLICY_KEYS = {
  password: 'password_policy',
  adminIpAllowlist: 'admin_ip_allowlist',
  suspiciousLogin: 'suspicious_login_alerts',
  gstSlabs: 'gst_slabs',
  agentCredit: 'agent_credit_policy',
  dataRetention: 'data_retention',
} as const;

/**
 * Typed, validated access to the platform-wide policies stored in
 * `platform_settings`. Every setter validates before writing, so a bad value
 * is a 422 at save time — never a surprise at the next login or booking.
 * Reads go through the repository's cache.
 */
@Injectable()
export class PlatformPoliciesService {
  constructor(private readonly settings: PlatformSettingsRepository) {}

  /* ── password policy (#27–#29) ─────────────────────────────────────── */

  async passwordPolicy(): Promise<PasswordPolicy> {
    return normalisePasswordPolicy(
      await this.settings.get<Partial<PasswordPolicy> | null>(POLICY_KEYS.password, null),
    );
  }

  async setPasswordPolicy(policy: PasswordPolicy, actorId: string | null): Promise<PasswordPolicy> {
    await this.settings.set(POLICY_KEYS.password, policy, actorId);
    return policy;
  }

  /** Throws a 422 listing every rule the password breaks. */
  async assertPasswordAcceptable(password: string): Promise<void> {
    const violations = passwordViolations(await this.passwordPolicy(), password);
    if (violations.length > 0) {
      throw new AppError(ErrorCode.AUTH_PASSWORD_POLICY, 422, {
        message: `Password ${violations.join(', ')}`,
        details: { violations },
      });
    }
  }

  /* ── admin IP allowlist (#26) ──────────────────────────────────────── */

  async adminIpAllowlist(): Promise<string[]> {
    return this.settings.get<string[]>(POLICY_KEYS.adminIpAllowlist, []);
  }

  async setAdminIpAllowlist(entries: string[], actorId: string | null): Promise<string[]> {
    const invalid = invalidAllowlistEntries(entries);
    if (invalid.length > 0)
      throw validation(`Not a valid IP address or CIDR range: ${invalid.join(', ')}`);
    const cleaned = [...new Set(entries.map((e) => e.trim()))];
    await this.settings.set(POLICY_KEYS.adminIpAllowlist, cleaned, actorId);
    return cleaned;
  }

  /* ── suspicious login alerts (#54) ─────────────────────────────────── */

  async suspiciousLoginPolicy(): Promise<SuspiciousLoginPolicy> {
    return normaliseSuspiciousLoginPolicy(
      await this.settings.get<Partial<SuspiciousLoginPolicy> | null>(
        POLICY_KEYS.suspiciousLogin,
        null,
      ),
    );
  }

  async setSuspiciousLoginPolicy(
    policy: SuspiciousLoginPolicy,
    actorId: string | null,
  ): Promise<SuspiciousLoginPolicy> {
    if (policy.enabled && policy.alertEmails.length === 0)
      throw validation('Add at least one alert email before enabling suspicious-login alerts');
    await this.settings.set(POLICY_KEYS.suspiciousLogin, policy, actorId);
    return policy;
  }

  /* ── GST slabs (#33) ───────────────────────────────────────────────── */

  async gstSlabs(): Promise<GstSlab[]> {
    return this.settings.get<GstSlab[]>(POLICY_KEYS.gstSlabs, DEFAULT_GST_SLABS);
  }

  async setGstSlabs(slabs: GstSlab[], actorId: string | null): Promise<GstSlab[]> {
    const errors = gstSlabErrors(slabs);
    if (errors.length > 0) throw validation(errors.join('; '));
    await this.settings.set(POLICY_KEYS.gstSlabs, slabs, actorId);
    return slabs;
  }

  /* ── default agent credit policy (#44) ─────────────────────────────── */

  async agentCreditPolicy(): Promise<AgentCreditPolicy> {
    return normaliseAgentCreditPolicy(
      await this.settings.get<Partial<AgentCreditPolicy> | null>(POLICY_KEYS.agentCredit, null),
    );
  }

  async setAgentCreditPolicy(
    policy: AgentCreditPolicy,
    actorId: string | null,
  ): Promise<AgentCreditPolicy> {
    const error = agentCreditPolicyError(policy);
    if (error) throw validation(error);
    await this.settings.set(POLICY_KEYS.agentCredit, policy, actorId);
    return policy;
  }

  /* ── data retention (#75) ──────────────────────────────────────────── */

  async dataRetention(): Promise<DataRetentionPolicy> {
    return normaliseDataRetention(
      await this.settings.get<Partial<DataRetentionPolicy> | null>(POLICY_KEYS.dataRetention, null),
    );
  }

  async setDataRetention(
    patch: Partial<DataRetentionPolicy>,
    actorId: string | null,
  ): Promise<DataRetentionPolicy> {
    const errors = dataRetentionErrors(patch);
    if (errors.length > 0) throw validation(errors.join('; '));
    const next = { ...(await this.dataRetention()), ...patch };
    await this.settings.set(POLICY_KEYS.dataRetention, next, actorId);
    return next;
  }
}

function validation(message: string): AppError {
  return new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });
}
