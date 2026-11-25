import { z } from 'zod';
import type {
  AirSnapshot,
  Concentrations,
  GeoLocation,
  HourlyWeather,
  WeatherSnapshot,
} from '../domain/types.js';
import { UpstreamError } from '../lib/errors.js';
import { fetchJson, type FetchFn } from '../lib/http.js';

/**
 * Client for the free, key-less Open-Meteo APIs (CAMS-based air quality,
 * weather incl. boundary-layer height, and geocoding). Hosts are fixed
 * constants, so user input can never redirect requests (no SSRF). Responses
 * are schema-validated because upstream data is untrusted input too.
 */

export const OPEN_METEO_HOSTS = {
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  weather: 'https://api.open-meteo.com/v1/forecast',
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
} as const;

const AIR_VARIABLES = [
  'pm10',
  'pm2_5',
  'carbon_monoxide',
  'nitrogen_dioxide',
  'sulphur_dioxide',
  'ozone',
] as const;

const WEATHER_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'boundary_layer_height',
] as const;

const series = z.array(z.number().nullable());
const optionalSeries = series.optional();

const airSchema = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    pm10: z.number().nullable().optional(),
    pm2_5: z.number().nullable().optional(),
    carbon_monoxide: z.number().nullable().optional(),
    nitrogen_dioxide: z.number().nullable().optional(),
    sulphur_dioxide: z.number().nullable().optional(),
    ozone: z.number().nullable().optional(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    pm10: optionalSeries,
    pm2_5: optionalSeries,
    carbon_monoxide: optionalSeries,
    nitrogen_dioxide: optionalSeries,
    sulphur_dioxide: optionalSeries,
    ozone: optionalSeries,
  }),
});

const weatherSchema = z.object({
  timezone: z.string(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: optionalSeries,
    relative_humidity_2m: optionalSeries,
    wind_speed_10m: optionalSeries,
    boundary_layer_height: optionalSeries,
  }),
});

const geocodingSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        country_code: z.string().optional(),
        admin1: z.string().optional(),
        timezone: z.string().optional(),
      }),
    )
    .optional(),
});

type AirRecord = Partial<Record<(typeof AIR_VARIABLES)[number], number | null | undefined>>;

/** One hourly air record as pollutant concentrations. */
function toConcentrations(record: AirRecord): Concentrations {
  return {
    pm2_5: record.pm2_5 ?? null,
    pm10: record.pm10 ?? null,
    no2: record.nitrogen_dioxide ?? null,
    so2: record.sulphur_dioxide ?? null,
    o3: record.ozone ?? null,
    co: record.carbon_monoxide ?? null,
  };
}

/** Validate an upstream response, or throw an UpstreamError naming the source. */
function parse<T>(schema: z.ZodType<T>, data: unknown, source: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UpstreamError(
      'The live air-data service returned unexpected data. Please try again shortly.',
      {
        detail: `schema mismatch from ${source}`,
      },
    );
  }
  return result.data;
}

export interface OpenMeteoClient {
  getAirQuality(latitude: number, longitude: number): Promise<AirSnapshot>;
  getWeather(latitude: number, longitude: number): Promise<WeatherSnapshot>;
  searchPlaces(query: string): Promise<GeoLocation[]>;
}

export interface OpenMeteoOptions {
  fetchFn?: FetchFn;
  timeoutMs: number;
  retries?: number;
}

/** Forecast URL for a point; timestamps come back in the place's local time. */
function pointUrl(
  base: string,
  latitude: number,
  longitude: number,
  params: Record<string, string>,
): URL {
  const url = new URL(base);
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('timezone', 'auto');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/** The value at an index, or null when missing. */
const valueAt = (values: (number | null)[] | undefined, i: number): number | null =>
  values?.[i] ?? null;

/** Open-Meteo air-quality response → current and hourly concentrations. */
function toAirSnapshot(data: z.infer<typeof airSchema>): AirSnapshot {
  const { hourly } = data;
  return {
    timezone: data.timezone,
    currentTime: data.current.time,
    current: toConcentrations(data.current),
    hourly: hourly.time.map((time, i) => ({
      time,
      concentrations: toConcentrations({
        pm10: valueAt(hourly.pm10, i),
        pm2_5: valueAt(hourly.pm2_5, i),
        carbon_monoxide: valueAt(hourly.carbon_monoxide, i),
        nitrogen_dioxide: valueAt(hourly.nitrogen_dioxide, i),
        sulphur_dioxide: valueAt(hourly.sulphur_dioxide, i),
        ozone: valueAt(hourly.ozone, i),
      }),
    })),
  };
}

/** Open-Meteo weather response → hourly temperature, humidity, wind and boundary-layer height. */
function toWeatherSnapshot(data: z.infer<typeof weatherSchema>): WeatherSnapshot {
  const { hourly } = data;
  const hours: HourlyWeather[] = hourly.time.map((time, i) => ({
    time,
    temperatureC: valueAt(hourly.temperature_2m, i),
    humidityPct: valueAt(hourly.relative_humidity_2m, i),
    windKmh: valueAt(hourly.wind_speed_10m, i),
    boundaryLayerM: valueAt(hourly.boundary_layer_height, i),
  }));
  return { timezone: data.timezone, hourly: hours };
}

/** Geocoding results → places with region, country and time zone. */
function toPlaces(data: z.infer<typeof geocodingSchema>): GeoLocation[] {
  return (data.results ?? []).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    countryCode: r.country_code,
    region: r.admin1,
    timezone: r.timezone,
  }));
}

/** Client for Open-Meteo's air-quality, weather and geocoding APIs (fixed hosts, timeouts, retries). */
export function createOpenMeteoClient({
  fetchFn = fetch,
  timeoutMs,
  retries = 1,
}: OpenMeteoOptions): OpenMeteoClient {
  const get = (url: URL) => fetchJson(url, fetchFn, { timeoutMs, retries });
  const forecast = { forecast_days: '2' };
  return {
    async getAirQuality(latitude, longitude) {
      const variables = AIR_VARIABLES.join(',');
      const url = pointUrl(OPEN_METEO_HOSTS.airQuality, latitude, longitude, {
        current: variables,
        hourly: variables,
        ...forecast,
      });
      return toAirSnapshot(parse(airSchema, await get(url), 'air-quality API'));
    },

    async getWeather(latitude, longitude) {
      const url = pointUrl(OPEN_METEO_HOSTS.weather, latitude, longitude, {
        hourly: WEATHER_VARIABLES.join(','),
        ...forecast,
      });
      return toWeatherSnapshot(parse(weatherSchema, await get(url), 'weather API'));
    },

    async searchPlaces(query) {
      const url = new URL(OPEN_METEO_HOSTS.geocoding);
      url.searchParams.set('name', query);
      url.searchParams.set('count', '5');
      url.searchParams.set('language', 'en');
      url.searchParams.set('format', 'json');
      return toPlaces(parse(geocodingSchema, await get(url), 'geocoding API'));
    },
  };
}
