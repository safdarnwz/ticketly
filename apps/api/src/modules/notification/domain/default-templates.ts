/**
 * The notification templates every operator starts with. Without them an
 * operator's customers receive nothing at all: notify() looks a template up by
 * operator + event and silently skips the event when there is none. Seeded
 * once when the operator is created; the operator can edit them afterwards.
 * (db/seeds and older migrations carry their own copies for existing data.)
 */
export interface DefaultTemplate {
  eventType: string;
  channel: 'sms' | 'email' | 'whatsapp';
  subject?: string;
  body: string;
}

export const DEFAULT_OPERATOR_TEMPLATES: readonly DefaultTemplate[] = [
  {
    eventType: 'booking.confirmed',
    channel: 'sms',
    body: 'Booking confirmed! PNR {{pnr}}. Have a safe journey.',
  },
  {
    eventType: 'booking.confirmed',
    channel: 'email',
    subject: 'Your ticket — PNR {{pnr}}',
    body: 'Your booking is confirmed. PNR: {{pnr}}.',
  },
  {
    eventType: 'booking.cancelled',
    channel: 'sms',
    body: 'Booking {{pnr}} cancelled. Refund of {{refundAmount}} initiated.',
  },
  {
    eventType: 'booking.seats_cancelled',
    channel: 'sms',
    body: 'Seat(s) {{seats}} on booking {{pnr}} cancelled. Refund of {{refund}} initiated. Your other seats remain confirmed.',
  },
  {
    eventType: 'booking.cancelled',
    channel: 'email',
    subject: 'Booking cancelled — PNR {{pnr}}',
    body: 'Your booking {{pnr}} has been cancelled. Refund: {{refundAmount}}.',
  },
  {
    eventType: 'refund.settled',
    channel: 'sms',
    body: 'Refund of {{refundAmount}} for PNR {{pnr}} has been processed.',
  },
  {
    eventType: 'trip.delayed',
    channel: 'sms',
    body: 'Your trip (PNR {{pnr}}) is delayed. New departure: {{newTime}}.',
  },
  {
    eventType: 'trip.reminder.12h',
    channel: 'sms',
    body: 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Have a safe journey!',
  },
  {
    eventType: 'trip.reminder.12h',
    channel: 'whatsapp',
    body: 'Hi! Your trip *{{pnr}}* is coming up.\n\nBoarding: *{{fromStopName}}*, around {{boardingAt}}\nAlighting: *{{toStopName}}*, around {{droppingAt}}\nPassenger(s): {{passengerNames}}\n\nWe will send your exact pickup point and bus details 4 hours before boarding.',
  },
  {
    eventType: 'trip.reminder.12h',
    channel: 'email',
    subject: 'Your upcoming trip — PNR {{pnr}}',
    body: 'Your trip is coming up.\n\nPNR: {{pnr}}\nBoarding: {{fromStopName}} (around {{boardingAt}})\nAlighting: {{toStopName}} (around {{droppingAt}})\nPassenger(s): {{passengerNames}}\n\nWe will send your exact pickup point, driver and bus details 4 hours before boarding.',
  },
  {
    eventType: 'trip.reminder.4h',
    channel: 'sms',
    body: 'Boarding in 4h — PNR {{pnr}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Track live: {{trackingUrl}}',
  },
  {
    eventType: 'trip.reminder.4h',
    channel: 'whatsapp',
    body: 'Your bus boards in 4 hours! *{{pnr}}*\n\n📍 Pickup: *{{pickup.stopName}}*\n{{pickup.landmark}}\n{{pickup.address}}\n\n🚌 Bus number: *{{busNumber}}*\n👨\u200d✈️ Driver(s): {{driversList}}\n🧑\u200d💼 Attendant(s): {{attendantsList}}\n\n📍 Track live location: {{trackingUrl}}\n\nPlease reach 15 minutes early.',
  },
  {
    eventType: 'trip.reminder.4h',
    channel: 'email',
    subject: 'Boarding in 4 hours — PNR {{pnr}}',
    body: 'Your bus boards in 4 hours.\n\nPickup point: {{pickup.stopName}}\nLandmark: {{pickup.landmark}}\nAddress: {{pickup.address}}\n\nBus number: {{busNumber}}\nDriver(s): {{driversList}}\nAttendant(s): {{attendantsList}}\n\nTrack live location: {{trackingUrl}}\n\nPlease reach your pickup point 15 minutes early.',
  },
  {
    eventType: 'connection.at_risk',
    channel: 'sms',
    body: 'Your connecting bus (PNR {{pnr}}) is running {{delayMinutes}} min late. Only {{marginMinutes}} min margin left for your next bus. We are monitoring this for you.',
  },
  {
    eventType: 'connection.broken',
    channel: 'sms',
    body: 'Your connecting bus (PNR {{pnr}}) is delayed by {{delayMinutes}} min and may miss your next connection. Please contact support for help rebooking.',
  },
  {
    eventType: 'incident.critical',
    channel: 'sms',
    body: 'EMERGENCY ({{type}}) reported on trip {{tripId}} at {{time}}. Location: {{location}}. {{description}} — acknowledge in the Ticketly console now.',
  },
  {
    eventType: 'incident.critical',
    channel: 'email',
    subject: 'EMERGENCY: {{type}} reported — acknowledge now',
    body: 'An emergency ({{type}}) was reported at {{time}} on trip {{tripId}}.\nLocation: {{location}}\nDetails: {{description}}\n\nOpen the Ticketly console → Incidents to acknowledge it.',
  },
  {
    eventType: 'waitlist.seats_available',
    channel: 'sms',
    body: 'Good news! {{seatCount}} seat(s) just opened up on {{routeName}} ({{journeyDate}}). Book quickly — seats go to whoever books first: {{bookUrl}}',
  },
  {
    eventType: 'waitlist.seats_available',
    channel: 'email',
    subject: 'Seats available: {{routeName}} on {{journeyDate}}',
    body: 'Seats you were waiting for have opened up on {{routeName}} ({{journeyDate}}).\n\nThis is not a reservation — the seats go to whoever books first.\nBook now: {{bookUrl}}',
  },
];
