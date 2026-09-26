import { Permission, type PermissionValue } from '@contracts';

/**
 * What each permission an operator can put into a role means, grouped the way
 * the role editor shows them. Platform permissions are not listed — they are
 * never part of an operator role.
 */
export const PERMISSION_CATALOGUE: readonly {
  group: string;
  items: readonly { code: PermissionValue; label: string }[];
}[] = [
  {
    group: 'Company & staff',
    items: [
      { code: Permission.TENANT_READ, label: 'See company profile and settings' },
      { code: Permission.TENANT_MANAGE, label: 'Change company profile, bank details, policies' },
      { code: Permission.USER_READ, label: 'See staff' },
      { code: Permission.USER_MANAGE, label: 'Invite, disable and manage staff' },
      { code: Permission.ROLE_MANAGE, label: 'Create roles and give them to staff' },
    ],
  },
  {
    group: 'Routes & fleet',
    items: [
      { code: Permission.ROUTE_READ, label: 'See routes' },
      { code: Permission.ROUTE_MANAGE, label: 'Create and change routes' },
      { code: Permission.STOP_MANAGE, label: 'Manage stops and boarding points' },
      { code: Permission.LAYOUT_MANAGE, label: 'Manage seat layouts' },
      { code: Permission.VEHICLE_READ, label: 'See buses' },
      { code: Permission.VEHICLE_MANAGE, label: 'Add and change buses' },
      { code: Permission.CREW_MANAGE, label: 'Manage drivers and conductors' },
    ],
  },
  {
    group: 'Schedules & fares',
    items: [
      { code: Permission.SERVICE_READ, label: 'See services and trips' },
      { code: Permission.SERVICE_MANAGE, label: 'Create and change services' },
      { code: Permission.TRIP_MANAGE, label: 'Cancel, delay and change trips' },
      { code: Permission.INVENTORY_MANAGE, label: 'Block seats and set quotas' },
      { code: Permission.FARE_READ, label: 'See fares' },
      { code: Permission.FARE_MANAGE, label: 'Change fares, coupons and offers' },
    ],
  },
  {
    group: 'Bookings & money',
    items: [
      { code: Permission.BOOKING_READ, label: 'See bookings' },
      { code: Permission.BOOKING_CREATE, label: 'Sell tickets at the counter' },
      { code: Permission.BOOKING_CANCEL, label: 'Cancel bookings' },
      { code: Permission.BOOKING_RESCHEDULE, label: 'Reschedule bookings' },
      { code: Permission.PAYMENT_READ, label: 'See payments' },
      { code: Permission.PAYMENT_REFUND, label: 'Approve and pay refunds' },
      { code: Permission.SETTLEMENT_MANAGE, label: 'Settlements and payouts' },
    ],
  },
  {
    group: 'Agents',
    items: [
      { code: Permission.AGENT_READ, label: 'See travel agents' },
      { code: Permission.AGENT_MANAGE, label: 'Add agents, credit and commission' },
      { code: Permission.AGENT_PORTAL, label: 'Agent portal (for agent logins only)' },
    ],
  },
  {
    group: 'Operations & reports',
    items: [
      { code: Permission.TRACKING_READ, label: 'See live bus tracking' },
      { code: Permission.TRIP_OPERATE, label: 'Run trips: boarding, departure, incidents' },
      { code: Permission.REPORT_READ, label: 'See reports' },
      { code: Permission.REPORT_EXPORT, label: 'Download reports' },
    ],
  },
];
