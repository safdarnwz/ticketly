import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, getUserId, requireTenantId, type TripId } from '@kernel';

import { reconcileChart } from '../../domain/chart-reconciliation';
import { DepartureControlRepository } from '../../infrastructure/persistence/departure-control.repository';

export interface ChartRequest {
  spotSalesCount?: number;
  spotSalesCashMinor?: number;
  expectedSpotFareMinor?: number;
}

/**
 * Departure control — charting a trip at departure.
 *
 * Reads the live seat position (confirmed / boarded from tickets), reconciles it
 * with the conductor's declared spot sales and cash via the pure engine, and
 * writes an immutable chart record so the trip can be closed out with a clear
 * seat and cash picture. Charting twice is refused (one chart per trip) so the
 * closeout figure can't be overwritten.
 */
@Injectable()
export class DepartureControlService {
  constructor(
    private readonly repo: DepartureControlRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async chart(
    tripId: TripId,
    req: ChartRequest = {},
  ): Promise<{
    chartId: string;
    reconciled: boolean;
    cashVarianceMinor: number;
    noShowSeats: number;
    vacantSeats: number;
  }> {
    return this.uow.run({ name: 'dcs.chart', tenantId: requireTenantId() }, async () => {
      const counts = await this.repo.tripCounts(tripId);
      if (!counts)
        throw new AppError(ErrorCode.DCS_TRIP_NOT_FOUND, 404, { message: 'Trip not found' });

      const result = reconcileChart({
        totalSeats: counts.totalSeats,
        confirmedSeats: counts.confirmedSeats,
        boardedSeats: counts.boardedSeats,
        spotSalesCount: req.spotSalesCount ?? 0,
        spotSalesCashMinor: req.spotSalesCashMinor ?? 0,
        expectedSpotFareMinor: req.expectedSpotFareMinor ?? 0,
      });

      const chartId = await this.repo.insertChart({
        tripId,
        totalSeats: counts.totalSeats,
        confirmedSeats: counts.confirmedSeats,
        boardedSeats: counts.boardedSeats,
        noShowSeats: result.noShowSeats,
        vacantSeats: result.vacantSeats,
        spotSalesCount: req.spotSalesCount ?? 0,
        cashDeclaredMinor: result.cashDeclaredMinor,
        cashExpectedMinor: result.cashExpectedMinor,
        cashVarianceMinor: result.cashVarianceMinor,
        reconciled: result.reconciled,
        chartedBy: getUserId() ?? null,
      });

      return {
        chartId,
        reconciled: result.reconciled,
        cashVarianceMinor: result.cashVarianceMinor,
        noShowSeats: result.noShowSeats,
        vacantSeats: result.vacantSeats,
      };
    });
  }

  async getChart(tripId: TripId): Promise<unknown> {
    const chart = await this.repo.findChart(tripId);
    if (!chart)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Trip has not been charted yet',
      });
    return chart;
  }
}
