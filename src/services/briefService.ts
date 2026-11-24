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

export function createBriefService(options: BriefServiceOptions): BriefService {
  const { client, logger, maxEntries = 500 } = options;
  const airCache = new TtlCache<AirSnapshot>(options.airTtlMs ?? 10 * 60_000, maxEntries);
  const weatherCache = new TtlCache<WeatherSnapshot>(
    options.weatherTtlMs ?? 30 * 60_000,
    maxEntries,
  );
  const stationCache = new TtlCache<StationSnapshot | null>(
    options.airTtlMs ?? 10 * 60_000,
    maxEntries,
  );
  const placesCache = new TtlCache<GeoLocation[]>(
    options.placesTtlMs ?? 24 * 60 * 60_000,
    maxEntries,
  );

  return {
    async getBrief({ location, household, standard }) {
      const key = cacheKey(location.latitude, location.longitude);
      const stations = options.stations;
      const [air, weather, station] = await Promise.allSettled([
        airCache.getOrLoad(key, () => client.getAirQuality(location.latitude, location.longitude)),
        weatherCache.getOrLoad(key, () => client.getWeather(location.latitude, location.longitude)),
        stations
          ? stationCache.getOrLoad(key, () =>
              stations.latest(location.latitude, location.longitude),
            )
          : Promise.resolve(null),
      ]);
      if (air.status === 'rejected') throw air.reason;
      for (const [name, result] of [
        ['weather', weather],
        ['stations', station],
      ] as const) {
        if (result.status === 'rejected') {
          // Weather only powers the smog outlook and stations only refine "now":
          // degrade gracefully to the labelled model estimate without them.
          logger.warn(`${name} unavailable, continuing without it`, {
            error: result.reason instanceof Error ? result.reason.message : 'unknown',
            // e.g. "openaq: HTTP 401" reveals a bad key without logging the key itself
            detail: result.reason instanceof AppError ? result.reason.detail : undefined,
          });
        }
      }
      return buildBrief({
        location,
        air: air.value,
        weather: weather.status === 'fulfilled' ? weather.value : null,
        station: station.status === 'fulfilled' ? station.value : null,
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
