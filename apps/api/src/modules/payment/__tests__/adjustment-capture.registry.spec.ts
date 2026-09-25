import { describe, expect, it } from 'vitest';

import {
  AdjustmentCaptureRegistry,
  type AdjustmentCaptureHandler,
} from '../application/services/adjustment-capture.registry';

const handler = (kind: string): AdjustmentCaptureHandler => ({
  kind,
  apply: () => Promise.resolve({ fareMinor: 0 }),
});

describe('AdjustmentCaptureRegistry', () => {
  it('finds the handler for an intent by its metadata kind', () => {
    const r = new AdjustmentCaptureRegistry();
    const reschedule = handler('reschedule');
    r.register(reschedule);
    expect(r.forIntent({ metadata: { kind: 'reschedule' } })).toBe(reschedule);
  });

  it('has none for a plain booking payment or an unknown kind', () => {
    const r = new AdjustmentCaptureRegistry();
    r.register(handler('seat_upgrade'));
    expect(r.forIntent({ metadata: {} })).toBeNull();
    expect(r.forIntent({})).toBeNull();
    expect(r.forIntent({ metadata: { kind: 'other' } })).toBeNull();
  });

  it('refuses two handlers for one kind', () => {
    const r = new AdjustmentCaptureRegistry();
    r.register(handler('reschedule'));
    expect(() => r.register(handler('reschedule'))).toThrow(/already registered/);
  });
});
