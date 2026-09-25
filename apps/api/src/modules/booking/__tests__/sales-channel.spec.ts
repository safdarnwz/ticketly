import { describe, expect, it } from 'vitest';

import { createContext, runWithContext, type ActorType } from '@kernel';

import { allowedSalesChannel } from '../application/services/sales-channel';

const as =
  (actorType: ActorType, permissions: string[] = []) =>
  (fn: () => unknown) =>
    runWithContext(createContext({ actorType, permissions }), fn);

describe('allowedSalesChannel — a hold cannot claim a channel it is not', () => {
  it('lets anyone book on the website and app', () => {
    expect(as('anonymous')(() => allowedSalesChannel(undefined))).toBeUndefined();
    expect(as('anonymous')(() => allowedSalesChannel('direct_web'))).toBe('direct_web');
    expect(as('user')(() => allowedSalesChannel('direct_app'))).toBe('direct_app');
  });

  it('keeps back-office for staff who may create bookings', () => {
    expect(() => as('anonymous')(() => allowedSalesChannel('backoffice'))).toThrow(/staff/);
    expect(() => as('user', ['booking:read'])(() => allowedSalesChannel('backoffice'))).toThrow(
      /staff/,
    );
    expect(as('user', ['booking:create'])(() => allowedSalesChannel('backoffice'))).toBe(
      'backoffice',
    );
    expect(as('user', ['*'])(() => allowedSalesChannel('backoffice'))).toBe('backoffice');
  });

  it('keeps OTA for signed-in partners — a customer cannot dodge a website sales stop', () => {
    expect(() => as('anonymous')(() => allowedSalesChannel('ota'))).toThrow(/partner/);
    expect(() => as('user', ['*'])(() => allowedSalesChannel('ota'))).toThrow(/partner/);
    expect(as('api_key')(() => allowedSalesChannel('ota'))).toBe('ota');
    expect(as('channel_partner')(() => allowedSalesChannel('ota'))).toBe('ota');
  });

  it('refuses an unknown channel', () => {
    expect(() => as('user', ['*'])(() => allowedSalesChannel('agent'))).toThrow(/Unknown/);
  });
});
