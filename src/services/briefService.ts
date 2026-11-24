import { buildBrief, type AirBrief } from '../domain/brief.js';
import type { Household } from '../domain/household.js';
import type {
  AirSnapshot,
  GeoLocation,
  StandardPreference,
  WeatherSnapshot,
} from '../domain/types.js';
import type { Logger } from '../lib/logger.js';
import { TtlCache } from './cache.js';
import type { OpenMeteoClient } from './openMeteo.js';

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

export function createBriefService(options: BriefServiceOptions): BriefService {
  const { client, logger, maxEntries = 500 } = options;
  const airCache = new TtlCache<AirSnapshot>(options.airTtlMs ?? 10 * 60_000, maxEntries);
  const weatherCache = new TtlCache<WeatherSnapshot>(
    options.weatherTtlMs ?? 30 * 60_000,
    maxEntries,
  );
  const placesCache = new TtlCache<GeoLocation[]>(
    options.placesTtlMs ?? 24 * 60 * 60_000,
    maxEntries,
  );

  return {
    async getBrief({ location, household, standard }) {
      const key = cacheKey(location.latitude, location.longitude);
      const [air, weather] = await Promise.allSettled([
        airCache.getOrLoad(key, () => client.getAirQuality(location.latitude, location.longitude)),
        weatherCache.getOrLoad(key, () => client.getWeather(location.latitude, location.longitude)),
      ]);
      if (air.status === 'rejected') throw air.reason;
      if (weather.status === 'rejected') {
        // Weather only powers the smog-trap outlook; degrade gracefully without it.
        logger.warn('weather unavailable, continuing without smog outlook', {
          error: weather.reason instanceof Error ? weather.reason.message : 'unknown',
        });
      }
      return buildBrief({
        location,
        air: air.value,
        weather: weather.status === 'fulfilled' ? weather.value : null,
        household,
        standard,
      });
    },

    searchPlaces(query) {
      const normalised = query.trim().toLowerCase();
      return placesCache.getOrLoad(normalised, () => client.searchPlaces(normalised));
    },
  };
}
