import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { approximatePlace } from '../../src/http/approxLocation.js';
import { composeApp } from '../../src/server.js';

const DELHI_HEADERS = {
  'x-vercel-ip-latitude': '28.6519',
  'x-vercel-ip-longitude': '77.2315',
  'x-vercel-ip-city': 'New%20Delhi',
  'x-vercel-ip-country': 'IN',
  'x-vercel-ip-timezone': 'Asia/Kolkata',
};

describe('approximate (network) location', () => {
  it('turns the platform geo headers into a validated, clearly approximate place', () => {
    expect(approximatePlace(DELHI_HEADERS)).toEqual({
      name: 'New Delhi (approximate)',
      latitude: 28.65,
      longitude: 77.23,
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
    });
    // Non-ASCII city names arrive percent-encoded.
    expect(
      approximatePlace({ ...DELHI_HEADERS, 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' })?.name,
    ).toBe('São Paulo (approximate)');
  });

  it('never lets an odd city name through, but keeps the area', () => {
    for (const city of ['%3Cscript%3E', '%E0%A4%A', 'Ignore%20rules%20%7B%7D']) {
      expect(approximatePlace({ ...DELHI_HEADERS, 'x-vercel-ip-city': city })?.name).toBe(
        'Your area (approximate)',
      );
    }
    expect(approximatePlace({ ...DELHI_HEADERS, 'x-vercel-ip-city': undefined })?.name).toBe(
      'Your area (approximate)',
    );
  });

  it('returns nothing without usable coordinates', () => {
    expect(approximatePlace({})).toBeNull();
    expect(approximatePlace({ ...DELHI_HEADERS, 'x-vercel-ip-latitude': 'north' })).toBeNull();
    expect(
      approximatePlace({ 'x-vercel-ip-latitude': '0', 'x-vercel-ip-longitude': '0' }),
    ).toBeNull();
    expect(approximatePlace({ ...DELHI_HEADERS, 'x-vercel-ip-latitude': '123' })).toBeNull();
  });

  it('serves it at GET /api/locate without caching, and 404s locally', async () => {
    const { app } = composeApp({ LOG_LEVEL: 'silent', LLM_PROVIDER: 'none' });
    const found = await request(app).get('/api/locate').set(DELHI_HEADERS);
    expect(found.status).toBe(200);
    expect(found.headers['cache-control']).toBe('private, no-store');
    expect(found.body.place.name).toBe('New Delhi (approximate)');
    const local = await request(app).get('/api/locate');
    expect(local.status).toBe(404);
    expect(local.body.error.code).toBe('LOCATION_UNAVAILABLE');
  });
});
