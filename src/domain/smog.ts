import { addHours, windowLabel } from './time.js';
import type { HourlyWeather, LocalTime } from './types.js';

/**
 * Winter smog is mostly a meteorology problem: on cold, calm nights the
 * atmospheric mixing layer collapses to a few tens of metres and acts like a
 * lid over the city's emissions. The standard way to quantify this is the
 * ventilation coefficient (VC = mixing height × wind speed, m²/s). Values below
 * ~2,000 m²/s mean pollutants barely disperse; above ~6,000 m²/s dispersion is
 * good (thresholds used in Indian and US smoke-management practice).
 */

export const POOR_VENTILATION_M2S = 2000;
export const GOOD_VENTILATION_M2S = 6000;
/** Without mixing-height data, winds below this are treated as stagnant. */
const CALM_WIND_KMH = 5;

export type Dispersion = 'poor' | 'moderate' | 'good';
export type TrapRisk = 'unknown' | 'low' | 'moderate' | 'high' | 'severe';

export interface DispersionWindow {
  start: LocalTime;
  end: LocalTime;
  ventilationM2s: number;
}

export interface SmogOutlook {
  available: boolean;
  trapRisk: TrapRisk;
  ventilationNowM2s: number | null;
  dispersionNow: Dispersion | null;
  mixingHeightNowM: number | null;
  windNowKmh: number | null;
  stagnantHours: number;
  hoursAnalysed: number;
  bestDispersion: DispersionWindow | null;
  fogLikely: boolean;
  explanation: string[];
}

/** Ventilation coefficient (m²/s) = mixing height × wind speed; null when either is missing or negative. */
export function ventilationCoefficient(
  mixingHeightM: number | null,
  windKmh: number | null,
): number | null {
  if (mixingHeightM === null || windKmh === null) return null;
  if (mixingHeightM < 0 || windKmh < 0) return null;
  return Math.round(mixingHeightM * (windKmh / 3.6));
}

/** Poor, moderate or good dispersion for a ventilation coefficient. */
export function classifyDispersion(vc: number): Dispersion {
  if (vc < POOR_VENTILATION_M2S) return 'poor';
  if (vc < GOOD_VENTILATION_M2S) return 'moderate';
  return 'good';
}

/** True when an hour's air barely mixes (low ventilation, or calm wind when that is unknown). */
function isStagnant(hour: HourlyWeather): boolean {
  const vc = ventilationCoefficient(hour.boundaryLayerM, hour.windKmh);
  if (vc !== null) return vc < POOR_VENTILATION_M2S;
  return hour.windKmh !== null && hour.windKmh < CALM_WIND_KMH;
}

/** Smog-trap risk from the share of stagnant hours ahead. */
function trapRiskFromShare(share: number): TrapRisk {
  if (share >= 0.75) return 'severe';
  if (share >= 0.5) return 'high';
  if (share >= 0.25) return 'moderate';
  return 'low';
}

/** Best 3-hour block for dispersion (highest mean VC). */
function bestDispersionWindow(hours: readonly HourlyWeather[]): DispersionWindow | null {
  const span = 3;
  let best: DispersionWindow | null = null;
  for (let i = 0; i + span <= hours.length; i += 1) {
    const slice = hours.slice(i, i + span);
    const values = slice.map((h) => ventilationCoefficient(h.boundaryLayerM, h.windKmh));
    if (values.some((v) => v === null)) continue;
    const mean = Math.round((values as number[]).reduce((s, v) => s + v, 0) / span);
    const first = slice[0];
    const last = slice[span - 1];
    if (!first || !last) continue;
    if (!best || mean > best.ventilationM2s) {
      best = { start: first.time, end: addHours(last.time, 1), ventilationM2s: mean };
    }
  }
  return best;
}

const UNKNOWN: SmogOutlook = {
  available: false,
  trapRisk: 'unknown',
  ventilationNowM2s: null,
  dispersionNow: null,
  mixingHeightNowM: null,
  windNowKmh: null,
  stagnantHours: 0,
  hoursAnalysed: 0,
  bestDispersion: null,
  fogLikely: false,
  explanation: ['Weather data is unavailable right now, so the smog-trap outlook is skipped.'],
};

/** Cold, near-saturated air: fog that turns smoke into dense smog. */
const isFoggy = (h: HourlyWeather): boolean =>
  h.humidityPct !== null && h.temperatureC !== null && h.humidityPct >= 90 && h.temperatureC <= 15;

/** Mixing height and wind right now (just the wind when mixing height is missing). */
function conditionsNow(now: HourlyWeather, ventilation: number | null): string[] {
  if (ventilation !== null && now.boundaryLayerM !== null && now.windKmh !== null) {
    return [
      `Right now the mixing layer is about ${String(Math.round(now.boundaryLayerM))} m deep with ${now.windKmh.toFixed(1)} km/h wind, ` +
        `a ventilation coefficient of ${ventilation.toLocaleString('en-US')} m²/s (${classifyDispersion(ventilation)} dispersion; below ${POOR_VENTILATION_M2S.toLocaleString('en-US')} m²/s pollution stays trapped near the ground).`,
    ];
  }
  return now.windKmh === null ? [] : [`Wind is ${now.windKmh.toFixed(1)} km/h right now.`];
}

interface OutlookFacts {
  now: HourlyWeather;
  stagnantHours: number;
  hours: number;
  trapRisk: TrapRisk;
  bestDispersion: DispersionWindow | null;
  fogLikely: boolean;
}

/** Stagnation, the best dispersion window and fog, in plain language. */
function outlookLines(f: OutlookFacts): string[] {
  const trapped = f.trapRisk === 'high' || f.trapRisk === 'severe';
  const lines = [
    `${String(f.stagnantHours)} of the next ${String(f.hours)} hours have stagnant air.` +
      (trapped
        ? ' This is a classic winter inversion: cold air near the ground sits under warmer air like a lid, so smoke and exhaust from the whole city accumulate.'
        : ''),
  ];
  if (f.bestDispersion) {
    lines.push(
      `Air disperses best around ${windowLabel(f.bestDispersion.start, f.bestDispersion.end, f.now.time)}, when sunshine lifts the mixing layer.`,
    );
  }
  if (f.fogLikely) {
    lines.push(
      'Cold, near-saturated air is forecast: fog can mix with smoke into dense smog, typically overnight and early morning.',
    );
  }
  return lines;
}

/** Analyse the next 24 hours of weather, starting at the current hour. */
export function analyzeSmog(hours: readonly HourlyWeather[]): SmogOutlook {
  const window = hours.slice(0, 24);
  const now = window[0];
  if (!now) return UNKNOWN;

  const stagnantHours = window.filter(isStagnant).length;
  const trapRisk = trapRiskFromShare(stagnantHours / window.length);
  const ventilationNow = ventilationCoefficient(now.boundaryLayerM, now.windKmh);
  const dispersionNow = ventilationNow === null ? null : classifyDispersion(ventilationNow);
  const bestDispersion = bestDispersionWindow(window);
  const fogLikely = window.some(isFoggy);
  const explanation = [
    ...conditionsNow(now, ventilationNow),
    ...outlookLines({
      now,
      stagnantHours,
      hours: window.length,
      trapRisk,
      bestDispersion,
      fogLikely,
    }),
  ];

  return {
    available: true,
    trapRisk,
    ventilationNowM2s: ventilationNow,
    dispersionNow,
    mixingHeightNowM: now.boundaryLayerM,
    windNowKmh: now.windKmh,
    stagnantHours,
    hoursAnalysed: window.length,
    bestDispersion,
    fogLikely,
    explanation,
  };
}
