import {
  POLLUTANT_IDS,
  type AirSnapshot,
  type Concentrations,
  type PollutantId,
  type StationInfo,
  type StationSnapshot,
} from './types.js';
import { clockLabel, timeSpan } from './time.js';

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

/** Keep a correction factor within the allowed range. */
const clamp = (value: number): number => Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value));

/** Round to two decimals. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Latest measurement time across stations (local 'YYYY-MM-DDTHH:MM'), or ''. */
const latestMeasurement = (stations: readonly StationInfo[]): string =>
  timeSpan(measuredTimes(stations))?.last ?? '';

/** Measurement times of the stations that reported one. */
const measuredTimes = (stations: readonly StationInfo[]): string[] =>
  stations.map((s) => s.measuredAtLocal).filter(Boolean);

/** " at 10:00" for a single time, " 09:30–12:00" for a span, "" when unknown. */
function measuredWhen(first: string, last: string): string {
  if (!first || !last) return '';
  return first === last ? ` at ${last}` : ` ${first}–${last}`;
}

/** The on-screen source line: "Measured 09:30–12:00 by 3 monitoring stations via OpenAQ: …". */
export function describeStations(provider: string, stations: readonly StationInfo[]): string {
  const names = stations.map((s) => `${s.name} (${s.distanceKm.toFixed(1)} km)`).join(', ');
  const span = timeSpan(measuredTimes(stations));
  const time = span ? measuredWhen(clockLabel(span.first), clockLabel(span.last)) : '';
  return `Measured${time} by ${stations.length} monitoring station${stations.length === 1 ? '' : 's'} via ${provider}: ${names}.`;
}

type Factors = Partial<Record<PollutantId, number>>;

/** The labelled model-estimate source, used when no fresh station data is available. */
const modelSource = (): DataSource => ({
  kind: 'model',
  label: MODEL_LABEL,
  provider: 'Copernicus CAMS',
  stations: [],
  factors: {},
});

/** Station data is usable when at least one station reported a particle reading. */
function hasUsableMeasurements(station: StationSnapshot | null): station is StationSnapshot {
  if (!station || station.stations.length === 0) return false;
  const { pm2_5: pm25, pm10 } = station.concentrations;
  return typeof pm25 === 'number' || typeof pm10 === 'number';
}

/**
 * The model at the hour the stations measured (official data is published
 * hours late), so model and measurement are compared like with like; falls
 * back to the current hour.
 */
function modelAtMeasurement(
  air: AirSnapshot,
  stations: readonly StationInfo[],
  currentIndex: number,
): Concentrations {
  const hour = latestMeasurement(stations).slice(0, 13);
  const index = air.hourly.findIndex((h) => h.time.slice(0, 13) === hour);
  return air.hourly[index >= 0 ? index : currentIndex]?.concentrations ?? air.current;
}

/** measured ÷ modelled for every measured pollutant, clamped; 1 when the model has no value. */
function correctionFactors(measured: Concentrations, model: Concentrations): Factors {
  const factors: Factors = {};
  for (const id of POLLUTANT_IDS) {
    const real = measured[id];
    if (typeof real !== 'number') continue;
    const modelled = model[id];
    factors[id] = typeof modelled === 'number' && modelled > 0 ? round2(clamp(real / modelled)) : 1;
  }
  return factors;
}

/** Scale each pollutant by its factor; pollutants without a factor are left out. */
function scale(values: Concentrations, factors: Factors): Concentrations {
  const scaled: Concentrations = {};
  for (const id of POLLUTANT_IDS) {
    const factor = factors[id];
    const value = values[id];
    scaled[id] = factor === undefined || typeof value !== 'number' ? null : value * factor;
  }
  return scaled;
}

/** Only what the stations measured; every other pollutant is null. */
function measuredOnly(measured: Concentrations): Concentrations {
  const current: Concentrations = {};
  for (const id of POLLUTANT_IDS) {
    const value = measured[id];
    current[id] = typeof value === 'number' ? value : null;
  }
  return current;
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
  if (!hasUsableMeasurements(station)) return { air, source: modelSource() };
  const factors = correctionFactors(
    station.concentrations,
    modelAtMeasurement(air, station.stations, currentIndex),
  );
  return {
    air: {
      ...air,
      current: measuredOnly(station.concentrations),
      hourly: air.hourly.map((hour) => ({
        time: hour.time,
        concentrations: scale(hour.concentrations, factors),
      })),
    },
    source: {
      kind: 'station',
      label: describeStations(station.provider, station.stations),
      provider: station.provider,
      stations: station.stations,
      factors,
    },
  };
}
