import { assessVulnerability, type Household } from './household.js';
import type { CommuteComparison } from './impact/index.js';
import type { IndoorPlan } from './indoor.js';
import type { FamilyRisk } from './risk.js';
import type { SmogOutlook } from './smog.js';
import { clockLabel, dayQualifier, signedPercent, windowLabel } from './time.js';
import type { LocalTime, TimeWindow } from './types.js';

export interface DayWindows {
  /** Cleanest 1-hour slot between 06:00 and 21:00 (exercise). */
  outdoor: TimeWindow | null;
  /** Cleanest 2-hour daytime slot (airing the home). */
  ventilation: TimeWindow | null;
  /** Cleanest 1-hour slot between 14:00 and 19:00 (children's play). */
  play: TimeWindow | null;
  /** Most polluted 3-hour block in the next 24 h. */
  worst: TimeWindow | null;
}

export type RoutineTag = 'exposure' | 'emissions' | 'indoor';

export interface RoutineStep {
  id: string;
  when: string;
  title: string;
  detail: string;
  /** The direct impact of following this step. */
  why: string;
  tags: RoutineTag[];
}

export interface RoutineInput {
  household: Household;
  risk: FamilyRisk;
  windows: DayWindows;
  smog: SmogOutlook;
  commute: CommuteComparison | null;
  indoor: IndoorPlan;
  /** Current local time of the reading. */
  now: LocalTime;
}

function exerciseStep({ household, windows, now }: RoutineInput): RoutineStep | null {
  if (!household.lifestyle.exercisesOutdoors) return null;
  const sensitive = assessVulnerability(household).isSensitive;
  const window = windows.outdoor;
  const threshold = sensitive ? 1 : 2;
  if (window && window.level <= threshold) {
    return {
      id: 'exercise',
      when: windowLabel(window.start, window.end, now),
      title: 'Exercise outdoors in the cleanest hour',
      detail: 'Walk, run or cycle in a park or on a quiet street, away from main roads.',
      why: `AQI averages ~${window.averageAqi} then, the lowest of the day: the same workout means less pollution in your lungs.`,
      tags: ['exposure'],
    };
  }
  const best = window
    ? ` Even the cleanest hour (${windowLabel(window.start, window.end, now)}) reaches AQI ~${window.averageAqi}.`
    : '';
  return {
    id: 'exercise',
    when: 'Morning',
    title: 'Move your workout indoors today',
    detail: `Yoga, skipping, stair climbs or a home workout video.${best}`,
    why: 'Hard exercise makes you breathe 3–4 times more air, so outdoors today it would multiply the dose of fine particles you inhale.',
    tags: ['exposure'],
  };
}

function commuteStep({ household, risk, commute }: RoutineInput): RoutineStep | null {
  if (!commute) return null;
  if (risk.level >= 4 && household.lifestyle.workFromHomePossible) {
    return {
      id: 'commute',
      when: 'Commute',
      title: 'Work from home today',
      detail: 'Severe smog days are exactly when home-working helps most.',
      why: `Skips ${commute.current.inhaledPm25UgPerDay} µg of inhaled PM2.5 and ${(commute.current.co2KgPerWeek / 5).toFixed(1)} kg CO₂ today.`,
      tags: ['exposure', 'emissions'],
    };
  }
  const mode = household.lifestyle.commuteMode;
  const protection =
    mode === 'car_petrol' || mode === 'car_diesel' || mode === 'car_cng' || mode === 'ev_car'
      ? 'Keep windows up and AC on recirculate.'
      : 'Wear a well-fitted N95 mask; cloth and surgical masks do not stop fine particles.';
  const alternative = commute.alternatives.find(
    (a) => a.mode !== 'ev_car' && a.suitableToday && a.co2SavedKgPerYear > 0,
  );
  if (alternative && risk.level < 4) {
    return {
      id: 'commute',
      when: 'Commute',
      title: `Try the ${alternative.label.toLowerCase()} today`,
      detail: `${alternative.note} ${protection}`,
      why: `Saves ${((commute.current.co2KgPerWeek - alternative.co2KgPerWeek) / 5).toFixed(1)} kg CO₂ today; your inhaled PM2.5 changes by ${signedPercent(alternative.inhaledChangePct)}.`,
      tags: ['emissions', 'exposure'],
    };
  }
  return {
    id: 'commute',
    when: 'Commute',
    title: 'Protect yourself on the commute',
    detail: `${protection} Avoid peak-traffic stretches where you can.`,
    why: `You would otherwise inhale ~${commute.current.inhaledPm25UgPerDay} µg of PM2.5 on today's round trip.`,
    tags: ['exposure'],
  };
}

function ventilationStep({ indoor, windows, now }: RoutineInput): RoutineStep | null {
  const hack = indoor.hacks.find((h) => h.id.startsWith('ventilate'));
  if (!hack) return null;
  const window = windows.ventilation;
  return {
    id: 'ventilate',
    when: window ? windowLabel(window.start, window.end, now) : 'Midday',
    title: hack.title,
    detail: hack.detail,
    why: hack.impact,
    tags: ['indoor'],
  };
}

function playStep({ household, windows, now }: RoutineInput): RoutineStep | null {
  if (household.members.children === 0) return null;
  const window = windows.play;
  if (window && window.level <= 1) {
    return {
      id: 'play',
      when: windowLabel(window.start, window.end, now),
      title: 'Outdoor play time for the children',
      detail: 'Parks and courtyards beat roadside play areas.',
      why: `AQI ~${window.averageAqi} in this slot is safe for children.`,
      tags: ['exposure'],
    };
  }
  if (window && window.level === 2) {
    return {
      id: 'play',
      when: windowLabel(window.start, window.end, now),
      title: 'Short, gentle outdoor play only',
      detail: 'Keep it to about 30 minutes and calm games, away from traffic.',
      why: `This is the afternoon's cleanest slot (AQI ~${window.averageAqi}), but children inhale more pollution per kg than adults.`,
      tags: ['exposure'],
    };
  }
  return {
    id: 'play',
    when: 'Afternoon',
    title: 'Indoor play for the children today',
    detail: 'Board games, dancing, building blocks, or indoor sports halls.',
    why: window
      ? `Even the cleanest afternoon slot reaches AQI ~${window.averageAqi}, too high for growing lungs.`
      : 'No clean afternoon slot is forecast.',
    tags: ['exposure'],
  };
}

function eveningStep({ windows, smog, now }: RoutineInput): RoutineStep | null {
  const worst = windows.worst;
  const trapped = smog.trapRisk === 'high' || smog.trapRisk === 'severe';
  if (!worst || (worst.level <= 1 && !trapped)) return null;
  return {
    id: 'evening',
    when: `Before ${clockLabel(worst.start)}${dayQualifier(worst.start, now)}`,
    title: 'Close up the house before the smog peak',
    detail: `Keep windows shut through the peak (${windowLabel(worst.start, worst.end, now)}), and never burn leaves or garbage, yours or your society's.`,
    why: `AQI is forecast to reach ~${worst.peakAqi}${trapped ? ' while the inversion lid holds pollution over the city' : ''}; polluted air that gets indoors lingers for hours.`,
    tags: ['indoor', 'emissions'],
  };
}

function cookingStep({ household }: RoutineInput): RoutineStep {
  const dirty =
    household.lifestyle.cookingFuel === 'biomass' || household.lifestyle.cookingFuel === 'kerosene';
  return {
    id: 'cooking',
    when: 'Dinner',
    title: dirty ? 'Cook with maximum ventilation' : 'Cook with the exhaust on and lids down',
    detail: dirty
      ? 'Cook near an open door, keep children out of the kitchen, and plan the switch to LPG or induction.'
      : 'Steam or boil rather than deep-fry on smog days, and leave the exhaust on 10 minutes afterwards.',
    why: dirty
      ? 'Solid-fuel smoke is often worse than the smog outside; it is the single biggest exposure you control.'
      : 'Cooking fumes add to indoor PM2.5 exactly when windows are shut.',
    tags: ['indoor'],
  };
}

function bedtimeStep({ household, indoor }: RoutineInput): RoutineStep {
  const option = indoor.options[0];
  const filter = household.home.hasAirPurifier ? 'purifier' : 'DIY fan filter';
  const heatingWarning =
    household.lifestyle.heating === 'wood_or_coal'
      ? ' Never keep a coal or wood brazier in the bedroom (carbon-monoxide risk).'
      : '';
  return {
    id: 'bedtime',
    when: 'Bedtime',
    title: `Run the ${filter} in the bedroom, door closed`,
    detail: `You spend about a third of the day asleep, so this room matters most.${heatingWarning}`,
    why: option
      ? `Bedroom PM2.5 ≈ ${indoor.baselineIndoorPm25} → ${option.indoorPm25} µg/m³ (−${option.reductionPct}%) overnight.`
      : 'Cleaner air during sleep is the highest-value indoor protection.',
    tags: ['indoor'],
  };
}

/** Assemble a time-ordered daily plan that lowers exposure and emissions. */
export function buildRoutine(input: RoutineInput): RoutineStep[] {
  const steps = [
    exerciseStep(input),
    commuteStep(input),
    ventilationStep(input),
    playStep(input),
    eveningStep(input),
    cookingStep(input),
    bedtimeStep(input),
  ];
  return steps.filter((s): s is RoutineStep => s !== null);
}
