import { Injectable } from '@nestjs/common';

import { todayIn, type LocalDate, type VehicleId } from '@kernel';

import {
  evaluateFleetCompliance,
  isRoadLegalOn,
  isPermittedForIndividualSale,
  type FleetComplianceResult,
} from '../../domain/document-expiry';
import { VehicleRepository } from '../../infrastructure/persistence/vehicle.repository';

/**
 * Fleet service — vehicle CRUD, document upsert, and the compliance queries
 * that scheduling depends on.
 *
 * `assertRoadLegalOn` is the guard Part 5 calls before assigning a vehicle to a
 * trip: it refuses a bus whose permit/insurance/fitness/PUC will have lapsed by
 * the journey date, so an uninsured bus can never be scheduled.
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly vehicles: VehicleRepository,
  ) {}

  async compliance(vehicleId: VehicleId, today?: LocalDate): Promise<FleetComplianceResult> {
    await this.vehicles.getById(vehicleId); // 404 if not this tenant's
    const documents = await this.vehicles.loadDocuments(vehicleId);
    return evaluateFleetCompliance(documents, today ?? todayIn());
  }

  /** True when the vehicle is legally operable on the given journey date. */
  async isRoadLegalOn(vehicleId: VehicleId, journeyDate: LocalDate): Promise<boolean> {
    const documents = await this.vehicles.loadDocuments(vehicleId);
    return isRoadLegalOn(documents, journeyDate);
  }

  /** See isPermittedForIndividualSale's own doc comment — a contract-carriage vehicle is never eligible here, regardless of document expiry. */
  async isPermittedForIndividualSale(vehicleId: VehicleId): Promise<boolean> {
    const permitType = await this.vehicles.getPermitType(vehicleId);
    return isPermittedForIndividualSale(permitType);
  }
}
