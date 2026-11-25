import { buildBrief, type AirBrief } from '../domain/brief.js';
import type { Household } from '../domain/household.js';
import type {
  AirSnapshot,
  GeoLocation,
  StandardPreference,
  StationSnapshot,
  WeatherSnapshot,
} from '../domain/types.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { TtlCache } from './cache.js';
import type { OpenMeteoClient } from './openMeteo.js';
import type { StationClient } from './openaq.js';

export interface BriefRequest {
  location: GeoLocation;
  household: Household;
  standard: StandardPreference;
}

export interface BriefService {
  getBrief(request: BriefRequest): Promise<AirBrief>;
  searchPlaces(query: string): Promise<GeoLocation[]>;
}

export interface BriefServiceOptions {
  client: OpenMeteoClient;
  /** Measured station data (OpenAQ). Without it, "now" is a labelled model estimate. */
  stations?: StationClient | null;
  logger: Logger;
  airTtlMs?: number;
  weatherTtlMs?: number;
  placesTtlMs?: number;
  maxEntries?: number;
}

/**
 * Coordinates are rounded to 2 decimals (~1 km) for cache keys: that is finer
 * than the ~10 km model grid, so accuracy is unchanged while nearby users share
 * cache entries, and we never keep a user's precise position.
 */
export const cacheKey = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(2)},${longitude.toFixed(2)}`;

/** One cache per upstream, each with its own freshness. */
function createCaches(options: BriefServiceOptions) {
  const maxEntries = options.maxEntries ?? 500;
  const airTtlMs = options.airTtlMs ?? 10 * 60_000;
  return {
    air: new TtlCache<AirSnapshot>(airTtlMs, maxEntries),
    weather: new TtlCache<WeatherSnapshot>(options.weatherTtlMs ?? 30 * 60_000, maxEntries),
    station: new TtlCache<StationSnapshot | null>(airTtlMs, maxEntries),
    places: new TtlCache<GeoLocation[]>(options.placesTtlMs ?? 24 * 60 * 60_000, maxEntries),
  };
}

/**
 * The value of an optional upstream, or null when it failed. Weather only powers the smog
 * outlook and stations only refine "now", so the brief degrades gracefully to the labelled
 * model estimate without them.
 */
function optional<T>(result: PromiseSettledResult<T>, name: string, logger: Logger): T | null {
  if (result.status === 'fulfilled') return result.value;
  logger.warn(`${name} unavailable, continuing without it`, {
    error: result.reason instanceof Error ? result.reason.message : 'unknown',
    // e.g. "openaq: HTTP 401" reveals a bad key without logging the key itself
    detail: result.reason instanceof AppError ? result.reason.detail : undefined,
  });
  return null;
}

/** Turns a place and household into a brief, with per-area caching and graceful fallbacks. */
export function createBriefService(options: BriefServiceOptions): BriefService {
  const { client, logger, stations } = options;
  const caches = createCaches(options);

  return {
    async getBrief({ location, household, standard }) {
      const { latitude, longitude } = location;
      const key = cacheKey(latitude, longitude);
      const [air, weather, station] = await Promise.allSettled([
        caches.air.getOrLoad(key, () => client.getAirQuality(latitude, longitude)),
        caches.weather.getOrLoad(key, () => client.getWeather(latitude, longitude)),
        stations
          ? caches.station.getOrLoad(key, () => stations.latest(latitude, longitude))
          : Promise.resolve(null),
      ]);
      if (air.status === 'rejected') throw air.reason;
      return buildBrief({
        location,
        air: air.value,
        weather: optional(weather, 'weather', logger),
        station: optional(station, 'stations', logger),
        household,
        standard,
      });
    },

    searchPlaces(query) {
      const normalised = query.trim().toLowerCase();
      return caches.places.getOrLoad(normalised, () => client.searchPlaces(normalised));
    },
  };
}
