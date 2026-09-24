import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import type { TenantId, UserId } from '@kernel';
import { Logger } from '@observability';

import {
  shouldAlertOnFailures,
  shouldAlertOnNewIp,
  PlatformPoliciesService,
} from '../../../platform-settings';
import { Mailer } from '../../../notification';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';
import { AuditService } from './audit.service';

/**
 * Suspicious-login alerts (#54). Called by AuthService around each password
 * sign-in. Everything here is best-effort: an alert that cannot be sent is
 * logged, and never turns a login into an error.
 */
@Injectable()
export class SecurityAlertService {
  private readonly log: Logger;

  constructor(
    private readonly policies: PlatformPoliciesService,
    private readonly audit: AuditService,
    private readonly sessions: SessionRepository,
    private readonly db: DatabaseService,
    private readonly mailer: Mailer,
    logger: Logger,
  ) {
    this.log = logger.forContext('SecurityAlerts');
  }

  /** Record a failed password attempt and alert when the account crosses the threshold. */
  async onLoginFailed(
    user: { id: UserId; tenantId: TenantId | null; email: string | null },
    ip: string | undefined,
  ): Promise<void> {
    try {
      await this.audit.record({
        action: 'user.login_failed',
        resourceType: 'user',
        resourceId: user.id,
        tenantId: user.tenantId,
        actorId: user.id,
        actorType: 'user',
      });
      const policy = await this.policies.suspiciousLoginPolicy();
      if (!policy.enabled) return;
      const row = await this.db.queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM audit_log
          WHERE action = 'user.login_failed' AND resource_id = $1
            AND occurred_at > now() - make_interval(mins => $2)`,
        [user.id, policy.windowMinutes],
        { name: 'securityAlert.failureCount', primary: true },
      );
      const failures = Number(row?.n ?? 0);
      if (shouldAlertOnFailures(policy, failures)) {
        await this.raise(
          'repeated_failures',
          user,
          ip,
          policy.alertEmails,
          `${failures} failed sign-in attempts in ${policy.windowMinutes} minutes`,
        );
      }
    } catch (err) {
      this.log.error({ err, userId: user.id }, 'failed-login alert check failed');
    }
  }

  /** Alert when a platform admin signs in from an IP not seen in their recent sessions. Call BEFORE the new session is created. */
  async onPlatformAdminLogin(
    user: { id: UserId; tenantId: TenantId | null; email: string | null },
    ip: string | undefined,
  ): Promise<void> {
    try {
      const policy = await this.policies.suspiciousLoginPolicy();
      if (!policy.enabled || !policy.alertOnNewAdminIp) return;
      const recent = await this.sessions.recentIps(user.id, user.tenantId);
      if (shouldAlertOnNewIp(policy, ip, recent)) {
        await this.raise(
          'new_admin_ip',
          user,
          ip,
          policy.alertEmails,
          `Platform admin signed in from a new IP address (${ip})`,
        );
      }
    } catch (err) {
      this.log.error({ err, userId: user.id }, 'new-IP alert check failed');
    }
  }

  private async raise(
    kind: 'repeated_failures' | 'new_admin_ip',
    user: { id: UserId; tenantId: TenantId | null; email: string | null },
    ip: string | undefined,
    recipients: string[],
    summary: string,
  ): Promise<void> {
    await this.audit.record({
      action: 'security.suspicious_login',
      resourceType: 'user',
      resourceId: user.id,
      tenantId: user.tenantId,
      actorType: 'system',
      changes: { kind, ip: ip ?? null, summary },
    });
    const subject = `[Ticketly security] ${summary}`;
    const html = `<p>${escapeHtml(summary)}.</p>
      <p>Account: ${escapeHtml(user.email ?? user.id)}<br/>IP: ${escapeHtml(ip ?? 'unknown')}<br/>Time: ${new Date().toISOString()}</p>
      <p>If this was not expected, lock the account and review the audit log.</p>`;
    for (const to of recipients) {
      await this.mailer
        .send({
          to,
          subject,
          html,
          text: `${summary}. Account: ${user.email ?? user.id}. IP: ${ip ?? 'unknown'}.`,
        })
        .catch((err: unknown) => this.log.error({ err, to }, 'security alert email failed'));
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
