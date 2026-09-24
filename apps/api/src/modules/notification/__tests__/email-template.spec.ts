import { describe, it, expect } from 'vitest';

import {
  renderEmail,
  renderOtpEmail,
  renderBookingConfirmedEmail,
  renderOperatorStatusEmail,
  DEFAULT_EMAIL_PALETTE,
} from '../domain/email-template';

describe('email templates', () => {
  it('happy: OTP email shows the code and uses the theme primary color', () => {
    const html = renderOtpEmail({ code: '482913', name: 'Asha', purpose: 'register' });
    expect(html).toContain('482913');
    expect(html).toContain(DEFAULT_EMAIL_PALETTE.primary);
    expect(html).toContain('complete your registration');
    expect(html).toContain('<!doctype html>');
  });

  it('positive: a custom palette is applied', () => {
    const html = renderOtpEmail({
      code: '111',
      palette: { ...DEFAULT_EMAIL_PALETTE, primary: '#123456' },
    });
    expect(html).toContain('#123456');
  });

  it('positive: booking confirmation includes PNR, seats and total', () => {
    const html = renderBookingConfirmedEmail({
      pnr: 'YB12AB',
      route: 'Delhi → Jaipur',
      departAt: '10:00',
      seats: 'A1, A2',
      totalFormatted: '₹1,200.00',
    });
    expect(html).toContain('YB12AB');
    expect(html).toContain('A1, A2');
    expect(html).toContain('₹1,200.00');
  });

  it('positive: operator approved vs rejected render different CTAs', () => {
    const ok = renderOperatorStatusEmail({ name: 'Acme', status: 'approved' });
    const no = renderOperatorStatusEmail({
      name: 'Acme',
      status: 'rejected',
      reason: 'Incomplete GST',
    });
    expect(ok).toContain('approved');
    expect(ok).toContain('Go to console');
    expect(no).toContain('Incomplete GST');
    expect(no).not.toContain('Go to console');
  });

  it('edge: user-supplied content is HTML-escaped (no injection)', () => {
    const html = renderEmail({ title: 't', heading: '<script>x</script>', bodyHtml: '<p>ok</p>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });
});
