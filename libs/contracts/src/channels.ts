/**
 * Sales / distribution channels a booking can originate from.
 *
 * Per the product scope, AGENT, COUNTER and PARCEL are intentionally excluded.
 * The enum is kept as the single source of truth so pricing, reporting and
 * commission logic all agree on the channel vocabulary.
 */
export const BookingChannel = {
  /** Operator's own website / mobile app (B2C direct). */
  DIRECT_WEB: 'direct_web',
  DIRECT_APP: 'direct_app',
  /** Third-party online travel aggregators consuming the distribution API. */
  OTA: 'ota',
  /** Operator back-office console (manual booking by staff). */
  BACKOFFICE: 'backoffice',
} as const;

export type BookingChannelValue = (typeof BookingChannel)[keyof typeof BookingChannel];

export const CHANNEL_LABELS: Record<BookingChannelValue, string> = {
  direct_web: 'Website',
  direct_app: 'Mobile App',
  ota: 'OTA Partner',
  backoffice: 'Back Office',
};

/**
 * The channel families an operator can close per trip ("stop OTA sales, keep
 * the website selling"). Every booking channel maps to exactly one family.
 */
export const SALES_CHANNEL_FAMILIES = ['direct_web', 'agent', 'ota', 'phone'] as const;
export type SalesChannelFamily = (typeof SALES_CHANNEL_FAMILIES)[number];
