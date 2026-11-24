import { z } from 'zod';
import type { Concentrations, PollutantId, StationInfo, StationSnapshot } from '../domain/types.js';
import { UpstreamError } from '../lib/errors.js';
import type { FetchFn } from '../lib/http.js';

/**
 * Measured air quality from official monitoring stations via OpenAQ v3
 * (which republishes government networks such as India's CPCB/DPCC
 * stations). Free API key: https://explore.openaq.org/register.
 * Docs: https://docs.openaq.org (locations + latest endpoints).
 */

export const OPENAQ_BASE = 'https://api.openaq.org/v3';
const SEARCH_RADIUS_M = 25_000;

const PARAMETER_MAP: Readonly<Record<string, PollutantId>> = {
  pm25: 'pm2_5',
  pm10: 'pm10',
  no2: 'no2',
  so2: 'so2',
  o3: 'o3',
  co: 'co',
};

const MOLECULAR_WEIGHT: Readonly<Partial<Record<PollutantId, number>>> = {
  no2: 46.0055,
  so2: 64.066,
  o3: 47.9982,
  co: 28.01,
};

const timeSchema = z.object({ utc: z.string(), local: z.string() });

const locationsSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      isMonitor: z.boolean().optional(),
      provider: z.object({ name: z.string() }).nullable().optional(),
      coordinates: z.object({ latitude: z.number(), longitude: z.number() }),
      datetimeLast: timeSchema.nullable().optional(),
      sensors: z.array(
        z.object({
          id: z.number(),
          parameter: z.object({ name: z.string(), units: z.string() }),
        }),
      ),
    }),
  ),
});

const latestSchema = z.object({
  results: z.array(
    z.object({
      datetime: timeSchema,
      value: z.number().nullable(),
      sensorsId: z.number(),
    }),
  ),
});

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Convert a reported value to µg/m³ (gases at 25 °C, 1 atm). Null for unknown units. */
export function toMicrograms(value: number, units: string, pollutant: PollutantId): number | null {
  const unit = units.trim().toLowerCase().replace('μ', 'µ').replace('³', '3');
  if (unit === 'µg/m3' || unit === 'ug/m3') return value;
  if (unit === 'mg/m3') return value * 1000;
  const weight = MOLECULAR_WEIGHT[pollutant];
  if (weight === undefined) return null;
  if (unit === 'ppb') return (value * weight) / 24.45;
  if (unit === 'ppm') return (value * 1000 * weight) / 24.45;
  return null;
}

/**
 * The units a reading is really in. OpenAQ labels India's CPCB gas sensors
 * "ppb", but the values are CPCB's native units: µg/m³, and mg/m³ for CO.
 * Verified on live Delhi data (24 Nov 2026, 10 stations): NOx (ppb) equals
 * NO + NO2 only when NO and NO2 are read as µg/m³ (R K Puram: 1.9 + 26.3
 * µg/m³ = 15.5 ppb vs NOx 0.0156 ppm), and CO "0.87 ppb" is physically
 * impossible outdoors but a typical value in mg/m³.
 */
export function effectiveUnits(
  provider: string | undefined,
  pollutant: PollutantId,
  labelled: string,
): string {
  if (provider !== 'CPCB' || pollutant === 'pm2_5' || pollutant === 'pm10') return labelled;
  return pollutant === 'co' ? 'mg/m³' : 'µg/m³';
}

export interface StationClient {
  latest(latitude: number, longitude: number): Promise<StationSnapshot | null>;
}

export interface OpenAqOptions {
  apiKey: string;
  timeoutMs: number;
  fetchFn?: FetchFn;
  now?: () => number;
  /**
   * Ignore readings older than this. CPCB data reaches OpenAQ about 3–4 hours
   * after measurement, so 6 h keeps official stations while the UI shows the
   * real measurement time.
   */
  maxAgeHours?: number;
  /** Average over at most this many nearest stations. */
  maxStations?: number;
}

export function createOpenAqClient(options: OpenAqOptions): StationClient {
  const {
    apiKey,
    timeoutMs,
    fetchFn = fetch,
    now = Date.now,
    maxAgeHours = 6,
    maxStations = 3,
  } = options;

  async function get(url: URL): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { accept: 'application/json', 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new UpstreamError('Station data is unavailable right now.', {
        detail: 'openaq: network',
      });
    }
    if (!response.ok) {
      throw new UpstreamError('Station data is unavailable right now.', {
        detail: `openaq: HTTP ${response.status}`,
      });
    }
    return response.json();
  }

  const isFresh = (utc: string | undefined): boolean =>
    utc !== undefined && now() - Date.parse(utc) <= maxAgeHours * 3_600_000;

  return {
    async latest(latitude, longitude) {
      const url = new URL(`${OPENAQ_BASE}/locations`);
      url.searchParams.set('coordinates', `${latitude.toFixed(4)},${longitude.toFixed(4)}`);
      url.searchParams.set('radius', String(SEARCH_RADIUS_M));
      url.searchParams.set('limit', '100');
      // Reference-grade monitors only (low-cost sensors are also filtered below).
      url.searchParams.set('monitor', 'true');
      const parsed = locationsSchema.safeParse(await get(url));
      if (!parsed.success)
        throw new UpstreamError('Station data is unavailable right now.', {
          detail: 'openaq: schema',
        });

      const candidates = parsed.data.results
        .filter((loc) => loc.isMonitor !== false)
        .filter((loc) => isFresh(loc.datetimeLast?.utc))
        .filter((loc) => loc.sensors.some((s) => ['pm25', 'pm10'].includes(s.parameter.name)))
        .map((loc) => ({
          loc,
          distanceKm: haversineKm(
            latitude,
            longitude,
            loc.coordinates.latitude,
            loc.coordinates.longitude,
          ),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, maxStations);

      // Latest readings for the nearest stations, in parallel. One failing
      // station is skipped; if all fail, the error surfaces (and is logged).
      const settled = await Promise.allSettled(
        candidates.map(({ loc }) => get(new URL(`${OPENAQ_BASE}/locations/${loc.id}/latest`))),
      );
      const firstFailure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (firstFailure && settled.every((r) => r.status === 'rejected')) {
        throw firstFailure.reason;
      }

      const sums: Partial<Record<PollutantId, { total: number; count: number }>> = {};
      const stations: StationInfo[] = [];
      for (const [i, { loc, distanceKm }] of candidates.entries()) {
        const result = settled[i];
        if (result?.status !== 'fulfilled') continue;
        const latest = latestSchema.safeParse(result.value);
        if (!latest.success) continue;
        let used = false;
        let measuredAtLocal = '';
        for (const reading of latest.data.results) {
          const sensor = loc.sensors.find((s) => s.id === reading.sensorsId);
          const pollutant = sensor ? PARAMETER_MAP[sensor.parameter.name] : undefined;
          if (!sensor || !pollutant || reading.value === null || reading.value < 0) continue;
          if (!isFresh(reading.datetime.utc)) continue;
          const units = effectiveUnits(loc.provider?.name, pollutant, sensor.parameter.units);
          const value = toMicrograms(reading.value, units, pollutant);
          if (value === null) continue;
          const slot = (sums[pollutant] ??= { total: 0, count: 0 });
          slot.total += value;
          slot.count += 1;
          used = true;
          if (reading.datetime.local > measuredAtLocal) measuredAtLocal = reading.datetime.local;
        }
        if (used) {
          stations.push({
            name: loc.name ?? `Station ${loc.id}`,
            distanceKm: Math.round(distanceKm * 10) / 10,
            measuredAtLocal: measuredAtLocal.slice(0, 16),
          });
        }
      }

      const concentrations: Concentrations = {};
      for (const [pollutant, slot] of Object.entries(sums) as [
        PollutantId,
        { total: number; count: number },
      ][]) {
        concentrations[pollutant] = Math.round((slot.total / slot.count) * 10) / 10;
      }
      if (
        stations.length === 0 ||
        (concentrations.pm2_5 === undefined && concentrations.pm10 === undefined)
      ) {
        return null;
      }
      return { provider: 'OpenAQ', stations, concentrations };
    },
  };
}
