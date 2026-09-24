import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppError, ErrorCode } from '@kernel';

import { hashesEqual, hashKey, ipAllowed, parseKey } from '../domain/gds-keys';
import { GdsRepository } from '../infrastructure/gds.repository';

/**
 * Authenticates a GDS partner by its `X-GDS-Key` header (a separate header
 * from operator API keys, so the two can never be confused). Checks: format,
 * known prefix, constant-time hash match, not revoked/expired, caller IP in
 * the key's allow-list, partner not suspended. Attaches the partner context.
 */
@Injectable()
export class GdsPartnerGuard implements CanActivate {
  constructor(private readonly gds: GdsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { gds?: unknown }>();
    const raw = req.headers['x-gds-key'];
    const deny = (message: string, status = 401): never => { throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, status, { message }); };
    const parsed = parseKey(Array.isArray(raw) ? raw[0] : raw);
    if (!parsed) deny('Missing or malformed X-GDS-Key');
    const key = await this.gds.keyByPrefix(parsed!.prefix);
    if (!key || !hashesEqual(hashKey(String(Array.isArray(raw) ? raw[0] : raw).trim()), key.hash)) deny('Invalid API key');
    if (key!.revokedAt) deny('This API key has been revoked');
    if (key!.expiresAt && key!.expiresAt < new Date()) deny('This API key has expired');
    if (!ipAllowed(req.ip, key!.ipAllowlist)) deny('Requests from this IP address are not allowed for this key', 403);
    const partner = await this.gds.getPartner(key!.partnerId);
    if (!partner || partner.status === 'suspended') deny('Partner account is suspended', 403);
    void this.gds.touchKey(key!.id).catch(() => undefined);
    req.gds = { partner, keyId: key!.id, sandbox: key!.sandbox };
    return true;
  }
}
