import { describe, expect, it } from 'vitest';

import {
  describeIntegration,
  INTEGRATION_PROVIDERS,
  validateIntegrationUpdate,
} from '../domain/integration-catalog';

describe('integration catalogue — the admin form', () => {
  it('describes each field from the same schema that validates it', () => {
    const smtp = describeIntegration('smtp');
    expect(smtp.config).toEqual(
      expect.arrayContaining([
        { key: 'host', type: 'text', required: true, defaultValue: undefined },
        { key: 'port', type: 'number', required: true, defaultValue: undefined },
        { key: 'secure', type: 'boolean', required: true, defaultValue: undefined },
        { key: 'fromName', type: 'text', required: false, defaultValue: 'Ticketly' },
      ]),
    );
    expect(smtp.secrets).toEqual([
      { key: 'password', type: 'text', required: true, defaultValue: undefined },
    ]);
    expect(describeIntegration('payu').config).toContainEqual({
      key: 'environment',
      type: 'choice',
      required: true,
      defaultValue: undefined,
      options: ['test', 'live'],
    });
    expect(describeIntegration('msg91_sms').config).toContainEqual(
      expect.objectContaining({ key: 'dltTemplateId', required: false }),
    );
  });

  it('every provider has at least one secret field', () => {
    for (const p of INTEGRATION_PROVIDERS)
      expect(describeIntegration(p).secrets.length).toBeGreaterThan(0);
  });

  it('a stored secret is kept when the form leaves it empty', () => {
    const r = validateIntegrationUpdate(
      'msg91_sms',
      { config: { senderId: 'TCKTLY' }, secrets: { authKey: '' } },
      { authKey: 'stored-key-123' },
    );
    expect(r).toMatchObject({ ok: true, secrets: { authKey: 'stored-key-123' } });
    const missing = validateIntegrationUpdate('msg91_sms', { config: { senderId: 'x' } }, null);
    expect(missing.ok).toBe(false);
  });
});
