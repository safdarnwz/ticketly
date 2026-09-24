import { describe, expect, it } from 'vitest';

import { testConfig } from '@config';
import type { TenantId, UserId } from '@kernel';

import { TokenService } from '../token-service';

describe('TokenService', () => {
  const tokens = new TokenService(testConfig());

  it('signs and verifies an access token', () => {
    const { token } = tokens.signAccess({ sub: 'u1' as UserId, tid: 't1' as TenantId, sid: 's1', jti: 'j1' });
    expect(tokens.verifyAccess(token).sub).toBe('u1');
  });

  it('rejects a tampered payload', () => {
    const { token } = tokens.signAccess({ sub: 'u1' as UserId, tid: null, sid: 's1', jti: 'j1' });
    const parts = token.split('.');
    const forged = `${parts[0]}.${Buffer.from('{"sub":"attacker"}').toString('base64url')}.${parts[2]}`;
    expect(() => tokens.verifyAccess(forged)).toThrow();
  });

  it('rejects the alg:none confusion attack', () => {
    const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
    const body = Buffer.from('{"sub":"x","typ":"access","exp":9999999999}').toString('base64url');
    expect(() => tokens.verifyAccess(`${header}.${body}.`)).toThrow();
  });

  it('rejects an expired token', () => {
    const shortLived = new TokenService(testConfig({ JWT_ACCESS_TTL_SECONDS: -10 } as never));
    const { token } = shortLived.signAccess({ sub: 'u1' as UserId, tid: null, sid: 's1', jti: 'j1' });
    expect(() => shortLived.verifyAccess(token)).toThrow(/expired/i);
  });

  it('verifies tokens signed with the previous secret during rotation', () => {
    const oldSvc = new TokenService(testConfig({ JWT_SECRET: 'old-secret-old-secret-old-secret-32b' } as never));
    const { token } = oldSvc.signAccess({ sub: 'u1' as UserId, tid: null, sid: 's1', jti: 'j1' });
    const rotated = new TokenService(
      testConfig({
        JWT_SECRET: 'new-secret-new-secret-new-secret-32b',
        JWT_SECRET_PREVIOUS: 'old-secret-old-secret-old-secret-32b',
      } as never),
    );
    expect(rotated.verifyAccess(token).sub).toBe('u1');
  });
});
