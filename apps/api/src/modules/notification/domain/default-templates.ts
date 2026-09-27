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
    eventType: 'trip.retimed',
    channel: 'sms',
    body: 'Schedule change for PNR {{pnr}}: your bus now departs at {{newTime}} (was {{oldTime}}). {{reason}}',
  },
  {
    eventType: 'trip.diverted',
    channel: 'sms',
    body: 'Route change for PNR {{pnr}}: your bus is taking a diversion. {{reason}} We will keep you updated.',
  },
  {
    eventType: 'trip.reminder.8h',
    channel: 'sms',
    body: 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Live tracking link with driver details comes 4 hours before boarding.',
  },
  {
    eventType: 'trip.reminder.8h',
    channel: 'whatsapp',
    body: 'Hi! Your trip *{{pnr}}* is today.\n\nBoarding: *{{fromStopName}}*, around {{boardingAt}}\nAlighting: *{{toStopName}}*, around {{droppingAt}}\nPassenger(s): {{passengerNames}}\n\nWe will send your pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.',
  },
  {
    eventType: 'trip.reminder.8h',
    channel: 'email',
    subject: 'Your journey today — PNR {{pnr}}',
    body: 'Your journey is today.\n\nPNR: {{pnr}}\nBoarding: {{fromStopName}} (around {{boardingAt}})\nAlighting: {{toStopName}} (around {{droppingAt}})\nPassenger(s): {{passengerNames}}\n\nWe will send your exact pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.',
  },
  {
    eventType: 'trip.reminder.4h',
    channel: 'sms',
    body: 'Boarding in 4h — PNR {{pnr}}, {{boardingAt}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track (live from {{trackingStartsAt}}): {{trackingUrl}}',
  },
  {
    eventType: 'trip.reminder.4h',
    channel: 'whatsapp',
    body: 'Your bus boards in 4 hours! *{{pnr}}*\n\n📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}\n{{pickup.landmark}}\n{{pickup.address}}\n\n🚌 Bus number: *{{busNumber}}*\n👨\u200d✈️ Driver(s): {{driversList}}\n🧑\u200d💼 Conductor / attendant(s): {{attendantsList}}\n\n📍 Track your bus: {{trackingUrl}}\n(The bus shows on the map from {{trackingStartsAt}}.)\n\nPlease reach 15 minutes early.',
  },
  {
    eventType: 'trip.reminder.4h',
    channel: 'email',
    subject: 'Boarding in 4 hours — PNR {{pnr}}',
    body: 'Your bus boards in 4 hours, at {{boardingAt}}.\n\nPickup point: {{pickup.stopName}}\nLandmark: {{pickup.landmark}}\nAddress: {{pickup.address}}\n\nBus number: {{busNumber}}\nYour crew:\n{{crewList}}\n\nTrack your bus: {{trackingUrl}}\nThe bus shows on the map from {{trackingStartsAt}}, one hour before departure.\n\nPlease reach your pickup point 15 minutes early.',
  },
  {
    eventType: 'trip.reminder.1h',
    channel: 'sms',
    body: 'Last reminder: PNR {{pnr}} boards at {{boardingAt}} from {{pickup.stopName}}. Bus {{busNumber}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track live now: {{trackingUrl}}',
  },
  {
    eventType: 'trip.reminder.1h',
    channel: 'whatsapp',
    body: 'Last reminder — your bus boards in 1 hour! *{{pnr}}*\n\n📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}\n{{pickup.landmark}}\n\n🚌 Bus number: *{{busNumber}}*\n👨\u200d✈️ Driver(s): {{driversList}}\n🧑\u200d💼 Conductor / attendant(s): {{attendantsList}}\n\n📍 Your bus is live now: {{trackingUrl}}\n\nPlease be at the pickup point 15 minutes early.',
  },
  {
    eventType: 'trip.reminder.1h',
    channel: 'email',
    subject: 'Last reminder: boarding in 1 hour — PNR {{pnr}}',
    body: 'Your bus boards in 1 hour, at {{boardingAt}}.\n\nPickup point: {{pickup.stopName}}\nLandmark: {{pickup.landmark}}\nAddress: {{pickup.address}}\n\nBus number: {{busNumber}}\nYour crew:\n{{crewList}}\n\nYour bus is live on the map now: {{trackingUrl}}\n\nPlease be at your pickup point 15 minutes early.',
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
