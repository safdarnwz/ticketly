import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * PIN code → city / state, IFSC → bank: public lookups for the address and
 * bank forms, and the same directories refuse a PIN or IFSC that does not exist.
 */
describe('PIN code and IFSC lookups (e2e)', () => {
  let app: TestApp;
  const anon = { as: 'anonymous' as const };
  const op = { as: 'operator' as const };

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a PIN gives its city, state and localities, and the platform city when it has one', async () => {
    const r = await app.get('/master-data/lookups/pincode/302001', anon);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ pincode: '302001', city: 'Jaipur', state: 'Rajasthan' });
    expect(r.body.localities.length).toBeGreaterThan(0);
    expect(r.body.cityId).toBeTruthy(); // Jaipur is a city here

    expect((await app.get('/master-data/lookups/pincode/999999', anon)).status).toBe(404);
    expect((await app.get('/master-data/lookups/pincode/012345', anon)).status).toBe(400);
    expect((await app.get('/master-data/lookups/pincode/30200', anon)).status).toBe(400);
  });

  it('an IFSC gives its bank; an unknown branch is not found, a bad shape refused', async () => {
    const r = await app.get('/master-data/lookups/ifsc/hdfc0000123', anon);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      ifsc: 'HDFC0000123',
      bankCode: 'HDFC',
      bank: expect.stringMatching(/HDFC/i),
    });

    expect((await app.get('/master-data/lookups/ifsc/XXXX0000001', anon)).status).toBe(404);
    expect((await app.get('/master-data/lookups/ifsc/HDFC123', anon)).status).toBe(400);
  });

  it('forms refuse an IFSC or PIN that does not exist', async () => {
    const bank = (ifsc: string) =>
      app.patch(
        '/operator/bank-details',
        { accountHolder: 'Demo Travels Pvt Ltd', accountNumber: '50100012345678', ifsc },
        op,
      );
    // A real-looking shape, but no such branch.
    expect((await bank('XXXX0000001')).status).toBe(400);
    expect((await bank('HDFC0ZZZZZZ')).status).toBe(400);

    const city = (await app.get('/master-data/lookups/pincode/302001', anon)).body.cityId as string;
    const stop = (pincode: string) =>
      app.post(
        '/master-data/stops',
        { cityId: city, name: `PIN check ${pincode} ${Date.now()}`, kind: 'both', pincode },
        op,
      );
    expect((await stop('999999')).status).toBe(400);
    const okStop = await stop('302001');
    expect(okStop.status, JSON.stringify(okStop.body)).toBe(201);
  });
});
