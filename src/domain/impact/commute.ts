import type { CommuteMode, Household } from '../household.js';
import { INDIA_GRID_CO2 } from '../region.js';
import type { SeverityLevel } from '../types.js';
import {
  MODE_PROFILES,
  WORK_DAYS_PER_WEEK,
  WORK_WEEKS_PER_YEAR,
  co2PerKm,
  round,
  type TravelMode,
} from './factors.js';

export interface ModeImpact {
  mode: TravelMode;
  label: string;
  minutesPerDay: number;
  co2KgPerWeek: number;
  noxGPerWeek: number;
  pm25EmittedGPerWeek: number;
  /** Micrograms of PM2.5 breathed in during the day's round trip. */
  inhaledPm25UgPerDay: number;
}

export interface CommuteAlternative extends ModeImpact {
  co2SavedKgPerYear: number;
  /** Negative = you breathe less pollution than today. */
  inhaledChangePct: number;
  /** False when today's air makes the switch raise your exposure too much. */
  suitableToday: boolean;
  note: string;
}

export interface CommuteComparison {
  current: ModeImpact;
  alternatives: CommuteAlternative[];
}

/** On polluted days we only recommend switches that do not raise exposure by more than this. */
export const MAX_EXPOSURE_INCREASE_PCT = 25;

/**
 * inhaled PM2.5 (µg) = ambient PM2.5 × in-vehicle exposure ratio × breathing rate × hours in transit
 */
export function computeModeImpact(
  mode: TravelMode,
  oneWayKm: number,
  ambientPm25: number,
  gridCo2KgPerKwh: number = INDIA_GRID_CO2,
): ModeImpact {
  const p = MODE_PROFILES[mode];
  const dailyKm = oneWayKm * 2;
  const hours = dailyKm / p.speedKmh;
  const weeklyKm = dailyKm * WORK_DAYS_PER_WEEK;
  return {
    mode,
    label: p.label,
    minutesPerDay: Math.round(hours * 60),
    co2KgPerWeek: round(weeklyKm * co2PerKm(p, gridCo2KgPerKwh)),
    noxGPerWeek: round(weeklyKm * p.noxGPerKm),
    pm25EmittedGPerWeek: round(weeklyKm * p.pm25GPerKm, 2),
    inhaledPm25UgPerDay: Math.round(ambientPm25 * p.exposureRatio * p.inhalationM3PerHour * hours),
  };
}

/** One honest sentence about the trade-off, consistent with `suitableToday`. */
export function alternativeNote(
  mode: TravelMode,
  inhaledChangePct: number,
  suitableToday: boolean,
): string {
  if (mode === 'ev_car') {
    return 'Consider it for your next vehicle: no tailpipe NOx in your neighbourhood.';
  }
  if (MODE_PROFILES[mode].active) {
    return suitableToday
      ? 'Zero emissions plus daily exercise; pick roads away from heavy traffic.'
      : 'Zero emissions, but you would breathe much more smog today: best on cleaner days.';
  }
  if (!suitableToday) {
    return 'Cuts emissions, but raises your exposure today: wear an N95 or wait for cleaner air.';
  }
  if (inhaledChangePct > 0)
    return 'Cuts emissions with a small rise in exposure: an N95 covers it.';
  return 'Lower emissions and similar or lower personal exposure.';
}

export const isCar = (mode: CommuteMode): boolean =>
  mode === 'car_petrol' || mode === 'car_diesel' || mode === 'car_cng' || mode === 'ev_car';

function candidateModes(current: Exclude<CommuteMode, 'none'>, oneWayKm: number): TravelMode[] {
  const candidates: TravelMode[] = ['metro', 'bus'];
  if (isCar(current)) candidates.push('carpool');
  if (current === 'car_petrol' || current === 'car_diesel' || current === 'car_cng') {
    candidates.push('ev_car');
  }
  for (const mode of ['bicycle', 'walk'] as const) {
    const limit = MODE_PROFILES[mode].maxSuggestedKm ?? Infinity;
    if (oneWayKm <= limit) candidates.push(mode);
  }
  return candidates.filter((m) => m !== current);
}

/**
 * Compare today's commute with realistic alternatives on three axes: CO₂
 * (climate), local emissions (smog) and the PM2.5 you personally inhale.
 * Active modes have zero emissions but a higher breathing rate, so on bad air
 * days we flag them as "better on cleaner days": a real trade-off we explain.
 */
export function compareCommute(
  household: Household,
  ambientPm25: number,
  airLevel: SeverityLevel,
  gridCo2KgPerKwh: number = INDIA_GRID_CO2,
): CommuteComparison | null {
  const { commuteMode, commuteKm } = household.lifestyle;
  if (commuteMode === 'none' || commuteKm <= 0) return null;

  const current = computeModeImpact(commuteMode, commuteKm, ambientPm25, gridCo2KgPerKwh);
  const alternatives = candidateModes(commuteMode, commuteKm)
    .map((mode): CommuteAlternative => {
      const impact = computeModeImpact(mode, commuteKm, ambientPm25, gridCo2KgPerKwh);
      const co2SavedKgPerYear = round(
        (current.co2KgPerWeek - impact.co2KgPerWeek) * WORK_WEEKS_PER_YEAR,
        0,
      );
      const inhaledChangePct =
        current.inhaledPm25UgPerDay > 0
          ? Math.round(
              ((impact.inhaledPm25UgPerDay - current.inhaledPm25UgPerDay) /
                current.inhaledPm25UgPerDay) *
                100,
            )
          : 0;
      const suitableToday = airLevel <= 1 || inhaledChangePct <= MAX_EXPOSURE_INCREASE_PCT;
      return {
        ...impact,
        co2SavedKgPerYear,
        inhaledChangePct,
        suitableToday,
        note: alternativeNote(mode, inhaledChangePct, suitableToday),
      };
    })
    .filter((alt) => alt.co2SavedKgPerYear > 0 || alt.inhaledChangePct < 0)
    // Health first: options that are safe today rank above bigger CO₂ savings.
    .sort(
      (a, b) =>
        Number(b.suitableToday) - Number(a.suitableToday) ||
        b.co2SavedKgPerYear - a.co2SavedKgPerYear,
    );

  return { current, alternatives };
}
