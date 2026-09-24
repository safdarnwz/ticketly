/**
 * ============================================================================
 *  Geo — distance, ETA and geofence math
 * ============================================================================
 *
 * Live tracking needs three pure computations, all done here so they are
 * exact, testable and free of I/O:
 *
 *  - **distance** between two lat/lng points (Haversine — great-circle distance
 *    on a sphere; accurate to ~0.5% which is far better than GPS itself);
 *  - **ETA** to the next stop given current position, speed and remaining road
 *    distance;
 *  - **geofence** — has the bus arrived within a radius of a boarding point?
 *    This drives "your bus is arriving" alerts and auto stop-arrival marking.
 *
 * Coordinates are decimal degrees. Distances are metres. Everything is a pure
 * function of its inputs.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in metres (Haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` is within `radiusM` of `center`. */
export function isWithin(point: GeoPoint, center: GeoPoint, radiusM: number): boolean {
  return haversineMeters(point, center) <= radiusM;
}

/**
 * ETA in seconds to cover `remainingRoadDistanceM` at `speedKmph`.
 * Falls back to a floor speed so a stopped bus doesn't yield an infinite ETA.
 */
export function etaSeconds(
  remainingRoadDistanceM: number,
  speedKmph: number,
  floorKmph = 15,
): number {
  if (remainingRoadDistanceM <= 0) return 0;
  const effectiveKmph = Math.max(speedKmph, floorKmph);
  const mps = (effectiveKmph * 1000) / 3600;
  return Math.round(remainingRoadDistanceM / mps);
}

/**
 * Bearing (compass heading) from a→b in degrees, 0 = north. Useful for the
 * live map arrow and for detecting a bus travelling the wrong way.
 */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Given the trip's remaining stops (with running distances) and the bus's
 * distance covered so far, find the next stop and the ETA to it.
 */
export interface StopProgress {
  stopId: string;
  distanceFromOriginM: number;
}

export function nextStopEta(
  stops: StopProgress[],
  distanceCoveredM: number,
  speedKmph: number,
): { nextStopId: string | null; remainingM: number; etaSeconds: number } {
  const next = stops.find((s) => s.distanceFromOriginM > distanceCoveredM);
  if (!next) return { nextStopId: null, remainingM: 0, etaSeconds: 0 };
  const remainingM = next.distanceFromOriginM - distanceCoveredM;
  return { nextStopId: next.stopId, remainingM, etaSeconds: etaSeconds(remainingM, speedKmph) };
}
