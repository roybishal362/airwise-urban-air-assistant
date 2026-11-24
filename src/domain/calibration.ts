import {
  POLLUTANT_IDS,
  type AirSnapshot,
  type PollutantId,
  type StationInfo,
  type StationSnapshot,
} from './types.js';

/**
 * Global air-quality models (Copernicus CAMS) capture the daily rhythm of
 * pollution but can badly under-read winter PM2.5 in South Asian cities
 * (e.g. Delhi in November shown as "Satisfactory"). Official monitoring
 * stations measure the real air now but cannot forecast. So AirWise
 * combines them:
 *
 *  - "Right now" uses ONLY measured station concentrations.
 *  - The hourly forecast keeps the model's shape but is rescaled, pollutant
 *    by pollutant, by the model's error at the hour the stations measured
 *    (ratio = measured ÷ modelled at that hour, clamped to a sane range).
 *  - Pollutants the stations do not measure are left out of the forecast
 *    rather than mixing anchored and un-anchored values.
 */

export const MIN_FACTOR = 0.2;
export const MAX_FACTOR = 8;

export interface DataSource {
  kind: 'station' | 'model';
  /** Human-readable source line for the UI. */
  label: string;
  provider: string;
  stations: StationInfo[];
  /** Per-pollutant forecast correction factors applied (station mode only). */
  factors: Partial<Record<PollutantId, number>>;
}

const MODEL_LABEL =
  'Modelled estimate (Copernicus CAMS via Open-Meteo), not a station measurement. Global models can under-read winter smog in South Asian cities, so check your official city monitor before relying on it.';

const clamp = (value: number): number => Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Latest measurement time across stations (local 'YYYY-MM-DDTHH:MM'), or ''. */
const latestMeasurement = (stations: readonly StationInfo[]): string =>
  stations
    .map((s) => s.measuredAtLocal)
    .filter(Boolean)
    .sort()
    .at(-1) ?? '';

export function describeStations(provider: string, stations: readonly StationInfo[]): string {
  const names = stations.map((s) => `${s.name} (${s.distanceKm.toFixed(1)} km)`).join(', ');
  const times = stations
    .map((s) => s.measuredAtLocal)
    .filter(Boolean)
    .sort()
    .map((t) => t.slice(11, 16));
  const [first] = times;
  const last = times.at(-1);
  const time = !first || !last ? '' : first === last ? ` at ${last}` : ` ${first}–${last}`;
  return `Measured${time} by ${stations.length} monitoring station${stations.length === 1 ? '' : 's'} via ${provider}: ${names}.`;
}

/**
 * Anchor the model snapshot to station measurements.
 * @param currentIndex index of the current hour in `air.hourly` (used when the
 *   measurement time is unknown or outside the model's hours)
 */
export function calibrateAir(
  air: AirSnapshot,
  station: StationSnapshot | null,
  currentIndex: number,
): { air: AirSnapshot; source: DataSource } {
  const measured = station?.concentrations ?? {};
  const hasParticles = typeof measured.pm2_5 === 'number' || typeof measured.pm10 === 'number';
  if (!station || !hasParticles || station.stations.length === 0) {
    return {
      air,
      source: {
        kind: 'model',
        label: MODEL_LABEL,
        provider: 'Copernicus CAMS',
        stations: [],
        factors: {},
      },
    };
  }

  // Compare like with like: the model at the hour the stations measured
  // (official data is published hours late), else the current hour.
  const measuredHour = latestMeasurement(station.stations).slice(0, 13);
  const measuredIndex = air.hourly.findIndex((h) => h.time.slice(0, 13) === measuredHour);
  const modelAtMeasurement =
    air.hourly[measuredIndex >= 0 ? measuredIndex : currentIndex]?.concentrations ?? air.current;
  const factors: Partial<Record<PollutantId, number>> = {};
  for (const id of POLLUTANT_IDS) {
    const real = measured[id];
    const model = modelAtMeasurement[id];
    if (typeof real !== 'number') continue;
    factors[id] = typeof model === 'number' && model > 0 ? round2(clamp(real / model)) : 1;
  }

  const hourly = air.hourly.map((hour) => {
    const concentrations: AirSnapshot['current'] = {};
    for (const id of POLLUTANT_IDS) {
      const factor = factors[id];
      const value = hour.concentrations[id];
      concentrations[id] =
        factor === undefined || typeof value !== 'number' ? null : value * factor;
    }
    return { time: hour.time, concentrations };
  });

  const current: AirSnapshot['current'] = {};
  for (const id of POLLUTANT_IDS)
    current[id] = typeof measured[id] === 'number' ? measured[id] : null;

  return {
    air: { ...air, current, hourly },
    source: {
      kind: 'station',
      label: describeStations(station.provider, station.stations),
      provider: station.provider,
      stations: station.stations,
      factors,
    },
  };
}
