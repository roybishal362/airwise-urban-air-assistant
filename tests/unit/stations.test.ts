import { describe, expect, it, vi } from 'vitest';
import { buildBrief } from '../../src/domain/brief.js';
import {
  MAX_FACTOR,
  MIN_FACTOR,
  calibrateAir,
  describeStations,
} from '../../src/domain/calibration.js';
import type { StationSnapshot } from '../../src/domain/types.js';
import { UpstreamError } from '../../src/lib/errors.js';
import { createLogger } from '../../src/lib/logger.js';
import { createBriefService } from '../../src/services/briefService.js';
import {
  OPENAQ_BASE,
  createOpenAqClient,
  haversineKm,
  toMicrograms,
} from '../../src/services/openaq.js';
import type { OpenMeteoClient } from '../../src/services/openMeteo.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const fresh = { utc: '2026-11-24T09:00:00Z', local: '2026-11-24T14:30:00+05:30' };
const stale = { utc: '2026-11-23T09:00:00Z', local: '2026-11-23T14:30:00+05:30' };

const sensor = (id: number, name: string, units: string) => ({
  id,
  name: `${name} ${units}`,
  parameter: { id, name, units, displayName: name },
});

const location = (
  id: number,
  lat: number,
  lon: number,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  name: `Station ${id}`,
  locality: 'Delhi',
  timezone: 'Asia/Kolkata',
  isMonitor: true,
  coordinates: { latitude: lat, longitude: lon },
  datetimeLast: fresh,
  sensors: [
    sensor(id * 10 + 1, 'pm25', 'µg/m³'),
    sensor(id * 10 + 2, 'pm10', 'µg/m³'),
    sensor(id * 10 + 3, 'no2', 'ppb'),
    sensor(id * 10 + 4, 'co', 'ppm'),
  ],
  ...overrides,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const STATION: StationSnapshot = {
  provider: 'OpenAQ',
  stations: [{ name: 'Anand Vihar', distanceKm: 3.2, measuredAtLocal: '2026-11-24T06:00' }],
  concentrations: { pm2_5: 255, pm10: 380, no2: 60 },
};

describe('unit conversion and distance', () => {
  it('converts station units to µg/m³', () => {
    expect(toMicrograms(42, 'µg/m³', 'pm2_5')).toBe(42);
    expect(toMicrograms(42, 'μg/m³', 'pm2_5')).toBe(42); // Greek mu
    expect(toMicrograms(1.2, 'mg/m³', 'co')).toBe(1200);
    expect(toMicrograms(100, 'ppb', 'no2')).toBeCloseTo(188.2, 1);
    expect(toMicrograms(1, 'ppm', 'co')).toBeCloseTo(1145.6, 1);
    expect(toMicrograms(1, 'ppm', 'pm2_5')).toBeNull();
    expect(toMicrograms(1, 'furlongs', 'no2')).toBeNull();
  });

  it('computes great-circle distance', () => {
    expect(haversineKm(28.6139, 77.209, 19.076, 72.8777)).toBeCloseTo(1150, -1); // Delhi–Mumbai
    expect(haversineKm(28.6, 77.2, 28.6, 77.2)).toBe(0);
  });
});

describe('OpenAQ client', () => {
  function clientWith(locations: unknown[], latest: Record<number, unknown[]>) {
    const fetchFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/locations')) return json({ results: locations });
      const id = Number(url.pathname.split('/').at(-2));
      return json({ results: latest[id] ?? [] });
    });
    const client = createOpenAqClient({
      apiKey: 'test-key',
      timeoutMs: 1000,
      fetchFn: fetchFn as typeof fetch,
      now: () => NOW,
    });
    return { client, fetchFn };
  }
  const reading = (sensorsId: number, value: number | null, datetime = fresh) => ({
    datetime,
    value,
    sensorsId,
    locationsId: 0,
    coordinates: { latitude: 0, longitude: 0 },
  });

  it('averages the three nearest fresh reference stations and converts units', async () => {
    const { client, fetchFn } = clientWith(
      [
        location(1, 28.66, 77.23),
        location(2, 28.7, 77.3),
        location(3, 28.62, 77.2),
        location(4, 28.9, 77.6), // fourth-nearest: ignored
        location(5, 28.65, 77.23, { datetimeLast: stale }), // stale
        location(6, 28.65, 77.23, { isMonitor: false }), // low-cost sensor
        location(7, 28.65, 77.23, { sensors: [sensor(71, 'no2', 'ppb')] }), // no particles
      ],
      {
        1: [reading(11, 250), reading(12, 400), reading(13, 50), reading(14, 2)],
        2: [reading(21, 270), reading(22, -1), reading(23, null)],
        3: [reading(31, 230, stale), reading(32, 380), reading(999, 5)],
        4: [reading(41, 999)],
      },
    );
    const snapshot = await client.latest(28.652, 77.231);
    const first = fetchFn.mock.calls[0]?.[0] as URL;
    expect(String(first)).toContain(
      `${OPENAQ_BASE}/locations?coordinates=28.6520%2C77.2310&radius=25000`,
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      'X-API-Key': 'test-key',
    });
    expect(snapshot?.provider).toBe('OpenAQ');
    expect(snapshot?.stations.map((s) => s.name)).toEqual(['Station 1', 'Station 3', 'Station 2']);
    expect(snapshot?.stations[0]).toMatchObject({ measuredAtLocal: '2026-11-24T14:30' });
    expect(snapshot?.concentrations.pm2_5).toBe(260); // (250 + 270) / 2; station 3's PM2.5 is stale
    expect(snapshot?.concentrations.pm10).toBe(390); // (400 + 380) / 2
    expect(snapshot?.concentrations.no2).toBeCloseTo(94.1, 1); // 50 ppb
    expect(snapshot?.concentrations.co).toBeCloseTo(2291.2, 1); // 2 ppm
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('returns null when no fresh station measures particles', async () => {
    const { client } = clientWith([location(1, 28.66, 77.23, { datetimeLast: stale })], {});
    expect(await client.latest(28.65, 77.23)).toBeNull();
    const { client: empty } = clientWith([location(2, 28.66, 77.23)], {
      2: [reading(21, 1, stale)],
    });
    expect(await empty.latest(28.65, 77.23)).toBeNull();
  });

  it('turns HTTP, network and schema failures into UpstreamError', async () => {
    const http = createOpenAqClient({
      apiKey: 'k',
      timeoutMs: 10,
      fetchFn: (async () => json({}, 401)) as typeof fetch,
    });
    await expect(http.latest(0, 0)).rejects.toMatchObject({ detail: 'openaq: HTTP 401' });
    const network = createOpenAqClient({
      apiKey: 'k',
      timeoutMs: 10,
      fetchFn: (async () => Promise.reject(new TypeError('offline'))) as typeof fetch,
    });
    await expect(network.latest(0, 0)).rejects.toBeInstanceOf(UpstreamError);
    const schema = createOpenAqClient({
      apiKey: 'k',
      timeoutMs: 10,
      fetchFn: (async () => json({ nope: 1 })) as typeof fetch,
    });
    await expect(schema.latest(0, 0)).rejects.toMatchObject({ detail: 'openaq: schema' });
  });

  it('fetches station readings in parallel and skips a station that fails', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes('/latest')) {
        return json({ results: [location(1, 28.66, 77.23), location(2, 28.7, 77.3)] });
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return url.includes('/locations/1/') ? json({}, 500) : json({ results: [reading(21, 300)] });
    });
    const client = createOpenAqClient({
      apiKey: 'k',
      timeoutMs: 1000,
      fetchFn: fetchFn as typeof fetch,
      now: () => NOW,
    });
    const snapshot = await client.latest(28.65, 77.23);
    expect(peak).toBe(2);
    expect(snapshot?.stations.map((s) => s.name)).toEqual(['Station 2']);
    expect(snapshot?.concentrations.pm2_5).toBe(300);
  });

  it('reports an error when every station read fails', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/latest')
        ? json({}, 429)
        : json({ results: [location(1, 28.66, 77.23), location(2, 28.7, 77.3)] }),
    );
    const client = createOpenAqClient({
      apiKey: 'k',
      timeoutMs: 1000,
      fetchFn: fetchFn as typeof fetch,
      now: () => NOW,
    });
    await expect(client.latest(28.65, 77.23)).rejects.toMatchObject({
      detail: 'openaq: HTTP 429',
    });
  });

  it('skips stations whose latest payload is malformed', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/latest')
        ? json({ broken: true })
        : json({ results: [location(1, 28.66, 77.23)] }),
    );
    const client = createOpenAqClient({
      apiKey: 'k',
      timeoutMs: 10,
      fetchFn: fetchFn as typeof fetch,
      now: () => NOW,
    });
    expect(await client.latest(28.65, 77.23)).toBeNull();
  });
});

describe('calibration', () => {
  const air = makeAir();

  it('labels the model fallback honestly when there is no station', () => {
    const { air: same, source } = calibrateAir(air, null, 6);
    expect(same).toBe(air);
    expect(source).toMatchObject({ kind: 'model', stations: [], factors: {} });
    expect(source.label).toMatch(/Modelled estimate/);
    expect(calibrateAir(air, { ...STATION, concentrations: { no2: 40 } }, 6).source.kind).toBe(
      'model',
    );
  });

  it('uses only measured values for "now" and rescales the forecast per pollutant', () => {
    const { air: calibrated, source } = calibrateAir(air, STATION, 6);
    expect(source.kind).toBe('station');
    expect(calibrated.current).toEqual({
      pm2_5: 255,
      pm10: 380,
      no2: 60,
      so2: null,
      o3: null,
      co: null,
    });
    // model PM2.5 at 06:00 is 63.8 → factor 4.0; every hour scaled by it
    expect(source.factors.pm2_5).toBe(4);
    expect(calibrated.hourly[6]?.concentrations.pm2_5).toBeCloseTo(255.2, 0);
    expect(calibrated.hourly[14]?.concentrations.pm2_5).toBeCloseTo(26.8 * 4, 0);
    // unmeasured pollutants are excluded from the forecast instead of mixed in
    expect(calibrated.hourly[6]?.concentrations.o3).toBeNull();
    expect(source.label).toBe(
      'Measured at 06:00 by 1 monitoring station via OpenAQ: Anand Vihar (3.2 km).',
    );
  });

  it('clamps implausible correction factors and handles zero model values', () => {
    const zero = makeAir();
    zero.hourly[6] = { time: zero.hourly[6]?.time ?? '', concentrations: { pm2_5: 0, pm10: 1 } };
    const huge = calibrateAir(zero, { ...STATION, concentrations: { pm2_5: 50, pm10: 5000 } }, 6);
    expect(huge.source.factors).toEqual({ pm2_5: 1, pm10: MAX_FACTOR });
    const tiny = calibrateAir(makeAir(), { ...STATION, concentrations: { pm2_5: 1 } }, 6);
    expect(tiny.source.factors.pm2_5).toBe(MIN_FACTOR);
  });

  it('describes several stations', () => {
    expect(
      describeStations('OpenAQ', [
        { name: 'A', distanceKm: 1, measuredAtLocal: '2026-11-24T05:00' },
        { name: 'B', distanceKm: 2.25, measuredAtLocal: '2026-11-24T06:00' },
      ]),
    ).toBe('Measured at 06:00 by 2 monitoring stations via OpenAQ: A (1.0 km), B (2.3 km).');
    expect(describeStations('OpenAQ', [{ name: 'A', distanceKm: 1, measuredAtLocal: '' }])).toMatch(
      /^Measured by 1/,
    );
  });

  it('makes the brief show measured smog instead of the model', () => {
    const modelOnly = buildBrief({
      location: DELHI,
      air,
      weather: makeWeather(),
      household: makeHousehold(),
      standard: 'auto',
    });
    const measured = buildBrief({
      location: DELHI,
      air,
      weather: makeWeather(),
      household: makeHousehold(),
      standard: 'auto',
      station: STATION,
    });
    expect(modelOnly.dataSource.kind).toBe('model');
    expect(measured.dataSource.kind).toBe('station');
    expect(measured.current.aqi).toBeGreaterThan(modelOnly.current.aqi);
    expect(measured.current.category.label).toBe('Severe'); // PM2.5 255 µg/m³ on the India NAQI
    expect(measured.exposure.cigarettesPerDay).toBeCloseTo(255 / 22, 1);
    expect(measured.policy?.stage).toBe(3); // NAQI ≈ 404: Stage III ('Severe', 401–450)
  });
});

describe('brief service with stations', () => {
  const meteo: OpenMeteoClient = {
    getAirQuality: async () => makeAir(),
    getWeather: async () => makeWeather(),
    searchPlaces: async () => [],
  };

  it('uses station data when available and caches it', async () => {
    const latest = vi.fn(async () => STATION);
    const service = createBriefService({
      client: meteo,
      stations: { latest },
      logger: createLogger('silent'),
    });
    const brief = await service.getBrief({
      location: DELHI,
      household: makeHousehold(),
      standard: 'auto',
    });
    await service.getBrief({ location: DELHI, household: makeHousehold(), standard: 'auto' });
    expect(brief.dataSource.kind).toBe('station');
    expect(latest).toHaveBeenCalledOnce();
  });

  it('falls back to the labelled model estimate when stations fail', async () => {
    const warn = vi.fn();
    const service = createBriefService({
      client: meteo,
      stations: {
        latest: async () =>
          Promise.reject(new UpstreamError('down', { detail: 'openaq: HTTP 500' })),
      },
      logger: { ...createLogger('silent'), warn },
    });
    const brief = await service.getBrief({
      location: DELHI,
      household: makeHousehold(),
      standard: 'auto',
    });
    expect(brief.dataSource.kind).toBe('model');
    expect(warn).toHaveBeenCalledWith('stations unavailable, continuing without it', {
      error: 'down',
      detail: 'openaq: HTTP 500',
    });
  });

  it('logs unexpected station failures without a detail field', async () => {
    const warn = vi.fn();
    const service = createBriefService({
      client: meteo,
      stations: { latest: async () => Promise.reject(new TypeError('boom')) },
      logger: { ...createLogger('silent'), warn },
    });
    const brief = await service.getBrief({
      location: DELHI,
      household: makeHousehold(),
      standard: 'auto',
    });
    expect(brief.dataSource.kind).toBe('model');
    expect(warn.mock.calls[0]?.[1]).toEqual({ error: 'boom', detail: undefined });
  });
});
