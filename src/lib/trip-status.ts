/** Operator-facing words for a trip's status ('closed' before departure = sales stopped). */
export const TRIP_STATUS_LABEL: Record<string, string> = {
  scheduled: 'not on sale',
  open: 'on sale',
  closed: 'sales stopped',
  departed: 'departed',
  cancelled: 'cancelled',
};
