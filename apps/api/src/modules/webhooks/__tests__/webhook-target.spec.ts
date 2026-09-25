import { describe, expect, it } from 'vitest';

import { isPrivateAddress, webhookUrlProblem } from '../domain/webhook-target';

describe('webhook targets', () => {
  it.each([
    'https://partner.example.com/hooks',
    'https://api.redbus.in:8443/ticketly?x=1',
    'https://8.8.8.8/hook',
    'https://[2606:4700:4700::1111]/hook',
  ])('allows the public %s', (url) => expect(webhookUrlProblem(url)).toBeNull());

  it.each([
    ['http://partner.example.com/hooks', 'https'],
    ['not a url', 'full URL'],
    ['https://user:pw@partner.example.com/', 'credentials'],
    ['https://localhost/hook', 'public host'],
    ['https://app.localhost/hook', 'public host'],
    ['https://printer.local/hook', 'public host'],
    ['https://metadata.google.internal/', 'public host'],
    ['https://intranet/hook', 'public host'],
    ['https://127.0.0.1/hook', 'not reachable'],
    ['https://169.254.169.254/latest/meta-data', 'not reachable'],
    ['https://10.1.2.3/hook', 'not reachable'],
    ['https://172.20.0.5/hook', 'not reachable'],
    ['https://192.168.1.10/hook', 'not reachable'],
    ['https://[::1]/hook', 'not reachable'],
    ['https://[fd00::1]/hook', 'not reachable'],
    ['https://[::ffff:127.0.0.1]/hook', 'not reachable'],
    ['https://0.0.0.0/hook', 'not reachable'],
  ])('refuses %s', (url, why) => expect(webhookUrlProblem(url)).toContain(why));

  it('treats resolved addresses the same way', () => {
    expect(isPrivateAddress('10.0.0.8')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });
});
