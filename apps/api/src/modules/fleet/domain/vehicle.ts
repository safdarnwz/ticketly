/** A bus's operational state (separate from its platform verification). */
export const VEHICLE_STATUSES = ['active', 'maintenance', 'retired'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const FUEL_TYPES = ['diesel', 'cng', 'electric', 'petrol', 'hybrid', 'lng'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const PERMIT_TYPES = [
  'aitp',
  'stage_carriage',
  'state_tourist_permit',
  'contract_carriage',
] as const;
export type PermitType = (typeof PERMIT_TYPES)[number];

export const MAINTENANCE_KINDS = ['service', 'repair', 'inspection'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];
