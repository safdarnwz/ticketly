import { Injectable } from '@nestjs/common';

import { FieldEncryptor } from '@security';

import { IntegrationCredentialStore } from '../../../integrations';
import { UserRepository } from '../../infrastructure/persistence/user.repository';

const BATCH = 500;
/** One request rewrites at most this many users; call again until `remaining` is 0. */
const MAX_PER_RUN = 20_000;

/**
 * Encryption key rotation (#120). Rotating is: deploy with the new key as
 * ENCRYPTION_KEY (+ ENCRYPTION_KEY_ID) and the old one in
 * ENCRYPTION_PREVIOUS_KEYS — both still read — then run this until nothing
 * is left under the old key, then drop the old key from the config.
 */
@Injectable()
export class KeyRotationService {
  constructor(
    private readonly encryptor: FieldEncryptor,
    private readonly users: UserRepository,
    private readonly integrations: IntegrationCredentialStore,
  ) {}

  async status() {
    const [users, integrations] = await Promise.all([
      this.users.encryptionCensus(),
      this.integrations.encryptionCensus(),
    ]);
    const current = this.encryptor.currentKeyId;
    const stale = (c: Record<string, number>) =>
      Object.entries(c).reduce((n, [k, v]) => (k === current ? n : n + v), 0);
    return {
      enabled: this.encryptor.enabled,
      currentKeyId: current,
      users,
      integrations,
      remaining: current ? stale(users) + stale(integrations) : 0,
    };
  }

  async reencrypt() {
    if (!this.encryptor.enabled) return { rewritten: 0, ...(await this.status()) };
    let rewritten = await this.integrations.reencryptAll();
    for (let done = 0; done < MAX_PER_RUN;) {
      const n = await this.users.reencryptBatch(BATCH);
      rewritten += n;
      done += n;
      if (n < BATCH) break;
    }
    return { rewritten, ...(await this.status()) };
  }
}
