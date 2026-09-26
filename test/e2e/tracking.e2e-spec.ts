import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createContext, runAsTenant, runWithContext, type TenantId } from '@kernel';

import { TrackingService } from '@api/modules/tracking/application/services/tracking.service';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * Live tracking: a crew/device GPS ping updates the trip's live row; the
 * passenger's signed tracking link (no login, no operator) shows it with their
 * own boarding and dropping stops.
 */
describe('live tracking (e2e)', () => {
  let app: TestApp;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const { bookingId, pnr } = await confirmedBooking(app, app.fixtures.seatNumbers[0], {
      fullName: 'Tracking Traveller',
    });
    token = runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, () =>
        app.nest
          .get(TrackingService)
          .issueTrackingToken(
            bookingId,
            app.fixtures.tripId,
            pnr,
            new Date(Date.now() + 86_400_000),
          ),
      ),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('a ping becomes the live position, visible through the passenger link', async () => {
    const ping = await app.post(
      '/tracking/ping',
      {
        tripId: app.fixtures.tripId,
        lat: 28.6667,
        lng: 77.2167,
        speedKmph: 55,
        distanceCoveredM: 1200,
      },
      { as: 'operator' },
    );
    expect(ping.status, JSON.stringify(ping.body)).toBeLessThan(300);
    expect(ping.body.nextStopId).toBeDefined();

    const live = await app.get(`/tracking/trips/${app.fixtures.tripId}/live`, { as: 'anonymous' });
    expect(live.status).toBe(200);
    expect(JSON.stringify(live.body)).toContain('55');

    const byLink = await app.get(`/tracking/token/${token}`, { as: 'anonymous' });
    expect(byLink.status, JSON.stringify(byLink.body)).toBe(200);
    expect(byLink.body.status).toBe('running');
    expect(byLink.body.fromStopName).not.toBe('Boarding point');
    expect(byLink.body.recentPings.length).toBeGreaterThan(0);
  });

  it('the fleet view lists only buses on the road, for staff only', async () => {
    const r = await app.get('/tracking/fleet', { as: 'operator' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(r.body.items.every((x: { tripId: string }) => typeof x.tripId === 'string')).toBe(true);
    expect((await app.get('/tracking/fleet', { as: 'anonymous' })).status).toBe(401);
    expect((await app.get('/tracking/fleet', { as: 'customer' })).status).toBe(403);
  });
});
