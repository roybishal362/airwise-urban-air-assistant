import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  fetchBrief,
  fetchHealth,
  locateApproximately,
  requestJson,
  searchPlaces,
  sendChat,
} from '../../public/js/api.js';
import {
  clock,
  formatCo2,
  formatMass,
  formatNumber,
  signedPct,
  textToBlocks,
  timeRange,
  trapRiskLabel,
} from '../../public/js/format.js';
import {
  DEFAULT_PROFILE,
  isPlace,
  isProfile,
  loadPlace,
  loadProfile,
  savePlace,
  saveProfile,
} from '../../public/js/storage.js';
import { MemoryStorage } from '../fixtures/browser.js';

describe('format helpers', () => {
  it('formats times and ranges', () => {
    expect(clock('2026-11-24T16:00')).toBe('16:00');
    expect(timeRange('2026-11-24T13:00', '2026-11-24T15:00')).toBe('13:00–15:00');
  });

  it('formats numbers, masses and CO₂ readably', () => {
    expect(formatNumber(123456)).toBe('1,23,456');
    expect(formatMass(null)).toBe('—');
    expect(formatMass(950)).toBe('950 g');
    expect(formatMass(52_000)).toBe('52 kg');
    expect(formatMass(2_500_000)).toBe('2.5 t');
    expect(formatCo2(null)).toBe('—');
    expect(formatCo2(749)).toBe('749 kg CO₂');
    expect(formatCo2(43_200)).toBe('43.2 t CO₂');
  });

  it('signs percentages with a real minus sign', () => {
    expect(signedPct(0)).toBe('0%');
    expect(signedPct(12)).toBe('+12%');
    expect(signedPct(-39)).toBe('−39%');
  });

  it('labels smog-trap risk', () => {
    expect(trapRiskLabel('severe')).toBe('Severe');
    expect(trapRiskLabel('nonsense' as 'low')).toBe('Unknown');
  });

  it('turns model text into paragraphs and lists without HTML', () => {
    expect(textToBlocks('Hello **there**\n\n- one\n• two\n3. three\nBye')).toEqual([
      { type: 'p', text: 'Hello there' },
      { type: 'ul', items: ['one', 'two', 'three'] },
      { type: 'p', text: 'Bye' },
    ]);
    expect(textToBlocks('')).toEqual([]);
  });
});

describe('local storage', () => {
  it('round-trips a valid profile and place', () => {
    const storage = new MemoryStorage();
    const profile = { ...structuredClone(DEFAULT_PROFILE), standard: 'in' as const };
    saveProfile(storage, profile);
    expect(loadProfile(storage)).toEqual(profile);
    const place = { name: 'Delhi', latitude: 28.6, longitude: 77.2 };
    savePlace(storage, place);
    expect(loadPlace(storage)).toEqual(place);
  });

  it('falls back to defaults for missing, corrupt or tampered data', () => {
    const storage = new MemoryStorage();
    expect(loadProfile(storage)).toEqual(DEFAULT_PROFILE);
    expect(loadPlace(storage)).toBeNull();
    storage.setItem('airwise.profile.v1', '{not json');
    expect(loadProfile(storage)).toEqual(DEFAULT_PROFILE);
    storage.setItem('airwise.profile.v1', JSON.stringify({ standard: 'mars', household: {} }));
    expect(loadProfile(storage)).toEqual(DEFAULT_PROFILE);
    storage.setItem('airwise.place.v1', JSON.stringify({ name: 'x', latitude: 999, longitude: 0 }));
    expect(loadPlace(storage)).toBeNull();
  });

  it('never throws when storage is full or blocked', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(() => saveProfile(storage, DEFAULT_PROFILE)).not.toThrow();
    expect(() => savePlace(storage, { name: 'A', latitude: 0, longitude: 0 })).not.toThrow();
  });

  it('validates shapes strictly', () => {
    expect(isProfile(null)).toBe(false);
    expect(isProfile([])).toBe(false);
    expect(isPlace({ name: '', latitude: 0, longitude: 0 })).toBe(false);
    expect(isPlace({ name: 'x'.repeat(81), latitude: 0, longitude: 0 })).toBe(false);
  });
});

describe('API client', () => {
  const ok = (body: unknown) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('sends JSON bodies and parses responses', async () => {
    const fetchFn = ok({ brief: { id: 1 } });
    expect(await fetchBrief({ a: 1 }, fetchFn)).toEqual({ id: 1 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/brief');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('encodes search queries and reads other endpoints', async () => {
    const fetchFn = ok({ places: [] });
    await searchPlaces('São Paulo & co', fetchFn);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/api/places?q=S%C3%A3o%20Paulo%20%26%20co');
    expect(await sendChat({}, ok({ reply: 'hi' }))).toEqual({ reply: 'hi' });
    expect(await fetchHealth(ok({ status: 'ok' }))).toEqual({ status: 'ok' });
    const area = { name: 'Delhi (approximate)', latitude: 28.65, longitude: 77.23 };
    expect(await locateApproximately(ok({ place: area }))).toEqual(area);
  });

  it('surfaces server error messages and network failures as ApiError', async () => {
    const failing = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down' } }), {
          status: 429,
        }),
    );
    await expect(requestJson('/x', {}, failing)).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Slow down',
    });
    const html = vi.fn(async () => new Response('<html>', { status: 500 }));
    await expect(requestJson('/x', {}, html)).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      message: 'Something went wrong. Please try again.',
    });
    const offline = vi.fn(async () => Promise.reject(new TypeError('offline')));
    const error = await requestJson('/x', {}, offline).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK');
  });
});
