import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { AppError, UpstreamError } from '../../src/lib/errors.js';
import { fetchJson } from '../../src/lib/http.js';
import { createLogger } from '../../src/lib/logger.js';
import { createBriefService, cacheKey } from '../../src/services/briefService.js';
import { TtlCache } from '../../src/services/cache.js';
import {
  OPEN_METEO_HOSTS,
  createOpenMeteoClient,
  type OpenMeteoClient,
} from '../../src/services/openMeteo.js';
import {
  DELHI,
  RAW_GEOCODING,
  makeAir,
  makeHousehold,
  makeWeather,
  rawAirResponse,
  rawWeatherResponse,
} from '../fixtures/data.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const silent = createLogger('silent');

describe('TtlCache', () => {
  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new TtlCache<string>(1000, 10, () => now);
    cache.set('a', 'x');
    expect(cache.get('a')).toBe('x');
    now = 1000;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // a is now most recent
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('coalesces concurrent loads and caches the result', async () => {
    const cache = new TtlCache<number>(60_000, 10);
    const loader = vi.fn(async () => 42);
    const results = await Promise.all([
      cache.getOrLoad('k', loader),
      cache.getOrLoad('k', loader),
      cache.getOrLoad('k', loader),
    ]);
    expect(results).toEqual([42, 42, 42]);
    expect(await cache.getOrLoad('k', loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('never caches failures', async () => {
    const cache = new TtlCache<number>(60_000, 10);
    await expect(cache.getOrLoad('k', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(await cache.getOrLoad('k', async () => 7)).toBe(7);
  });

  it('validates its configuration', () => {
    expect(() => new TtlCache(0, 1)).toThrow();
    expect(() => new TtlCache(1, 0)).toThrow();
  });
});

describe('fetchJson', () => {
  const url = new URL('https://example.test/data');

  it('returns parsed JSON', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ ok: true }));
    expect(await fetchJson(url, fetchFn, { timeoutMs: 1000 })).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('retries transient network errors and 5xx/429 responses', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    expect(await fetchJson(url, fetchFn, { timeoutMs: 1000, retries: 2, retryDelayMs: 1 })).toEqual(
      { ok: 1 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not retry client errors and hides technical details from users', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 404));
    const error = await fetchJson(url, fetchFn, { timeoutMs: 1000, retryDelayMs: 1 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).message).not.toMatch(/example\.test/);
    expect((error as UpstreamError).detail).toBe('example.test: HTTP 404');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fails after exhausting retries, and on invalid JSON', async () => {
    const down = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    const error = (await fetchJson(url, down, { timeoutMs: 10, retries: 1, retryDelayMs: 1 }).catch(
      (e: unknown) => e,
    )) as UpstreamError;
    expect(error.status).toBe(502);
    expect(error.detail).toBe('example.test: TimeoutError');
    expect(down).toHaveBeenCalledTimes(2);

    const garbage = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(fetchJson(url, garbage, { timeoutMs: 10 })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe('Open-Meteo client', () => {
  const clientWith = (body: unknown) => {
    const fetchFn = vi.fn(async (_input: string | URL | Request) => jsonResponse(body));
    return {
      fetchFn,
      client: createOpenMeteoClient({
        fetchFn: fetchFn as typeof fetch,
        timeoutMs: 1000,
        retries: 0,
      }),
    };
  };

  it('requests and maps air-quality data', async () => {
    const { fetchFn, client } = clientWith(rawAirResponse());
    const air = await client.getAirQuality(28.65195, 77.23149);
    const url = fetchFn.mock.calls[0]?.[0] as URL;
    expect(url.origin + url.pathname).toBe(OPEN_METEO_HOSTS.airQuality);
    expect(url.searchParams.get('latitude')).toBe('28.6519'); // toFixed(4) of the binary float 28.65195
    expect(url.searchParams.get('hourly')).toContain('pm2_5');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(air.hourly).toHaveLength(48);
    expect(air.current.pm2_5).toBe(63.8);
    expect(air.hourly[0]?.concentrations).toMatchObject({ pm2_5: 58.9, no2: 25, co: 700 });
  });

  it('fills missing hourly series with nulls', async () => {
    const raw = rawAirResponse();
    delete (raw.hourly as Record<string, unknown>).ozone;
    const air = await clientWith(raw).client.getAirQuality(1, 1);
    expect(air.hourly[0]?.concentrations.o3).toBeNull();
  });

  it('requests and maps weather including mixing height', async () => {
    const { fetchFn, client } = clientWith(rawWeatherResponse());
    const weather = await client.getWeather(28.65, 77.23);
    expect((fetchFn.mock.calls[0]?.[0] as URL).searchParams.get('hourly')).toContain(
      'boundary_layer_height',
    );
    expect(weather.hourly[0]).toEqual({
      time: '2026-11-24T00:00',
      temperatureC: 12,
      humidityPct: 70,
      windKmh: 7.2,
      boundaryLayerM: 105,
    });
  });

  it('maps weather with missing variables to nulls', async () => {
    const weather = await clientWith({
      timezone: 'UTC',
      hourly: { time: ['2026-11-24T00:00'] },
    }).client.getWeather(0, 0);
    expect(weather.hourly[0]).toEqual({
      time: '2026-11-24T00:00',
      temperatureC: null,
      humidityPct: null,
      windKmh: null,
      boundaryLayerM: null,
    });
  });

  it('searches places and handles "no results"', async () => {
    const found = await clientWith(RAW_GEOCODING).client.searchPlaces('Delhi');
    expect(found[0]).toEqual({
      name: 'Delhi',
      latitude: 28.65195,
      longitude: 77.23149,
      country: 'India',
      countryCode: 'IN',
      region: 'National Capital Territory of Delhi',
      timezone: 'Asia/Kolkata',
    });
    expect(await clientWith({}).client.searchPlaces('Nowhere')).toEqual([]);
  });

  it('rejects unexpected upstream shapes', async () => {
    await expect(clientWith({ nonsense: true }).client.getAirQuality(1, 1)).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});

describe('brief service', () => {
  const fakeClient = (overrides: Partial<OpenMeteoClient> = {}): OpenMeteoClient => ({
    getAirQuality: vi.fn(async () => makeAir()),
    getWeather: vi.fn(async () => makeWeather()),
    searchPlaces: vi.fn(async () => [DELHI]),
    ...overrides,
  });

  it('rounds coordinates for cache keys (~1 km)', () => {
    expect(cacheKey(28.65195, 77.23149)).toBe('28.65,77.23');
  });

  it('serves nearby users from one upstream call', async () => {
    const client = fakeClient();
    const service = createBriefService({ client, logger: silent });
    await service.getBrief({ location: DELHI, household: makeHousehold(), standard: 'auto' });
    await service.getBrief({
      location: { ...DELHI, latitude: 28.6501 },
      household: makeHousehold({ conditions: ['asthma'] }),
      standard: 'auto',
    });
    expect(client.getAirQuality).toHaveBeenCalledTimes(1);
    expect(client.getWeather).toHaveBeenCalledTimes(1);
  });

  it('keeps working without weather and fails clearly without air data', async () => {
    const warn = vi.fn();
    const logger = { ...silent, warn };
    const noWeather = createBriefService({
      client: fakeClient({ getWeather: async () => Promise.reject(new UpstreamError('down')) }),
      logger,
    });
    const brief = await noWeather.getBrief({
      location: DELHI,
      household: makeHousehold(),
      standard: 'auto',
    });
    expect(brief.smog.available).toBe(false);
    expect(warn).toHaveBeenCalledOnce();

    const noAir = createBriefService({
      client: fakeClient({ getAirQuality: async () => Promise.reject(new UpstreamError('down')) }),
      logger: silent,
    });
    await expect(
      noAir.getBrief({ location: DELHI, household: makeHousehold(), standard: 'auto' }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('normalises and caches place searches', async () => {
    const client = fakeClient();
    const service = createBriefService({ client, logger: silent });
    await service.searchPlaces('  Delhi ');
    await service.searchPlaces('delhi');
    expect(client.searchPlaces).toHaveBeenCalledOnce();
    expect(client.searchPlaces).toHaveBeenCalledWith('delhi');
  });
});

describe('configuration', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 8080,
      env: 'development',
      trustProxyHops: 0,
      rateLimitPerMinute: 60,
      chatRateLimitPerMinute: 10,
    });
    expect(config.llm).toMatchObject({
      provider: 'auto',
      geminiModel: 'gemini-flash-latest',
      anthropicModel: 'claude-opus-5-5',
    });
    expect(config.llm.geminiApiKey).toBeUndefined();
  });

  it('treats blank secrets as unset and coerces numbers', () => {
    const config = loadConfig({
      GEMINI_API_KEY: '  ',
      ANTHROPIC_API_KEY: 'sk-test',
      PORT: '3000',
      LLM_PROVIDER: 'claude',
    });
    expect(config.llm.geminiApiKey).toBeUndefined();
    expect(config.llm.anthropicApiKey).toBe('sk-test');
    expect(config.port).toBe(3000);
  });

  it('fails fast on invalid values without echoing them', () => {
    expect(() => loadConfig({ PORT: '99999', LLM_PROVIDER: 'openai' })).toThrow(
      'Invalid configuration for: PORT, LLM_PROVIDER',
    );
  });
});

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes structured JSON at or above the configured level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger('info');
    logger.debug('hidden');
    logger.info('shown', { a: 1 });
    logger.warn('careful');
    logger.error('bad');
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
      severity: 'INFO',
      message: 'shown',
      a: 1,
    });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('can be silenced entirely', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger('silent').info('nope');
    createLogger('debug').debug('yes');
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('AppError', () => {
  it('carries status, code and a log-only detail', () => {
    const error = new AppError(418, 'TEAPOT', 'short and stout', { detail: 'internal' });
    expect(error).toMatchObject({
      status: 418,
      code: 'TEAPOT',
      message: 'short and stout',
      detail: 'internal',
    });
  });
});
