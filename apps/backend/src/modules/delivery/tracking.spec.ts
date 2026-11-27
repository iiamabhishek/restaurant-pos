import {
  etaMinutes,
  haversineKm,
  trackView,
  type TrackInput,
} from './tracking';

const now = new Date('2026-11-25T10:00:00Z');
const base: TrackInput = {
  deliveryStatus: 'PICKED_UP',
  orderStatus: 'OPEN',
  destination: { lat: 12.9716, lng: 77.5946 },
  rider: {
    name: 'Ravi Kumar',
    online: true,
    lat: 12.9816,
    lng: 77.5946,
    at: new Date(now.getTime() - 20_000),
  },
  now,
};

describe('delivery tracking view', () => {
  it('distance is right: 0.01 degrees of latitude is about 1.1 km', () => {
    expect(
      haversineKm(
        { lat: 12.9816, lng: 77.5946 },
        { lat: 12.9716, lng: 77.5946 },
      ),
    ).toBeCloseTo(1.11, 1);
    expect(etaMinutes(1.11)).toBe(4);
    expect(etaMinutes(0)).toBe(1);
  });

  it('shares the rider position, first name only, while picked up and fresh', () => {
    const v = trackView(base);
    expect(v.rider?.firstName).toBe('Ravi');
    expect(v.distanceKm).toBe(1.1);
    expect(v.etaMinutes).toBe(4);
    expect(v.rider?.updatedSecondsAgo).toBe(20);
  });

  it('never shares the position before pickup or after delivery', () => {
    for (const s of ['UNASSIGNED', 'ASSIGNED', 'DELIVERED', 'FAILED']) {
      const v = trackView({ ...base, deliveryStatus: s });
      expect(v.rider).toBeNull();
      expect(v.distanceKm).toBeNull();
    }
  });

  it('a cancelled order shows cancelled and no position', () => {
    const v = trackView({ ...base, orderStatus: 'CANCELLED' });
    expect(v.status).toBe('CANCELLED');
    expect(v.rider).toBeNull();
  });

  it('a stale, offline or missing position is withheld with a plain note', () => {
    const stale = trackView({
      ...base,
      rider: { ...base.rider!, at: new Date(now.getTime() - 10 * 60_000) },
    });
    expect(stale.rider).toBeNull();
    expect(stale.note).toMatch(/not available/);
    expect(
      trackView({ ...base, rider: { ...base.rider!, online: false } }).rider,
    ).toBeNull();
    expect(trackView({ ...base, rider: null }).rider).toBeNull();
    expect(
      trackView({ ...base, rider: { ...base.rider!, lat: null } }).rider,
    ).toBeNull();
  });

  it('without a destination pin the position is shown but no distance is invented', () => {
    const v = trackView({ ...base, destination: { lat: null, lng: null } });
    expect(v.rider).not.toBeNull();
    expect(v.distanceKm).toBeNull();
    expect(v.etaMinutes).toBeNull();
  });
});
