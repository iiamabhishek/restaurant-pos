// What a customer may see while their delivery is on the way, as pure functions. The rider's position is shared only
// while the delivery is live and the position is fresh; otherwise the customer gets the status and nothing else.

export const POSITION_FRESH_MS = 5 * 60_000;
/** Average speed used for the arrival estimate: a scooter in city traffic. It is an estimate and is shown as one. */
export const ASSUMED_KMH = 18;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function etaMinutes(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / ASSUMED_KMH) * 60));
}

export interface TrackInput {
  deliveryStatus: string | null;
  orderStatus: string;
  destination: { lat: number | null; lng: number | null };
  rider: {
    name: string;
    online: boolean;
    lat: number | null;
    lng: number | null;
    at: Date | null;
  } | null;
  now: Date;
}

export interface TrackView {
  status: string;
  /** Only while the delivery is live (picked up) and the rider is sharing a fresh position. */
  rider: {
    firstName: string;
    lat: number;
    lng: number;
    updatedSecondsAgo: number;
  } | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  /** Why there is no live position, in words for the customer. */
  note: string | null;
}

export function trackView(i: TrackInput): TrackView {
  const status =
    i.orderStatus === 'CANCELLED'
      ? 'CANCELLED'
      : (i.deliveryStatus ?? 'UNASSIGNED');
  const none = (note: string | null): TrackView => ({
    status,
    rider: null,
    distanceKm: null,
    etaMinutes: null,
    note,
  });
  if (status === 'DELIVERED' || status === 'FAILED' || status === 'CANCELLED')
    return none(null);
  if (status !== 'PICKED_UP')
    return none(
      status === 'ASSIGNED'
        ? 'A rider has your order and will set off soon.'
        : 'Your order is being prepared.',
    );
  const r = i.rider;
  if (
    !r ||
    !r.online ||
    r.lat == null ||
    r.lng == null ||
    !r.at ||
    i.now.getTime() - r.at.getTime() > POSITION_FRESH_MS
  )
    return none(
      'Your rider is on the way. Their live position is not available right now.',
    );
  const ago = Math.max(
    0,
    Math.round((i.now.getTime() - r.at.getTime()) / 1000),
  );
  const dest = i.destination;
  const km =
    dest.lat != null && dest.lng != null
      ? haversineKm(
          { lat: r.lat, lng: r.lng },
          { lat: dest.lat, lng: dest.lng },
        )
      : null;
  return {
    status,
    rider: {
      firstName: r.name.trim().split(/\s+/)[0] ?? 'Your rider',
      lat: r.lat,
      lng: r.lng,
      updatedSecondsAgo: ago,
    },
    distanceKm: km == null ? null : Math.round(km * 10) / 10,
    etaMinutes: km == null ? null : etaMinutes(km),
    note: null,
  };
}
