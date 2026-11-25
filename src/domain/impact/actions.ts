import type { Household } from '../household.js';
import type { Region } from '../region.js';
import { signedPercent } from '../time.js';
import { isCar, type CommuteComparison } from './commute.js';
import {
  ACTION_FACTORS,
  MODE_PROFILES,
  WORK_DAYS_PER_WEEK,
  WORK_WEEKS_PER_YEAR,
  round,
  treesEquivalent,
} from './factors.js';

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

const scale = (q: Quantity, factor: number): Quantity => ({
  co2KgPerYear: q.co2KgPerYear === null ? null : round(q.co2KgPerYear * factor, 0),
  pm25GPerYear: q.pm25GPerYear === null ? null : round(q.pm25GPerYear * factor, 0),
  noxGPerYear: q.noxGPerYear === null ? null : round(q.noxGPerYear * factor, 0),
});

type Draft = Omit<SustainableAction, 'community'>;

const perYear = (weekly: number): number => round(weekly * WORK_WEEKS_PER_YEAR, 0);
const perWorkdayYear = (weekly: number): number => perYear(weekly / WORK_DAYS_PER_WEEK);
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

function homeActions(household: Household, region: Region): Draft[] {
  const f = ACTION_FACTORS;
  const drafts: Draft[] = [];
  if (household.lifestyle.cookingFuel === 'biomass') {
    const pm = f.biomassStoveKgPerDay * 365 * f.biomassPm25GPerKg;
    drafts.push({
      id: 'clean-cooking-fuel',
      title: 'Move from wood or dung to LPG or induction cooking',
      category: 'home',
      detail: region.isIndia
        ? 'PMUY (Ujjwala) connections and induction cooktops make the switch affordable.'
        : 'LPG and induction cooktops are widely available, low-smoke alternatives.',
      perHousehold: { co2KgPerYear: null, pm25GPerYear: pm, noxGPerYear: null },
      impactStatement: `Removes ~${(pm / 1000).toFixed(1)} kg of PM2.5 a year that is currently released inside or right next to your home.`,
    });
  }

  if (household.lifestyle.heating === 'wood_or_coal') {
    const pm = f.brazierKgPerNight * f.winterNights * f.brazierPm25GPerKg;
    const co2 = round(
      f.brazierKgPerNight * f.winterNights * f.coalCo2KgPerKg -
        f.electricHeaterKwhPerNight * f.winterNights * region.gridCo2KgPerKwh,
      0,
    );
    drafts.push({
      id: 'clean-heating',
      title: 'Replace the coal/wood brazier with an electric heater',
      category: 'home',
      detail: 'Add layered bedding and door draught-stoppers so the heater can stay on low.',
      perHousehold: { co2KgPerYear: co2, pm25GPerYear: pm, noxGPerYear: null },
      impactStatement: `Cuts ~${pm} g of PM2.5 per winter at home and removes the carbon-monoxide risk; net CO₂ falls by ~${co2} kg.`,
    });
  }

  const burnedPm = f.assumedBurnedKgPerWeek * 52 * f.openBurningPm25GPerKg;
  drafts.push({
    id: 'never-burn-waste',
    title: 'Compost leaves and hand over waste: never burn it',
    category: 'waste',
    detail: region.isIndia
      ? "Report open burning to your municipal helpline or CPCB's Sameer app; organise a society compost pit."
      : 'Report open burning to your local council; organise a neighbourhood compost scheme.',
    perHousehold: { co2KgPerYear: null, pm25GPerYear: burnedPm, noxGPerYear: null },
    impactStatement: `Not burning ${f.assumedBurnedKgPerWeek} kg of leaves or garbage a week avoids ~${burnedPm} g of PM2.5 a year, about what a petrol car emits over ${Math.round(burnedPm / MODE_PROFILES.car_petrol.pm25GPerKm).toLocaleString('en-US')} km (exhaust + brakes + tyres).`,
  });

  const kwhCo2 = round(f.savedKwhPerDay * 365 * region.gridCo2KgPerKwh, 0);
  drafts.push({
    id: 'save-electricity',
    title: 'Save 1 kWh a day: heater thermostat, geyser timer, LED lights',
    category: 'energy',
    detail: region.isIndia
      ? "Most of India's winter electricity comes from coal plants upwind of cities."
      : `Your grid emits about ${region.gridCo2KgPerKwh} kg CO₂ for every kWh you use.`,
    perHousehold: { co2KgPerYear: kwhCo2, pm25GPerYear: null, noxGPerYear: null },
    impactStatement: `Avoids ~${kwhCo2} kg CO₂ a year (grid factor ${region.gridCo2KgPerKwh} kg/kWh) plus the pollutants from generating that power.`,
  });
  return drafts;
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
