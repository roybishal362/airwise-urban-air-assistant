import { timeSpan } from '../domain/time.js';
import type { Concentrations, PollutantId, StationInfo, StationSnapshot } from '../domain/types.js';
import { UpstreamError } from '../lib/errors.js';
import type { FetchFn } from '../lib/http.js';
import {
  PARAMETER_MAP,
  effectiveUnits,
  haversineKm,
  latestSchema,
  locationsSchema,
  toMicrograms,
  type Location,
  type Reading,
} from './openaqData.js';

export { effectiveUnits, haversineKm, toMicrograms } from './openaqData.js';

/**
 * Measured air quality from official monitoring stations via OpenAQ v3
 * (which republishes government networks such as India's CPCB/DPCC
 * stations). Free API key: https://explore.openaq.org/register.
 * Docs: https://docs.openaq.org (locations + latest endpoints).
 */

export const OPENAQ_BASE = 'https://api.openaq.org/v3';
const SEARCH_RADIUS_M = 25_000;

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

type IsFresh = (utc: string | undefined) => boolean;
type GetJson = (url: URL) => Promise<unknown>;

interface Candidate {
  loc: Location;
  distanceKm: number;
}

/** One usable measurement, already in µg/m³. */
interface StationReading {
  pollutant: PollutantId;
  value: number;
  measuredAtLocal: string;
}

const HOUR_MS = 3_600_000;
const PARTICLES = new Set(['pm25', 'pm10']);
/** Round to one decimal. */
const round1 = (value: number): number => Math.round(value * 10) / 10;
/** The error raised when station data cannot be used. */
const unavailable = (detail: string) =>
  new UpstreamError('Station data is unavailable right now.', { detail });

/** Reference monitors near a point (low-cost sensors are also filtered client-side). */
function locationsUrl(latitude: number, longitude: number): URL {
  const url = new URL(`${OPENAQ_BASE}/locations`);
  url.searchParams.set('coordinates', `${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  url.searchParams.set('radius', String(SEARCH_RADIUS_M));
  url.searchParams.set('limit', '100');
  url.searchParams.set('monitor', 'true');
  return url;
}

/** Fresh reference monitors that measure particles, nearest first. */
export function nearestStations(
  locations: readonly Location[],
  from: { latitude: number; longitude: number },
  isFresh: IsFresh,
): Candidate[] {
  return locations
    .filter((loc) => loc.isMonitor !== false && isFresh(loc.datetimeLast?.utc))
    .filter((loc) => loc.sensors.some((sensor) => PARTICLES.has(sensor.parameter.name)))
    .map((loc) => ({
      loc,
      distanceKm: haversineKm(
        from.latitude,
        from.longitude,
        loc.coordinates.latitude,
        loc.coordinates.longitude,
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Latest readings of each station, fetched in parallel. A station whose
 * request or payload fails is skipped (null); if every request fails, the
 * first error is raised so it gets logged.
 */
async function readLatest(
  get: GetJson,
  stations: readonly Candidate[],
): Promise<(Reading[] | null)[]> {
  const settled = await Promise.allSettled(
    stations.map(({ loc }) => get(new URL(`${OPENAQ_BASE}/locations/${String(loc.id)}/latest`))),
  );
  const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length > 0 && failures.length === settled.length) throw failures[0]?.reason;
  return settled.map((result) => {
    if (result.status === 'rejected') return null;
    const parsed = latestSchema.safeParse(result.value);
    return parsed.success ? parsed.data.results : null;
  });
}

/**
 * A reading in µg/m³, or null if its sensor is unknown or the value is
 * missing, negative, stale or in units we cannot convert.
 */
function toStationReading(
  loc: Location,
  reading: Reading,
  isFresh: IsFresh,
): StationReading | null {
  const sensor = loc.sensors.find((s) => s.id === reading.sensorsId);
  const pollutant = sensor ? PARAMETER_MAP[sensor.parameter.name] : undefined;
  if (!sensor || !pollutant) return null;
  if (reading.value === null || reading.value < 0 || !isFresh(reading.datetime.utc)) return null;
  const units = effectiveUnits(loc.provider?.name, pollutant, sensor.parameter.units);
  const value = toMicrograms(reading.value, units, pollutant);
  return value === null ? null : { pollutant, value, measuredAtLocal: reading.datetime.local };
}

/** A station's name, distance, provider and latest measurement time, for the source line. */
function stationInfo(
  { loc, distanceKm }: Candidate,
  readings: readonly StationReading[],
): StationInfo {
  const latest = timeSpan(readings.map((r) => r.measuredAtLocal))?.last ?? '';
  return {
    name: loc.name ?? `Station ${String(loc.id)}`,
    distanceKm: round1(distanceKm),
    measuredAtLocal: latest.slice(0, 16),
  };
}

/** Average each pollutant across all readings, to 0.1 µg/m³. */
function average(readings: readonly StationReading[]): Concentrations {
  const sums = new Map<PollutantId, { total: number; count: number }>();
  for (const { pollutant, value } of readings) {
    const slot = sums.get(pollutant) ?? { total: 0, count: 0 };
    sums.set(pollutant, { total: slot.total + value, count: slot.count + 1 });
  }
  const concentrations: Concentrations = {};
  for (const [pollutant, { total, count }] of sums)
    concentrations[pollutant] = round1(total / count);
  return concentrations;
}

/** Combine the stations' readings; null unless at least one station measured particles. */
function snapshot(
  stations: readonly Candidate[],
  latest: readonly (Reading[] | null)[],
  isFresh: IsFresh,
): StationSnapshot | null {
  const used: StationInfo[] = [];
  const readings: StationReading[] = [];
  stations.forEach((station, i) => {
    const usable = (latest[i] ?? [])
      .map((reading) => toStationReading(station.loc, reading, isFresh))
      .filter((reading): reading is StationReading => reading !== null);
    if (usable.length === 0) return;
    used.push(stationInfo(station, usable));
    readings.push(...usable);
  });
  const concentrations = average(readings);
  const hasParticles = concentrations.pm2_5 !== undefined || concentrations.pm10 !== undefined;
  return used.length > 0 && hasParticles
    ? { provider: 'OpenAQ', stations: used, concentrations }
    : null;
}

/** Client returning averaged readings from the nearest fresh reference stations, or null when there are none. */
export function createOpenAqClient(options: OpenAqOptions): StationClient {
  const {
    apiKey,
    timeoutMs,
    fetchFn = fetch,
    now = Date.now,
    maxAgeHours = 6,
    maxStations = 3,
  } = options;
  const isFresh: IsFresh = (utc) =>
    utc !== undefined && now() - Date.parse(utc) <= maxAgeHours * HOUR_MS;

  const get: GetJson = async (url) => {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { accept: 'application/json', 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw unavailable('openaq: network');
    }
    if (!response.ok) throw unavailable(`openaq: HTTP ${String(response.status)}`);
    return response.json();
  };

  return {
    async latest(latitude, longitude) {
      const locations = locationsSchema.safeParse(await get(locationsUrl(latitude, longitude)));
      if (!locations.success) throw unavailable('openaq: schema');
      const nearest = nearestStations(
        locations.data.results,
        { latitude, longitude },
        isFresh,
      ).slice(0, maxStations);
      return snapshot(nearest, await readLatest(get, nearest), isFresh);
    },
  };
}
