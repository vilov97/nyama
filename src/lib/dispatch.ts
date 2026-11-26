/**
 * Pure dispatch-route helpers for the manager map.
 *
 * The product deliberately does NOT do live GPS tracking. This module only does
 * *static* planning: order the stops of a run so a rider drives a sensible
 * sequence, and detect when a run is over capacity.
 */

export type LatLng = { lat: number; lng: number };

export type Stop = LatLng & {
  /** Stable identifier — an order id in practice. */
  id: string;
};

/** Butchery default pickup point (Kikuyu / Ngong road area, Nairobi). */
export const DEPOT: LatLng = { lat: -1.2921, lng: 36.8219 };

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Nearest-neighbour ordering starting from the depot. Deterministic and
 * O(n²) — fine for the dozen or so stops a single rider carries.
 */
export function sequenceStops<T extends LatLng>(stops: T[], start: LatLng = DEPOT): T[] {
  const remaining = [...stops];
  const ordered: T[] = [];
  let cursor: LatLng = start;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((stop, index) => {
      const d = haversineKm(cursor, stop);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    if (next) {
      ordered.push(next);
      cursor = next;
    }
  }
  return ordered;
}

/** Total road distance of calling sequenceStops() then summing the legs. */
export function routeDistanceKm(stops: LatLng[], start: LatLng = DEPOT): number {
  const ordered = sequenceStops(stops, start);
  let total = 0;
  let cursor: LatLng = start;
  for (const stop of ordered) {
    total += haversineKm(cursor, stop);
    cursor = stop;
  }
  // Return leg to the depot, so a long trip home is not hidden.
  if (ordered.length > 0) total += haversineKm(cursor, start);
  return total;
}

export type CapacityState = "ok" | "near" | "over";

/** Compare a run's stop count against the rider's cap. */
export function capacityState(stopCount: number, maxStops: number): CapacityState {
  const cap = Number.isFinite(maxStops) && maxStops > 0 ? maxStops : 1;
  if (stopCount > cap) return "over";
  if (stopCount === cap) return "near";
  return "ok";
}

export function capacityLabel(stopCount: number, maxStops: number): string {
  const cap = Number.isFinite(maxStops) && maxStops > 0 ? maxStops : 1;
  const state = capacityState(stopCount, maxStops);
  if (state === "over") return `Overloaded — ${stopCount} of ${cap}`;
  if (state === "near") return `Full — ${stopCount} of ${cap}`;
  return `${stopCount} of ${cap} stops`;
}

/** Compact "12.4 km" style label. */
export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** Pin colour doubles as the route colour; keeps legend and markers in sync. */
export function pinColor(routeColor: string | null | undefined): string {
  return routeColor && /^#[0-9a-f]{6}$/i.test(routeColor) ? routeColor : "#737373";
}
