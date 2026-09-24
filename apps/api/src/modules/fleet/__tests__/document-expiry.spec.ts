import { describe, expect, it } from 'vitest';

import { localDate } from '@kernel';

import {
  documentsExpiringWithin,
  evaluateDocument,
  evaluateFleetCompliance,
  isRoadLegalOn,
  type VehicleDocument,
} from '../domain/document-expiry';

const TODAY = localDate('2026-03-15');

describe('evaluateDocument — happy / negative / edge', () => {
  it('marks a far-future document valid', () => {
    const e = evaluateDocument({ type: 'insurance', expiresOn: localDate('2026-12-31') }, TODAY);
    expect(e.status).toBe('valid');
    expect(e.daysUntilExpiry).toBe(291);
  });

  it('marks a document within the warn window expiring_soon', () => {
    const e = evaluateDocument({ type: 'puc', expiresOn: localDate('2026-04-01') }, TODAY);
    expect(e.status).toBe('expiring_soon');
    expect(e.daysUntilExpiry).toBe(17);
  });

  it('marks a past document expired with negative days', () => {
    const e = evaluateDocument({ type: 'fitness', expiresOn: localDate('2026-03-01') }, TODAY);
    expect(e.status).toBe('expired');
    expect(e.daysUntilExpiry).toBe(-14);
  });

  it('marks an absent document missing', () => {
    const e = evaluateDocument({ type: 'permit', expiresOn: null }, TODAY);
    expect(e.status).toBe('missing');
  });

  it('edge: expiring exactly today is expiring_soon, not expired (valid through end of day)', () => {
    const e = evaluateDocument({ type: 'permit', expiresOn: TODAY }, TODAY);
    expect(e.status).toBe('expiring_soon');
    expect(e.daysUntilExpiry).toBe(0);
  });

  it('edge: a document not yet in effect (future validFrom) is treated as missing', () => {
    const e = evaluateDocument({ type: 'permit', validFrom: localDate('2026-04-01'), expiresOn: localDate('2027-04-01') }, TODAY);
    expect(e.status).toBe('missing');
  });

  it('edge: expiring exactly at the warn-window boundary is expiring_soon', () => {
    const e = evaluateDocument({ type: 'puc', expiresOn: localDate('2026-04-14') }, TODAY, 30);
    expect(e.daysUntilExpiry).toBe(30);
    expect(e.status).toBe('expiring_soon');
  });
});

describe('evaluateFleetCompliance', () => {
  const allValid: VehicleDocument[] = [
    { type: 'permit', expiresOn: localDate('2027-01-01') },
    { type: 'insurance', expiresOn: localDate('2026-10-01') },
    { type: 'fitness', expiresOn: localDate('2026-09-01') },
    { type: 'puc', expiresOn: localDate('2026-06-01') },
  ];

  it('is road-legal when all required docs are valid', () => {
    const r = evaluateFleetCompliance(allValid, TODAY);
    expect(r.roadLegal).toBe(true);
    expect(r.blocking).toHaveLength(0);
  });

  it('is still road-legal when a doc is merely expiring soon', () => {
    const docs = [...allValid];
    docs[3] = { type: 'puc', expiresOn: localDate('2026-03-20') }; // 5 days out
    const r = evaluateFleetCompliance(docs, TODAY);
    expect(r.roadLegal).toBe(true);
    expect(r.evaluations.find((e) => e.type === 'puc')?.status).toBe('expiring_soon');
  });

  it('is NOT road-legal when a required doc is expired', () => {
    const docs = [...allValid];
    docs[1] = { type: 'insurance', expiresOn: localDate('2026-03-01') };
    const r = evaluateFleetCompliance(docs, TODAY);
    expect(r.roadLegal).toBe(false);
    expect(r.blocking.map((b) => b.type)).toContain('insurance');
  });

  it('is NOT road-legal when a required doc is entirely missing', () => {
    const docs = allValid.filter((d) => d.type !== 'permit');
    const r = evaluateFleetCompliance(docs, TODAY);
    expect(r.roadLegal).toBe(false);
    expect(r.blocking.map((b) => b.type)).toContain('permit');
  });
});

describe('isRoadLegalOn (future journey date)', () => {
  const docs: VehicleDocument[] = [
    { type: 'permit', expiresOn: localDate('2027-01-01') },
    { type: 'insurance', expiresOn: localDate('2026-04-10') },
    { type: 'fitness', expiresOn: localDate('2026-09-01') },
    { type: 'puc', expiresOn: localDate('2026-06-01') },
  ];

  it('is legal on a date before every expiry', () => {
    expect(isRoadLegalOn(docs, localDate('2026-04-01'))).toBe(true);
  });

  it('is NOT legal on a date after insurance expires (even though valid today)', () => {
    // insurance expires 2026-04-10; journey 2026-04-20 is not covered.
    expect(isRoadLegalOn(docs, localDate('2026-04-20'))).toBe(false);
  });

  it('edge: legal exactly on the expiry date (valid through that day)', () => {
    expect(isRoadLegalOn(docs, localDate('2026-04-10'))).toBe(true);
  });
});

describe('documentsExpiringWithin', () => {
  it('returns expiring docs soonest-first and excludes far-future & missing', () => {
    const docs: VehicleDocument[] = [
      { type: 'permit', expiresOn: localDate('2027-01-01') }, // far
      { type: 'insurance', expiresOn: localDate('2026-04-10') }, // 26 days
      { type: 'puc', expiresOn: localDate('2026-03-25') }, // 10 days
      { type: 'fitness', expiresOn: null }, // missing
    ];
    const result = documentsExpiringWithin(docs, TODAY, 30);
    expect(result.map((r) => r.type)).toEqual(['puc', 'insurance']);
  });
});
