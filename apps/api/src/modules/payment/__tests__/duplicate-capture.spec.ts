import { describe, expect, it } from 'vitest';

import { classifyCapture } from '../domain/duplicate-capture';

describe('classifyCapture (1004 — customer charged twice)', () => {
  it('first capture is recorded', () => {
    expect(classifyCapture({ status: 'created', gatewayPaymentId: null }, 'pay_A')).toBe('record');
    expect(classifyCapture({ status: 'authorized', gatewayPaymentId: null }, 'pay_A')).toBe(
      'record',
    );
  });
  it('the SAME payment again (redelivery / callback + webhook) is not money to return', () => {
    expect(classifyCapture({ status: 'captured', gatewayPaymentId: 'pay_A' }, 'pay_A')).toBe(
      'already_recorded',
    );
  });
  it('a DIFFERENT payment on an already-paid intent is a duplicate to refund', () => {
    expect(classifyCapture({ status: 'captured', gatewayPaymentId: 'pay_A' }, 'pay_B')).toBe(
      'duplicate',
    );
  });
  it('legacy rows without a stored payment id are treated as already recorded (never refund blindly)', () => {
    expect(classifyCapture({ status: 'captured', gatewayPaymentId: null }, 'pay_B')).toBe(
      'already_recorded',
    );
  });
  it('unknown intent → no decision', () => {
    expect(classifyCapture(null, 'pay_A')).toBeNull();
  });
});
