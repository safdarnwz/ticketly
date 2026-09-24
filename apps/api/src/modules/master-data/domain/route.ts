/** A route is drafted, published (schedulable and sellable), then archived. */
export const ROUTE_STATUSES = ['draft', 'published', 'archived'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];
