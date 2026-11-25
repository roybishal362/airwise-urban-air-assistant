import type { Household } from '../household.js';
import type { Region } from '../region.js';
import { signedPercent } from '../time.js';
import { isCar, type CommuteComparison } from './commute.js';
import {
  ACTION_FACTORS,
  WORK_DAYS_PER_WEEK,
  WORK_WEEKS_PER_YEAR,
  round,
  treesEquivalent,
} from './factors.js';
import { homeActions } from './homeActions.js';

export interface Quantity {
  co2KgPerYear: number | null;
  pm25GPerYear: number | null;
  noxGPerYear: number | null;
}

export interface SustainableAction {
  id: string;
  title: string;
  category: 'transport' | 'home' | 'waste' | 'energy';
  detail: string;
  perHousehold: Quantity;
  /** perHousehold × the number of households acting together. */
  community: Quantity;
  impactStatement: string;
}

/** Multiply every figure of a quantity (e.g. by the number of households acting together). */
const scale = (q: Quantity, factor: number): Quantity => ({
  co2KgPerYear: q.co2KgPerYear === null ? null : round(q.co2KgPerYear * factor, 0),
  pm25GPerYear: q.pm25GPerYear === null ? null : round(q.pm25GPerYear * factor, 0),
  noxGPerYear: q.noxGPerYear === null ? null : round(q.noxGPerYear * factor, 0),
});

/** An action before its community totals are added. */
export type Draft = Omit<SustainableAction, 'community'>;

/** A weekly figure as a yearly one (48 working weeks), rounded. */
const perYear = (weekly: number): number => round(weekly * WORK_WEEKS_PER_YEAR, 0);
/** The yearly effect of changing one workday a week, from a five-day weekly figure. */
const perWorkdayYear = (weekly: number): number => perYear(weekly / WORK_DAYS_PER_WEEK);
/** Type guard that drops nulls from a list. */
const isPresent = <T>(value: T | null): value is T => value !== null;

/** Switch to the best alternative that is safe to use today (EVs are a purchase, not a switch). */
function switchCommuteAction(commute: CommuteComparison): Draft | null {
  const best = commute.alternatives.find((a) => a.mode !== 'ev_car' && a.suitableToday);
  if (!best || best.co2SavedKgPerYear <= 0) return null;
  const { current } = commute;
  return {
    id: 'switch-commute',
    title: `Commute by ${best.label.toLowerCase()} instead of ${current.label.toLowerCase()}`,
    category: 'transport',
    detail: best.note,
    perHousehold: {
      co2KgPerYear: best.co2SavedKgPerYear,
      pm25GPerYear: Math.max(perYear(current.pm25EmittedGPerWeek - best.pm25EmittedGPerWeek), 0),
      noxGPerYear: Math.max(perYear(current.noxGPerWeek - best.noxGPerWeek), 0),
    },
    impactStatement: `Avoids ~${String(best.co2SavedKgPerYear)} kg CO₂ a year (what ~${String(treesEquivalent(best.co2SavedKgPerYear))} trees absorb) and changes the PM2.5 you inhale on the commute by ${signedPercent(best.inhaledChangePct)}.`,
  };
}

/** Working from home one day a week, when the household can. */
function workFromHomeAction(
  household: Household,
  commute: CommuteComparison,
  region: Region,
): Draft | null {
  if (!household.lifestyle.workFromHomePossible) return null;
  const { current } = commute;
  const co2 = perWorkdayYear(current.co2KgPerWeek);
  return {
    id: 'wfh-day',
    title: 'Work from home one day a week (every day during smog alerts)',
    category: 'transport',
    detail: region.isDelhiNcr
      ? "Under GRAP Stage IV, Delhi-NCR offices can be told to halve attendance: you'll be ready."
      : 'Home-working on the worst smog days cuts both traffic and your own exposure.',
    perHousehold: {
      co2KgPerYear: co2,
      pm25GPerYear: perWorkdayYear(current.pm25EmittedGPerWeek),
      noxGPerYear: perWorkdayYear(current.noxGPerWeek),
    },
    impactStatement: `Avoids ~${String(co2)} kg CO₂ a year and removes ${String(current.inhaledPm25UgPerDay)} µg of inhaled PM2.5 on each home-working day.`,
  };
}

/** Switching the engine off while waiting, for households that commute by car or two-wheeler. */
function noIdlingAction(household: Household, region: Region): Draft | null {
  const mode = household.lifestyle.commuteMode;
  if (!isCar(mode) && mode !== 'two_wheeler') return null;
  const f = ACTION_FACTORS;
  const litresPerHour =
    mode === 'two_wheeler' ? f.twoWheelerIdleLitresPerHour : f.carIdleLitresPerHour;
  const workDays = WORK_DAYS_PER_WEEK * WORK_WEEKS_PER_YEAR;
  const co2 = round(
    (f.idleMinutesPerDay / 60) * litresPerHour * f.petrolCo2KgPerLitre * workDays,
    0,
  );
  return {
    id: 'no-idling',
    title: 'Switch off the engine at signals longer than 10 seconds',
    category: 'transport',
    detail: region.isIndia
      ? 'Delhi\'s "Red Light On, Gaadi Off" campaign targets exactly this.'
      : 'Idling engines put exhaust right where pedestrians and cyclists breathe.',
    perHousehold: { co2KgPerYear: co2, pm25GPerYear: null, noxGPerYear: null },
    impactStatement: `Skipping ~${String(f.idleMinutesPerDay)} min of idling a day saves ~${String(co2)} kg CO₂ a year and keeps exhaust away from pedestrians at junctions.`,
  };
}

/** The commute actions that apply: switch mode, work from home, no idling. */
function commuteActions(
  household: Household,
  commute: CommuteComparison | null,
  region: Region,
): Draft[] {
  if (!commute) return [];
  return [
    switchCommuteAction(commute),
    workFromHomeAction(household, commute, region),
    noIdlingAction(household, region),
  ].filter(isPresent);
}

/** Household-level sustainable alternatives, each with a quantified, location-aware impact. */
export function buildSustainableActions(
  household: Household,
  commute: CommuteComparison | null,
  region: Region,
): SustainableAction[] {
  return [...commuteActions(household, commute, region), ...homeActions(household, region)].map(
    (draft) => ({ ...draft, community: scale(draft.perHousehold, household.communityHouseholds) }),
  );
}

export interface CommunitySummary {
  households: number;
  perHousehold: { co2KgPerYear: number; pm25GPerYear: number };
  total: { co2KgPerYear: number; pm25GPerYear: number };
  treesEquivalent: number;
  /** Actions counted in the headline (overlapping transport options are not double-counted). */
  countedActionIds: string[];
}

/**
 * Headline impact if every household adopts the plan. Transport actions are
 * alternatives to each other (you can't both switch to the metro and stop
 * idling your car), so only the single largest transport saving is counted.
 */
export function summariseCommunity(
  actions: readonly SustainableAction[],
  households: number,
): CommunitySummary {
  const transport = actions
    .filter((a) => a.category === 'transport')
    .sort((a, b) => (b.perHousehold.co2KgPerYear ?? 0) - (a.perHousehold.co2KgPerYear ?? 0))[0];
  const counted = [
    ...(transport ? [transport] : []),
    ...actions.filter((a) => a.category !== 'transport'),
  ];
  const co2 = counted.reduce((sum, a) => sum + (a.perHousehold.co2KgPerYear ?? 0), 0);
  const pm25 = counted.reduce((sum, a) => sum + (a.perHousehold.pm25GPerYear ?? 0), 0);
  const totalCo2 = round(co2 * households, 0);
  return {
    households,
    perHousehold: { co2KgPerYear: round(co2, 0), pm25GPerYear: round(pm25, 0) },
    total: { co2KgPerYear: totalCo2, pm25GPerYear: round(pm25 * households, 0) },
    treesEquivalent: treesEquivalent(totalCo2),
    countedActionIds: counted.map((a) => a.id),
  };
}
