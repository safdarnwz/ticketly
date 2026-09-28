import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, type SeatLayoutId, type VehicleId } from '@kernel';

import { DEFAULT_REFUND_POLICY, type RefundPolicy } from '../../../booking';
import { FleetService, VehicleVerificationService } from '../../../fleet';
import { AmenityRepository, SeatLayoutRepository, StateNormService } from '../../../master-data';
import { ReviewService } from '../../../reviews';
import { BusDetailsRepository, type StopRow } from '../../infrastructure/bus-details.repository';

/** Amenity codes that also count as safety equipment. */
const SAFETY_AMENITY: Record<string, string> = {
  cctv: 'CCTV cameras inside the bus',
  fire_extinguisher: 'Fire extinguisher on board',
  first_aid: 'First-aid kit on board',
  emergency_hammer: 'Emergency hammers at the windows',
  speed_governor: 'Speed governor fitted',
};

const LIKED_LABEL: Record<string, string> = {
  cleanliness: 'Cleanliness',
  punctuality: 'Punctuality',
  comfort: 'Seat / sleep comfort',
  staff: 'Staff behaviour',
  ac: 'AC',
  driving: 'Driving',
  tracking: 'Live tracking',
  rest_stops: 'Rest-stop hygiene',
};

type Travel = {
  pets: 'not_allowed' | 'small_in_carrier' | 'allowed';
  liquor: 'prohibited' | 'sealed_in_luggage';
  smoking: 'prohibited' | 'at_stops_only';
  pickupWaitMinutes: number;
  notes: string[];
};
type Luggage = {
  freeKg: number;
  freePieces: number;
  extraPerKgMinor: number | null;
  note?: string;
};

/**
 * Everything a passenger reads before choosing a seat — the tabs under the
 * seat map, as redBus shows them: highlights, cancellation policy (with the
 * real dates for this trip), the route, boarding and dropping points, the
 * bus's features, its reviews, safety, the bus itself and the operator's
 * other policies.
 *
 * It is about THIS trip's bus: on one route an operator runs different
 * buses, each with its own layout, fares, crew and reviews. A review stays
 * with the bus that ran the trip, whatever bus runs the service later.
 */
@Injectable()
export class BusDetailsService {
  constructor(
    private readonly repo: BusDetailsRepository,
    private readonly amenities: AmenityRepository,
    private readonly layouts: SeatLayoutRepository,
    private readonly reviews: ReviewService,
    private readonly fleet: FleetService,
    private readonly vehicles: VehicleVerificationService,
    private readonly stateNorms: StateNormService,
  ) {}

  async forTrip(tripId: string, fromStopId?: string, toStopId?: string) {
    const trip = await this.repo.trip(tripId);
    if (!trip) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
    const [stops, policies, layout, drivers, bus, stateRules] = await Promise.all([
      this.repo.stops(tripId),
      this.repo.policies(),
      this.layouts.getById(trip.seatLayoutId as SeatLayoutId),
      this.repo.driverCount(tripId),
      trip.vehicleId ? this.repo.bus(trip.vehicleId) : Promise.resolve(null),
      this.stateNorms.forRoute(trip.routeId),
    ]);
    if (stops.length < 2)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
    const from = stops.find((s) => s.stopId === fromStopId) ?? stops[0];
    const to = stops.find((s) => s.stopId === toStopId) ?? stops[stops.length - 1];
    if (from.sequence >= to.sequence)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'The boarding point must come before the dropping point',
      });

    const [amenities, reviews, photos, roadLegal] = await Promise.all([
      bus ? this.amenities.forVehicleIds([bus.id]).then((m) => m.get(bus.id) ?? []) : [],
      bus ? this.reviews.busReviews(bus.id, 5) : null,
      bus ? this.vehicles.listMedia(bus.id as VehicleId).catch(() => []) : [],
      bus
        ? this.fleet.isRoadLegalOn(
            bus.id as VehicleId,
            trip.departsAt.toISOString().slice(0, 10) as never,
          )
        : false,
    ]);

    const map = layout.seatMap.toJSON();
    const fixtures = map.fixtures ?? [];
    const seatTypes = [...new Set(map.seats.filter((s) => s.type !== 'crew').map((s) => s.type))];
    const ladiesSeats = map.seats.filter((s) => s.ladiesOnly).length;
    const accessibleSeats = map.seats.filter((s) => s.accessible).length;
    const hasWashroom = fixtures.some((f) => f.kind === 'washroom');
    const hasExit = fixtures.some((f) => f.kind === 'emergency_exit');
    const codes = new Set(amenities.map((a) => a.code));
    const busName = bus
      ? [bus.make, bus.model].filter(Boolean).join(' ') || bus.typeName || 'Bus'
      : null;
    const travel = policies.travel as Travel | null;
    const luggage = policies.luggage as Luggage | null;

    return {
      tripId,
      operatorName: policies.operatorName,
      bus: bus && {
        id: bus.id,
        name: busName,
        type: bus.typeName,
        ac: bus.isAc,
        year: bus.manufactureYear,
        seatTypes,
        decks: map.decks,
        seats: map.seats.filter((s) => s.type !== 'crew' && s.bookable !== false).length,
        photos: photos
          .filter((p) => p.kind === 'photo' && p.url)
          .map((p) => ({ url: p.url as string, caption: p.caption ?? null })),
      },
      highlights: [
        busName && {
          key: 'bus',
          title: busName,
          detail: [bus?.typeName, bus?.isAc ? 'AC' : 'Non-AC'].filter(Boolean).join(' · '),
        },
        reviews?.count
          ? {
              key: 'rating',
              title: `${reviews.average} ★`,
              detail: `${reviews.count} rating${reviews.count === 1 ? '' : 's'} for this bus`,
            }
          : null,
        drivers > 1
          ? { key: 'drivers', title: `${drivers} drivers`, detail: 'They take turns on this run' }
          : null,
        hasWashroom
          ? { key: 'washroom', title: 'Washroom on board', detail: 'Marked on the seat map' }
          : null,
        { key: 'tracking', title: 'Live tracking', detail: 'Link sent 4 hours before departure' },
      ].filter(Boolean),
      cancellation: this.cancellation(policies.refundPolicy as RefundPolicy | null, trip.departsAt),
      route: {
        stops: stops.map((s) => ({
          name: s.name,
          city: s.city,
          at: s.departsAt.toISOString(),
          boardHere: s.sequence === from.sequence,
          dropHere: s.sequence === to.sequence,
        })),
        distanceKm: Math.round((to.distanceM - from.distanceM) / 1000),
        durationMin: Math.round((to.arrivesAt.getTime() - from.departsAt.getTime()) / 60_000),
      },
      boardingPoints: stops.filter((s) => s.canBoard && s.sequence < to.sequence).map(point),
      droppingPoints: stops.filter((s) => s.canAlight && s.sequence > from.sequence).map(point),
      amenities: amenities.map((a) => ({ code: a.code, name: a.name, icon: a.icon })),
      reviews: reviews && {
        average: reviews.average,
        count: reviews.count,
        distribution: reviews.distribution,
        liked: reviews.liked.map((l) => ({ ...l, label: LIKED_LABEL[l.aspect] ?? l.aspect })),
        items: reviews.items,
      },
      safety: [
        {
          key: 'tracking',
          label: 'Live GPS tracking',
          ok: true,
          detail: bus?.hasGpsDevice
            ? 'GPS device fitted, plus the crew phone'
            : 'From the crew phone, from 1 hour before departure',
        },
        {
          key: 'verified',
          label: 'Bus verified by the platform',
          ok: Boolean(bus?.verified),
          detail: 'Registration and permit checked',
        },
        {
          key: 'papers',
          label: 'Permit, insurance, fitness and PUC valid on the day',
          ok: roadLegal,
          detail: 'Checked for this date',
        },
        {
          key: 'drivers',
          label: drivers > 1 ? `${drivers} drivers take turns` : 'Driver assigned',
          ok: drivers > 0,
          detail:
            drivers > 0
              ? 'Rested within the operator’s driving-hour rules'
              : 'Assigned before the 4-hour reminder',
        },
        {
          key: 'exit',
          label: 'Emergency exit',
          ok: hasExit,
          detail: hasExit ? 'Shown on the seat map' : 'Not marked on the seat map',
        },
        {
          key: 'ladies',
          label: 'Seats kept for women',
          ok: ladiesSeats > 0,
          detail:
            ladiesSeats > 0
              ? `${ladiesSeats} ladies seat${ladiesSeats === 1 ? '' : 's'}`
              : 'None marked',
        },
        {
          key: 'accessible',
          label: 'Seat for a passenger with a disability',
          ok: accessibleSeats > 0,
          detail: accessibleSeats > 0 ? 'Near the door' : 'None marked',
        },
        ...Object.entries(SAFETY_AMENITY).map(([code, label]) => ({
          key: code,
          label,
          ok: codes.has(code),
          detail: codes.has(code) ? 'On this bus' : 'Not listed',
        })),
      ],
      // Government rules of every state on the route, set by the platform —
      // they apply whatever the operator's own policies below say.
      stateRules: stateRules.filter((s) => s.norms.length > 0),
      policies: [
        {
          key: 'child',
          title: 'Child passenger policy',
          text:
            policies.infantMaxAge != null
              ? `Children above the age of ${policies.infantMaxAge} need a ticket.`
              : 'Every passenger needs a ticket.',
        },
        luggage
          ? {
              key: 'luggage',
              title: 'Luggage policy',
              text: `${luggage.freePieces} piece${luggage.freePieces === 1 ? '' : 's'} up to ${luggage.freeKg} kg free per passenger.${luggage.extraPerKgMinor ? ` Extra ₹${(luggage.extraPerKgMinor / 100).toFixed(0)} per kg.` : ' Extra luggage can be added at booking.'}${luggage.note ? ` ${luggage.note}` : ''}`,
            }
          : { key: 'luggage', title: 'Luggage policy', text: 'Ask the operator about luggage.' },
        travel && {
          key: 'pets',
          title: 'Pets policy',
          text:
            travel.pets === 'allowed'
              ? 'Pets are allowed.'
              : travel.pets === 'small_in_carrier'
                ? 'Small pets are allowed in a closed carrier.'
                : 'Pets are not allowed.',
        },
        travel && {
          key: 'liquor',
          title: 'Liquor policy',
          text:
            travel.liquor === 'sealed_in_luggage'
              ? 'Sealed bottles only, in the luggage. Drinking on the bus is not allowed; drunk passengers may be refused boarding.'
              : 'Carrying or drinking liquor on the bus is prohibited. Drunk passengers may be refused boarding.',
        },
        travel && {
          key: 'smoking',
          title: 'Smoking policy',
          text:
            travel.smoking === 'at_stops_only'
              ? 'No smoking on the bus — only outside at stops.'
              : 'Smoking is prohibited on the bus and at boarding points.',
        },
        travel && {
          key: 'pickup',
          title: 'Pick-up time policy',
          text:
            travel.pickupWaitMinutes > 0
              ? `The bus waits up to ${travel.pickupWaitMinutes} minutes at a boarding point. No refund for a passenger who arrives later.`
              : 'The bus leaves each boarding point on time. No refund for a passenger who arrives late.',
        },
        ...(travel?.notes ?? []).map((n, i) => ({
          key: `note${i}`,
          title: 'Operator note',
          text: n,
        })),
      ].filter(Boolean),
    };
  }

  /** The refund tiers with this trip's real dates: "from 27 Sep 3:55 pm until 28 Sep 3:55 am: 75%". */
  private cancellation(stored: RefundPolicy | null, departsAt: Date) {
    const policy = stored?.tiers?.length ? stored : DEFAULT_REFUND_POLICY;
    const tiers = [...policy.tiers].sort(
      (a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture,
    );
    const at = (h: number) => new Date(departsAt.getTime() - h * 3_600_000).toISOString();
    const rows: { from: string | null; until: string; refundPct: number }[] = [];
    tiers.forEach((t, i) => {
      rows.push({
        from: i === 0 ? null : at(tiers[i - 1].minHoursBeforeDeparture),
        until: at(t.minHoursBeforeDeparture),
        refundPct: t.refundPct,
      });
    });
    // After the last tier (e.g. inside 2 hours) nothing comes back.
    const last = tiers[tiers.length - 1];
    if (!last || last.minHoursBeforeDeparture > 0)
      rows.push({
        from: at(last ? last.minHoursBeforeDeparture : 0),
        until: departsAt.toISOString(),
        refundPct: 0,
      });
    return {
      rows,
      flatFeeMinor: policy.flatFeeMinor ?? 0,
      cutoffHours: policy.cutoffHours ?? 0,
      freeCancellationHours: policy.freeCancellationHours ?? 0,
      partialCancellation: policy.partialCancellation !== false,
    };
  }
}

function point(s: StopRow) {
  return {
    stopId: s.stopId,
    name: s.name,
    city: s.city,
    landmark: s.landmark,
    address: s.address,
    at: s.departsAt.toISOString(),
  };
}
