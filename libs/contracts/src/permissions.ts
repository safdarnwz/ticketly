/**
 * Permission catalogue (format `resource:action`).
 *
 * Declared centrally so the RBAC seed (Part 2), the `@RequirePermission()`
 * guard and the generated admin UI all reference the same strings — a typo
 * becomes a compile error, not a silent authorisation hole. Parts 3-10 append
 * their own permissions here as they add resources.
 */
export const Permission = {
  // platform
  ALL: '*',

  // tenancy & IAM (Part 2)
  TENANT_READ: 'tenant:read',
  TENANT_MANAGE: 'tenant:manage',
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',

  // master data (Part 3)
  ROUTE_READ: 'route:read',
  ROUTE_MANAGE: 'route:manage',
  STOP_MANAGE: 'stop:manage',
  LAYOUT_MANAGE: 'layout:manage',

  // fleet (Part 4)
  VEHICLE_READ: 'vehicle:read',
  VEHICLE_MANAGE: 'vehicle:manage',
  CREW_MANAGE: 'crew:manage',

  // B2B agent network (GDS distribution)
  AGENT_READ: 'agent:read',
  AGENT_MANAGE: 'agent:manage',
  /** Held ONLY by agent logins: the self-service agent portal (own account, own bookings). */
  AGENT_PORTAL: 'agent:portal',

  // scheduling & inventory (Part 5)
  SERVICE_READ: 'service:read',
  SERVICE_MANAGE: 'service:manage',
  TRIP_MANAGE: 'trip:manage',
  INVENTORY_MANAGE: 'inventory:manage',

  // pricing (Part 6)
  FARE_READ: 'fare:read',
  FARE_MANAGE: 'fare:manage',

  // booking (Part 7)
  BOOKING_READ: 'booking:read',
  BOOKING_CREATE: 'booking:create',
  BOOKING_CANCEL: 'booking:cancel',
  BOOKING_RESCHEDULE: 'booking:reschedule',

  // payments (Part 8)
  PAYMENT_READ: 'payment:read',
  PAYMENT_REFUND: 'payment:refund',
  SETTLEMENT_MANAGE: 'settlement:manage',

  // live ops (Part 9)
  TRACKING_READ: 'tracking:read',
  TRIP_OPERATE: 'trip:operate',

  // reporting (Part 10)
  REPORT_READ: 'report:read',
  REPORT_EXPORT: 'report:export',

  // platform-level (super/platform admin) — operator onboarding review
  PLATFORM_OPERATORS: 'platform:operators',
  PLATFORM_ADMIN: 'platform:admin',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];
