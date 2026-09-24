/**
 * Canonical registry of every event type the platform emits.
 *
 * Declaring them in one place gives us:
 *  - a compile-time check that a subscriber listens to a type that exists
 *    (a typo in a string listener is otherwise silent and undetectable);
 *  - the list published to OTA partners as the webhook catalogue (Part 10);
 *  - a single place to see the blast radius before renaming anything.
 *
 * Types are filled in as each part lands; the ones below are the contracts the
 * later parts commit to.
 */
export const EventType = {
  // Part 2 — tenancy & identity
  TENANT_PROVISIONED: 'tenant.provisioned',
  TENANT_SUSPENDED: 'tenant.suspended',
  USER_INVITED: 'user.invited',
  USER_LOGGED_IN: 'user.logged_in',

  // Part 3/4 — master data & fleet
  ROUTE_PUBLISHED: 'route.published',
  VEHICLE_DOCUMENT_EXPIRING: 'vehicle.document_expiring',

  // Part 5 — scheduling & inventory
  SERVICE_PUBLISHED: 'service.published',
  TRIP_MATERIALISED: 'trip.materialised',
  TRIP_CANCELLED: 'trip.cancelled',
  TRIP_DEPARTED: 'trip.departed',
  INVENTORY_BLOCKED: 'inventory.blocked',

  // Part 6 — pricing
  FARE_PLAN_ACTIVATED: 'fare_plan.activated',
  PRICE_ADJUSTED: 'pricing.adjusted',

  // Part 7 — booking
  SEATS_HELD: 'booking.seats_held',
  HOLD_EXPIRED: 'booking.hold_expired',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_RESCHEDULED: 'booking.rescheduled',
  TICKET_ISSUED: 'ticket.issued',
  PASSENGER_BOARDED: 'passenger.boarded',

  // Part 8 — payments
  PAYMENT_AUTHORISED: 'payment.authorised',
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_INITIATED: 'refund.initiated',
  REFUND_SETTLED: 'refund.settled',
  SETTLEMENT_GENERATED: 'settlement.generated',

  // Part 9 — live ops
  TRIP_LOCATION_UPDATED: 'trip.location_updated',
  TRIP_DELAYED: 'trip.delayed',
  NOTIFICATION_DISPATCHED: 'notification.dispatched',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];
