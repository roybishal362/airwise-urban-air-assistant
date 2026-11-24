import { assessVulnerability, type Household } from './household.js';
import { MODE_PROFILES, type CommuteComparison } from './impact/index.js';
import { signedPercent, windowLabel } from './time.js';
import type { AqiReading, LocalTime, PollutantId } from './types.js';
import type { DayWindows } from './routine.js';

/**
 * "Today at a glance": the five decisions a family makes every smog day,
 * each reduced to one clear answer with a tone the UI can colour.
 */
export type GlanceTone = 'good' | 'caution' | 'bad';

export interface GlanceTile {
  id: 'mask' | 'windows' | 'exercise' | 'kids' | 'commute';
  label: string;
  value: string;
  detail: string;
  tone: GlanceTone;
}

export interface GlanceInput {
  reading: AqiReading;
  windows: DayWindows;
  commute: CommuteComparison | null;
  household: Household;
  now: LocalTime;
}

const GASES: ReadonlySet<PollutantId> = new Set(['o3', 'no2', 'so2', 'co']);

function maskTile({ reading }: GlanceInput): GlanceTile {
  const level = reading.category.level;
  if (level <= 1) {
    return {
      id: 'mask',
      label: 'Mask',
      value: 'Not needed',
      detail: 'Air is clean enough today.',
      tone: 'good',
    };
  }
  if (GASES.has(reading.dominantPollutant)) {
    return {
      id: 'mask',
      label: 'Mask',
      value: 'Limit time outside',
      detail: 'Today’s main pollutant is a gas that masks do not filter.',
      tone: 'caution',
    };
  }
  return {
    id: 'mask',
    label: 'Mask',
    value: level === 2 ? 'N95 for sensitive' : 'N95 outdoors',
    detail: 'A well-fitted N95 blocks most fine particles; cloth masks do not.',
    tone: level === 2 ? 'caution' : 'bad',
  };
}

function windowsTile({ windows, now }: GlanceInput): GlanceTile {
  const w = windows.ventilation;
  if (w && w.level <= 2) {
    return {
      id: 'windows',
      label: 'Windows',
      value: `Open ${windowLabel(w.start, w.end, now)}`,
      detail: `Cleanest stretch to air the home (AQI ~${w.averageAqi}).`,
      tone: 'good',
    };
  }
  return {
    id: 'windows',
    label: 'Windows',
    value: 'Keep shut',
    detail: 'Air out for 5–10 minutes only at the cleanest hour.',
    tone: 'bad',
  };
}

function exerciseTile({ windows, household, now }: GlanceInput): GlanceTile {
  const w = windows.outdoor;
  const threshold = assessVulnerability(household).isSensitive ? 1 : 2;
  if (w && w.level <= threshold) {
    return {
      id: 'exercise',
      label: 'Exercise',
      value: `Outdoors ${windowLabel(w.start, w.end, now)}`,
      detail: `The day’s cleanest hour (AQI ~${w.averageAqi}).`,
      tone: 'good',
    };
  }
  return {
    id: 'exercise',
    label: 'Exercise',
    value: 'Indoors today',
    detail: w
      ? `Even the cleanest hour reaches AQI ~${w.averageAqi}.`
      : 'No clean hour is forecast.',
    tone: 'bad',
  };
}

function kidsTile({ windows, household, now }: GlanceInput): GlanceTile | null {
  if (household.members.children === 0) return null;
  const w = windows.play;
  if (w && w.level <= 1) {
    return {
      id: 'kids',
      label: 'Kids outside',
      value: `Play ${windowLabel(w.start, w.end, now)}`,
      detail: `Safe slot for children (AQI ~${w.averageAqi}).`,
      tone: 'good',
    };
  }
  if (w && w.level === 2) {
    return {
      id: 'kids',
      label: 'Kids outside',
      value: `Short play ${windowLabel(w.start, w.end, now)}`,
      detail: 'Keep it gentle and about 30 minutes.',
      tone: 'caution',
    };
  }
  return {
    id: 'kids',
    label: 'Kids outside',
    value: 'Indoor play',
    detail: 'Too polluted for growing lungs.',
    tone: 'bad',
  };
}

function commuteTile({ commute }: GlanceInput): GlanceTile | null {
  if (!commute) return null;
  const best = commute.alternatives.find(
    (a) => a.mode !== 'ev_car' && a.suitableToday && a.co2SavedKgPerYear > 0,
  );
  if (best) {
    return {
      id: 'commute',
      label: 'Commute',
      value: `Try ${MODE_PROFILES[best.mode].label.split(' (')[0]?.toLowerCase() ?? best.label}`,
      detail: `${best.co2SavedKgPerYear} kg CO₂ a year less; your exposure ${signedPercent(best.inhaledChangePct)}.`,
      tone: 'good',
    };
  }
  return {
    id: 'commute',
    label: 'Commute',
    value: 'Protect yourself',
    detail: 'You already use a low-emission mode; wear an N95 on bad days.',
    tone: 'caution',
  };
}

export function buildGlance(input: GlanceInput): GlanceTile[] {
  return [
    maskTile(input),
    windowsTile(input),
    exerciseTile(input),
    kidsTile(input),
    commuteTile(input),
  ].filter((tile): tile is GlanceTile => tile !== null);
}

/** Berkeley Earth: breathing 22 µg/m³ of PM2.5 for a day ≈ smoking one cigarette. */
export const PM25_PER_CIGARETTE = 22;
/** WHO 2021 air-quality guideline: 24-hour mean PM2.5 of 15 µg/m³. */
export const WHO_PM25_24H = 15;

export interface ExposureEquivalents {
  pm25: number;
  /** Cigarettes a day if this concentration persisted for 24 hours. */
  cigarettesPerDay: number;
  /** How many times the WHO 24-hour guideline. */
  whoMultiple: number;
}

export function exposureEquivalents(pm25: number): ExposureEquivalents {
  const safe = Math.max(0, pm25);
  return {
    pm25: Math.round(safe),
    cigarettesPerDay: Math.round((safe / PM25_PER_CIGARETTE) * 10) / 10,
    whoMultiple: Math.round((safe / WHO_PM25_24H) * 10) / 10,
  };
}
