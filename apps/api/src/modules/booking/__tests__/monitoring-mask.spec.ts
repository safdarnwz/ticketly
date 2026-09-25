import { describe, expect, it } from 'vitest';

import { maskEmail, maskPhone } from '../infrastructure/persistence/booking-monitoring.repository';

describe('platform view masks customer contacts', () => {
  it('phone keeps two digits at each end', () => {
    expect(maskPhone('+91 98765 43210')).toBe('98******10');
    expect(maskPhone('123')).toBe('****');
    expect(maskPhone(null)).toBeNull();
  });
  it('email keeps two letters and the domain', () => {
    expect(maskEmail('asha.verma@example.in')).toBe('as***@example.in');
    expect(maskEmail('a@x.io')).toBe('a***@x.io');
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail(null)).toBeNull();
  });
});
