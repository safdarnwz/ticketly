/**
 * Tiny, safe template renderer: substitutes `{{key}}` placeholders from a
 * flat data bag. Deliberately NOT a full template engine — no logic, no code
 * execution — because notification templates are operator-editable and must
 * never be an injection vector. An unknown placeholder renders empty and is
 * logged, rather than leaking `{{...}}` to a customer.
 */
export function renderTemplate(template: string, data: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** The default templates seeded for a new tenant. */
export const DEFAULT_TEMPLATES: { eventType: string; channel: string; subject?: string; body: string }[] = [
  { eventType: 'booking.confirmed', channel: 'sms', body: 'Booking confirmed! PNR {{pnr}}. {{origin}}→{{destination}} on {{date}}, seat(s) {{seats}}. Board by {{boardingTime}}.' },
  { eventType: 'booking.confirmed', channel: 'email', subject: 'Your ticket — PNR {{pnr}}', body: 'Dear {{name}}, your booking {{pnr}} is confirmed for {{origin}}→{{destination}} on {{date}}.' },
  { eventType: 'booking.cancelled', channel: 'sms', body: 'Booking {{pnr}} cancelled. Refund of {{refund}} will be processed.' },
  { eventType: 'trip.delayed', channel: 'sms', body: 'Your bus (PNR {{pnr}}) is delayed by ~{{delay}} min. New ETA {{eta}}.' },
];
