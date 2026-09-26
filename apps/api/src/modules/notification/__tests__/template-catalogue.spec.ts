import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATOR_TEMPLATES } from '../domain/default-templates';
import { TEMPLATE_CATALOGUE, templateProblem } from '../domain/template-catalogue';

describe('template catalogue', () => {
  it('accepts every default template as it ships', () => {
    for (const t of DEFAULT_OPERATOR_TEMPLATES) expect(templateProblem(t), t.eventType).toBeNull();
  });

  it('lists the reminder fields the screen offers', () => {
    expect(TEMPLATE_CATALOGUE['trip.reminder.4h'].placeholders).toContain('driver.phone');
    expect(TEMPLATE_CATALOGUE['booking.confirmed'].label).toBe('Booking confirmed');
  });

  it.each([
    [{ eventType: 'made.up', channel: 'sms', body: 'hi' }, 'eventType'],
    [{ eventType: 'booking.confirmed', channel: 'sms', body: 'PNR {{pnrr}}' }, 'body'],
    [{ eventType: 'booking.confirmed', channel: 'sms', body: 'PNR {{pnr' }, 'body'],
    [{ eventType: 'booking.confirmed', channel: 'email', body: 'PNR {{pnr}}' }, 'subject'],
    [
      {
        eventType: 'booking.confirmed',
        channel: 'email',
        subject: 'Ticket {{refundAmount}}',
        body: 'x',
      },
      'subject',
    ],
    [{ eventType: 'booking.confirmed', channel: 'sms', body: 'x'.repeat(481) }, 'body'],
  ])('refuses %j', (t, field) => expect(templateProblem(t)?.field).toBe(field));

  it('allows spaces inside braces and nested names', () => {
    expect(
      templateProblem({
        eventType: 'trip.reminder.4h',
        channel: 'sms',
        body: 'Driver {{ driver.name }} {{driver.phone}}',
      }),
    ).toBeNull();
  });
});
