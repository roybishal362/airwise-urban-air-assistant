import {
  POLLUTANT_IDS,
  type AqiCategory,
  type AqiReading,
  type Concentrations,
  type PollutantId,
  type StandardId,
  type StandardPreference,
} from '../types.js';
import { STANDARDS, type ConcentrationUnit, type PollutantScale } from './standards.js';

/** Molar volume of an ideal gas at 25 °C and 1 atm, in litres. */
export const MOLAR_VOLUME_L = 24.45;

/** Molecular weights (g/mol) of the gases whose standards use ppb/ppm. */
export const MOLECULAR_WEIGHT: Readonly<Partial<Record<PollutantId, number>>> = {
  no2: 46.0055,
  so2: 64.066,
  o3: 47.9982,
  co: 28.01,
};

export const MAX_INDEX = 500;

/** Convert a µg/m³ concentration into the unit a breakpoint table expects. */
export function convertFromMicrograms(
  microgramsPerM3: number,
  unit: ConcentrationUnit,
  pollutant: PollutantId,
): number {
  switch (unit) {
    case 'ug/m3':
      return microgramsPerM3;
    case 'mg/m3':
      return microgramsPerM3 / 1000;
    case 'ppb':
    case 'ppm': {
      const weight = MOLECULAR_WEIGHT[pollutant];
      if (weight === undefined) {
        throw new Error(`Cannot convert ${pollutant} to ${unit}: not a gas`);
      }
      const ppb = (microgramsPerM3 * MOLAR_VOLUME_L) / weight;
      return unit === 'ppb' ? ppb : ppb / 1000;
    }
  }
}

/** Truncate (not round) to `decimals` places, as the EPA method requires. */
export function truncate(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // The epsilon guards against binary artefacts such as 35.4 * 10 = 353.99999.
  return Math.floor(value * factor + 1e-9) / factor;
}

/** Piecewise-linear interpolation of a concentration onto the index scale. */
export function subIndexFromScale(concentration: number, scale: PollutantScale): number {
  const c = truncate(concentration, scale.decimals);
  const band = scale.bands.find((b) => c <= b.cHigh);
  if (!band) return MAX_INDEX;
  // Values that fall in the gap between two bands (e.g. 30.5 for a 0–30 / 31–60
  // table) are clamped to the lower edge of the next band.
  const clamped = Math.max(c, band.cLow);
  const index =
    ((band.iHigh - band.iLow) / (band.cHigh - band.cLow)) * (clamped - band.cLow) + band.iLow;
  return Math.round(index);
}

export function subIndex(
  microgramsPerM3: number | null | undefined,
  pollutant: PollutantId,
  standardId: StandardId,
): number | null {
  if (microgramsPerM3 === null || microgramsPerM3 === undefined) return null;
  if (!Number.isFinite(microgramsPerM3) || microgramsPerM3 < 0) return null;
  const scale = STANDARDS[standardId].scales[pollutant];
  return subIndexFromScale(convertFromMicrograms(microgramsPerM3, scale.unit, pollutant), scale);
}

export function categoryFor(value: number, standardId: StandardId): AqiCategory {
  const { categories } = STANDARDS[standardId];
  const match = categories.find((c) => value <= c.max) ?? categories[categories.length - 1];
  if (!match) throw new Error(`Standard ${standardId} has no categories`);
  const { level, label, color, textColor, meaning } = match;
  return { level, label, color, textColor, meaning };
}

/**
 * Overall AQI = the highest pollutant sub-index; that pollutant is "dominant".
 * Ties resolve in POLLUTANT_IDS order (PM2.5 first) for deterministic output.
 */
export function calculateAqi(
  concentrations: Concentrations,
  standardId: StandardId,
): AqiReading | null {
  const subIndices: Partial<Record<PollutantId, number>> = {};
  let dominant: PollutantId | null = null;
  let max = -1;

  for (const pollutant of POLLUTANT_IDS) {
    const value = subIndex(concentrations[pollutant], pollutant, standardId);
    if (value === null) continue;
    subIndices[pollutant] = value;
    if (value > max) {
      max = value;
      dominant = pollutant;
    }
  }

  if (dominant === null) return null;
  return {
    standard: standardId,
    value: max,
    category: categoryFor(max, standardId),
    dominantPollutant: dominant,
    subIndices,
  };
}

const INDIAN_TIMEZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);

/** Pick the standard people in that place actually see on the news. */
export function resolveStandard(
  preference: StandardPreference,
  context: { countryCode?: string; timezone?: string },
): StandardId {
  if (preference !== 'auto') return preference;
  if (context.countryCode?.toUpperCase() === 'IN') return 'in';
  if (context.timezone && INDIAN_TIMEZONES.has(context.timezone)) return 'in';
  return 'us';
}
