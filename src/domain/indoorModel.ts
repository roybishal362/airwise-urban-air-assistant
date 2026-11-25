import type { Household } from './household.js';
import type { LocalTime, SeverityLevel, TimeWindow } from './types.js';

/**
 * Indoor PM2.5 is estimated with the standard single-zone steady-state mass
 * balance (e.g. Riley et al., 2002; US EPA "Guide to Air Cleaners in the Home"):
 *
 *   C_in = P · λ · C_out / (λ + k + CADR / V)
 *
 * P = penetration factor, λ = infiltration (air changes per hour, windows shut),
 * k = indoor deposition rate, CADR / V = purifier air changes per hour.
 * These are estimates for a typical home, not measurements; the UI says so.
 */

export const MODEL = {
  ceilingHeightM: 2.7,
  penetration: 0.8,
  /** Indian homes are leaky; ~1 ACH with windows shut is typical in winter studies. */
  infiltrationAch: 1.0,
  /** Weather-stripping doors and windows roughly halves infiltration. */
  sealedInfiltrationAch: 0.5,
  depositionPerHour: 0.2,
  /** AHAM / EPA guidance: aim for ~5 clean-air changes per hour during smoke events. */
  targetAch: 5,
  /** Conservative CADR for a fan with one MERV-13/HEPA filter strapped to it (~90 cfm). */
  diyFanFilterCadrM3h: 150,
} as const;

/** Room volume in m³ for a floor area, at the model's ceiling height. */
export function roomVolume(areaSqm: number): number {
  return areaSqm * MODEL.ceilingHeightM;
}

/** Steady-state indoor PM2.5 with windows shut: outdoor air leaks in, deposition and filtration (CADR) remove it. */
export function estimateIndoorPm25(
  outdoorPm25: number,
  cadrM3h: number,
  volumeM3: number,
  infiltrationAch: number = MODEL.infiltrationAch,
): number {
  const cleaningAch = volumeM3 > 0 ? cadrM3h / volumeM3 : 0;
  const ratio =
    (MODEL.penetration * infiltrationAch) /
    (infiltrationAch + MODEL.depositionPerHour + cleaningAch);
  return Math.round(outdoorPm25 * ratio);
}

/** Clean-air delivery rate (m³/h) for the target air changes per hour, rounded up to 10. */
export function recommendedCadr(areaSqm: number): number {
  return Math.ceil((roomVolume(areaSqm) * MODEL.targetAch) / 10) * 10;
}

export interface IndoorOption {
  id: 'current_purifier' | 'diy_fan_filter' | 'recommended_purifier';
  label: string;
  cadrM3h: number;
  airChangesPerHour: number;
  indoorPm25: number;
  reductionPct: number;
}

export interface IndoorHack {
  id: string;
  title: string;
  detail: string;
  impact: string;
  priority: 1 | 2 | 3;
}

export interface IndoorPlan {
  roomVolumeM3: number;
  outdoorPm25: number;
  /** Estimated indoor PM2.5 with windows shut and no purifier. */
  baselineIndoorPm25: number;
  recommendedCadrM3h: number;
  options: IndoorOption[];
  hacks: IndoorHack[];
}

export interface IndoorInput {
  outdoorPm25: number;
  airLevel: SeverityLevel;
  household: Household;
  /** Cleanest daytime window, used to time window-opening. */
  ventilationWindow: TimeWindow | null;
  /** Current local time, so windows on the next day are labelled "tomorrow". */
  now?: LocalTime;
}

/** The room being modelled: its volume, the outdoor PM2.5 and indoor PM2.5 with no filtration. */
export interface Room {
  volume: number;
  outdoor: number;
  baseline: number;
}
