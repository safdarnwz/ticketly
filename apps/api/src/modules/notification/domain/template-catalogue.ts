import { DEFAULT_OPERATOR_TEMPLATES } from './default-templates';

/**
 * What an operator can write templates for, and which `{{placeholders}}` each
 * event fills in. An unknown placeholder renders as empty text — so a typo
 * (`{{pnrr}}`) used to go out to passengers as a blank; saving one is now
 * refused. One list, served to the settings screen, instead of a copy there.
 */
const LABELS: Record<string, string> = {
  'booking.confirmed': 'Booking confirmed',
  'booking.cancelled': 'Booking cancelled (full)',
  'booking.seats_cancelled': 'Booking cancelled (some seats)',
  'refund.settled': 'Refund completed',
  'trip.delayed': 'Trip delayed',
  'trip.retimed': 'Departure time changed',
  'trip.diverted': 'Route diverted',
  'trip.reminder.8h': 'Journey reminder — 8 hours before',
  'trip.reminder.4h': 'Journey reminder — 4 hours before (crew + tracking link)',
  'trip.reminder.1h': 'Last reminder — 1 hour before (crew + live tracking)',
  'connection.at_risk': 'Connecting journey at risk',
  'connection.broken': 'Connecting journey missed',
  'incident.critical': 'Critical incident (staff alert)',
  'waitlist.seats_available': 'Waitlist — seats available',
};

/** What the 4h and 1h reminders carry: pickup, bus, every driver and crew member, tracking. */
const BOARDING_FIELDS = [
  'fromStopName',
  'toStopName',
  'boardingAt',
  'passengerNames',
  'busNumber',
  'pickup.stopName',
  'pickup.landmark',
  'pickup.address',
  'driver.name',
  'driver.phone',
  'driversList',
  'attendant.name',
  'attendant.phone',
  'attendantsList',
  'crewList',
  'trackingUrl',
  'trackingStartsAt',
];

/** Fields the events carry beyond what the default wording happens to use. */
const EXTRA: Record<string, string[]> = {
  'booking.confirmed': ['seats'],
  'trip.reminder.8h': ['fromStopName', 'toStopName', 'boardingAt', 'droppingAt', 'passengerNames'],
  'trip.reminder.4h': BOARDING_FIELDS,
  'trip.reminder.1h': BOARDING_FIELDS,
  'trip.delayed': ['delayMinutes'],
  'connection.at_risk': ['delayMinutes', 'marginMinutes'],
  'connection.broken': ['delayMinutes', 'marginMinutes'],
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

export const TEMPLATE_CATALOGUE: Record<string, { label: string; placeholders: string[] }> =
  (() => {
    const out: Record<string, { label: string; placeholders: Set<string> }> = {};
    const add = (event: string, keys: string[]) => {
      out[event] ??= { label: LABELS[event] ?? event, placeholders: new Set(['pnr']) };
      for (const k of keys) out[event].placeholders.add(k);
    };
    for (const t of DEFAULT_OPERATOR_TEMPLATES)
      add(t.eventType, [...placeholdersIn(t.body), ...placeholdersIn(t.subject ?? '')]);
    for (const [e, keys] of Object.entries(EXTRA)) add(e, keys);
    for (const e of Object.keys(LABELS)) add(e, []);
    return Object.fromEntries(
      Object.entries(out).map(([e, v]) => [
        e,
        { label: v.label, placeholders: [...v.placeholders].sort() },
      ]),
    );
  })();

/** SMS longer than three parts is cut or refused by carriers. */
export const SMS_MAX_CHARS = 480;

/** Why this template cannot be saved, or null. */
export function templateProblem(t: {
  eventType: string;
  channel: string;
  subject?: string;
  body: string;
}): { field: 'eventType' | 'subject' | 'body'; message: string } | null {
  const entry = TEMPLATE_CATALOGUE[t.eventType];
  if (!entry) return { field: 'eventType', message: 'Not an event you can write a message for' };
  if (t.channel === 'email' && !t.subject?.trim())
    return { field: 'subject', message: 'An email needs a subject' };
  if (t.channel === 'sms' && t.body.length > SMS_MAX_CHARS)
    return { field: 'body', message: `An SMS is at most ${SMS_MAX_CHARS} characters (3 parts)` };
  for (const [field, text] of [
    ['subject', t.subject ?? ''],
    ['body', t.body],
  ] as const) {
    if ((text.match(/\{\{/g)?.length ?? 0) !== (text.match(/\}\}/g)?.length ?? 0))
      return { field, message: 'A placeholder is not closed — write {{name}}' };
    const unknown = placeholdersIn(text).find((p) => !entry.placeholders.includes(p));
    if (unknown)
      return {
        field,
        message: `{{${unknown}}} is not filled in for this event — use ${entry.placeholders.map((p) => `{{${p}}}`).join(', ')}`,
      };
  }
  return null;
}
