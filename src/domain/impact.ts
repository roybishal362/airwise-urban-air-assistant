import type { CommuteMode, Household } from './household.js';
import { signedPercent } from './time.js';
import type { SeverityLevel } from './types.js';

/**
 * "Clearly explain the direct impact of their choices": every number shown to
 * the user comes from the transparent factors below. They are typical Indian
 * urban values, rounded, and labelled as estimates in the UI and README.
 *
 * Sources (approximate, per passenger-km unless noted):
 *  - CO₂: ARAI/ICCT India fleet averages; CEA grid factor 0.72 kg CO₂/kWh
 *    (CO₂ Baseline Database v19) for EV and metro.
 *  - NOx / PM2.5 (exhaust + brake/tyre wear): BS-VI real-world estimates
 *    (ICCT 2021) and EMEP/EEA non-exhaust guidebook.
 *  - Exposure ratio (in-vehicle ÷ ambient PM2.5): Goel et al. 2015,
 *    "On-road PM2.5 pollution exposure in multiple transport
 *    microenvironments in Delhi", Atmospheric Environment.
 *  - Inhalation rates: US EPA Exposure Factors Handbook (2011), ch. 6.
 */

export const GRID_CO2_KG_PER_KWH = 0.72;
export const WORK_DAYS_PER_WEEK = 5;
export const WORK_WEEKS_PER_YEAR = 48;
/** Commonly cited yearly CO₂ uptake of one mature tree. */
export const TREE_CO2_KG_PER_YEAR = 21;

export type TravelMode = Exclude<CommuteMode, 'none'> | 'carpool';

export interface ModeProfile {
  label: string;
  co2KgPerKm: number;
  noxGPerKm: number;
  pm25GPerKm: number;
  exposureRatio: number;
  inhalationM3PerHour: number;
  speedKmh: number;
  /** Longest one-way trip for which the mode is a realistic suggestion. */
  maxSuggestedKm?: number;
  active?: boolean;
}

export const MODE_PROFILES: Readonly<Record<TravelMode, ModeProfile>> = {
  car_petrol: {
    label: 'Petrol car (alone)',
    co2KgPerKm: 0.15,
    noxGPerKm: 0.06,
    pm25GPerKm: 0.02,
    exposureRatio: 0.8,
    inhalationM3PerHour: 0.6,
    speedKmh: 24,
  },
  car_diesel: {
    label: 'Diesel car (alone)',
    co2KgPerKm: 0.16,
    noxGPerKm: 0.3,
    pm25GPerKm: 0.025,
    exposureRatio: 0.8,
    inhalationM3PerHour: 0.6,
    speedKmh: 24,
  },
  car_cng: {
    label: 'CNG car (alone)',
    co2KgPerKm: 0.12,
    noxGPerKm: 0.05,
    pm25GPerKm: 0.015,
    exposureRatio: 0.8,
    inhalationM3PerHour: 0.6,
    speedKmh: 24,
  },
  ev_car: {
    label: 'Electric car (alone)',
    co2KgPerKm: 0.1,
    noxGPerKm: 0,
    pm25GPerKm: 0.012,
    exposureRatio: 0.8,
    inhalationM3PerHour: 0.6,
    speedKmh: 24,
  },
  carpool: {
    label: 'Carpool (3 people)',
    co2KgPerKm: 0.05,
    noxGPerKm: 0.02,
    pm25GPerKm: 0.007,
    exposureRatio: 0.8,
    inhalationM3PerHour: 0.6,
    speedKmh: 24,
  },
  two_wheeler: {
    label: 'Motorbike / scooter',
    co2KgPerKm: 0.045,
    noxGPerKm: 0.1,
    pm25GPerKm: 0.012,
    exposureRatio: 1.3,
    inhalationM3PerHour: 0.8,
    speedKmh: 28,
  },
  auto_rickshaw: {
    label: 'Auto-rickshaw (CNG)',
    co2KgPerKm: 0.05,
    noxGPerKm: 0.05,
    pm25GPerKm: 0.01,
    exposureRatio: 1.4,
    inhalationM3PerHour: 0.7,
    speedKmh: 20,
  },
  bus: {
    label: 'City bus',
    co2KgPerKm: 0.03,
    noxGPerKm: 0.08,
    pm25GPerKm: 0.004,
    exposureRatio: 1.2,
    inhalationM3PerHour: 0.6,
    speedKmh: 15,
  },
  metro: {
    label: 'Metro / suburban rail',
    co2KgPerKm: 0.02,
    noxGPerKm: 0,
    pm25GPerKm: 0.001,
    exposureRatio: 0.6,
    inhalationM3PerHour: 0.6,
    speedKmh: 30,
  },
  bicycle: {
    label: 'Bicycle',
    co2KgPerKm: 0,
    noxGPerKm: 0,
    pm25GPerKm: 0,
    exposureRatio: 1.2,
    inhalationM3PerHour: 1.8,
    speedKmh: 12,
    maxSuggestedKm: 12,
    active: true,
  },
  walk: {
    label: 'Walking',
    co2KgPerKm: 0,
    noxGPerKm: 0,
    pm25GPerKm: 0,
    exposureRatio: 1.2,
    inhalationM3PerHour: 1.2,
    speedKmh: 5,
    maxSuggestedKm: 3,
    active: true,
  },
};

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

/** On polluted days we only recommend switches that do not raise exposure by more than this. */
export const MAX_EXPOSURE_INCREASE_PCT = 25;

export interface CommuteComparison {
  current: ModeImpact;
  alternatives: CommuteAlternative[];
}

const round = (value: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export function computeModeImpact(
  mode: TravelMode,
  oneWayKm: number,
  ambientPm25: number,
): ModeImpact {
  const p = MODE_PROFILES[mode];
  const dailyKm = oneWayKm * 2;
  const hours = dailyKm / p.speedKmh;
  const weeklyKm = dailyKm * WORK_DAYS_PER_WEEK;
  return {
    mode,
    label: p.label,
    minutesPerDay: Math.round(hours * 60),
    co2KgPerWeek: round(weeklyKm * p.co2KgPerKm),
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
  if (mode === 'ev_car')
    return 'Consider it for your next vehicle: no tailpipe NOx in your neighbourhood.';
  if (MODE_PROFILES[mode].active) {
    return suitableToday
      ? 'Zero emissions plus daily exercise; pick roads away from heavy traffic.'
      : 'Zero emissions, but you would breathe much more smog today: best on cleaner days.';
  }
  if (!suitableToday)
    return 'Cuts emissions, but raises your exposure today: wear an N95 or wait for cleaner air.';
  if (inhaledChangePct > 0)
    return 'Cuts emissions with a small rise in exposure: an N95 covers it.';
  return 'Lower emissions and similar or lower personal exposure.';
}

const isCar = (mode: CommuteMode): boolean =>
  mode === 'car_petrol' || mode === 'car_diesel' || mode === 'car_cng' || mode === 'ev_car';

function candidateModes(current: Exclude<CommuteMode, 'none'>, oneWayKm: number): TravelMode[] {
  const candidates: TravelMode[] = ['metro', 'bus'];
  if (isCar(current)) candidates.push('carpool');
  if (current === 'car_petrol' || current === 'car_diesel' || current === 'car_cng')
    candidates.push('ev_car');
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
): CommuteComparison | null {
  const { commuteMode, commuteKm } = household.lifestyle;
  if (commuteMode === 'none' || commuteKm <= 0) return null;

  const current = computeModeImpact(commuteMode, commuteKm, ambientPm25);
  const alternatives = candidateModes(commuteMode, commuteKm)
    .map((mode): CommuteAlternative => {
      const impact = computeModeImpact(mode, commuteKm, ambientPm25);
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

export const treesEquivalent = (co2KgPerYear: number): number =>
  Math.round(co2KgPerYear / TREE_CO2_KG_PER_YEAR);

/** Factors for household actions (documented in the README "Impact model"). */
export const ACTION_FACTORS = {
  /** Open burning of leaves/garbage, PM2.5 g per kg burned (Wiedinmyer et al., 2014). */
  openBurningPm25GPerKg: 10,
  assumedBurnedKgPerWeek: 2,
  /** Traditional biomass stove: ~3 kg wood/day at ~7 g PM2.5/kg (Smith et al.). */
  biomassStoveKgPerDay: 3,
  biomassPm25GPerKg: 7,
  /** Coal/wood brazier: ~2 kg per winter night, 90 nights, ~5 g PM2.5/kg, 2.4 kg CO₂/kg. */
  brazierKgPerNight: 2,
  winterNights: 90,
  brazierPm25GPerKg: 5,
  coalCo2KgPerKg: 2.4,
  electricHeaterKwhPerNight: 1.5,
  /** Idling: petrol car ~0.7 L/h, two-wheeler ~0.15 L/h; 2.31 kg CO₂ per litre petrol. */
  idleMinutesPerDay: 10,
  carIdleLitresPerHour: 0.7,
  twoWheelerIdleLitresPerHour: 0.15,
  petrolCo2KgPerLitre: 2.31,
  savedKwhPerDay: 1,
} as const;

/** Household-level sustainable alternatives, each with a quantified impact. */
export function buildSustainableActions(
  household: Household,
  commute: CommuteComparison | null,
): SustainableAction[] {
  const f = ACTION_FACTORS;
  const actions: Omit<SustainableAction, 'community'>[] = [];
  const workDays = WORK_DAYS_PER_WEEK * WORK_WEEKS_PER_YEAR;

  const bestSwitch = commute?.alternatives.find((a) => a.mode !== 'ev_car' && a.suitableToday);
  if (commute && bestSwitch && bestSwitch.co2SavedKgPerYear > 0) {
    const nox = round(
      (commute.current.noxGPerWeek - bestSwitch.noxGPerWeek) * WORK_WEEKS_PER_YEAR,
      0,
    );
    const pm = round(
      (commute.current.pm25EmittedGPerWeek - bestSwitch.pm25EmittedGPerWeek) * WORK_WEEKS_PER_YEAR,
      0,
    );
    actions.push({
      id: 'switch-commute',
      title: `Commute by ${bestSwitch.label.toLowerCase()} instead of ${commute.current.label.toLowerCase()}`,
      category: 'transport',
      detail: bestSwitch.note,
      perHousehold: {
        co2KgPerYear: bestSwitch.co2SavedKgPerYear,
        pm25GPerYear: Math.max(pm, 0),
        noxGPerYear: Math.max(nox, 0),
      },
      impactStatement: `Avoids ~${bestSwitch.co2SavedKgPerYear} kg CO₂ a year (what ~${treesEquivalent(bestSwitch.co2SavedKgPerYear)} trees absorb) and changes the PM2.5 you inhale on the commute by ${signedPercent(bestSwitch.inhaledChangePct)}.`,
    });
  }

  if (commute && household.lifestyle.workFromHomePossible) {
    const co2 = round((commute.current.co2KgPerWeek / WORK_DAYS_PER_WEEK) * WORK_WEEKS_PER_YEAR, 0);
    const nox = round((commute.current.noxGPerWeek / WORK_DAYS_PER_WEEK) * WORK_WEEKS_PER_YEAR, 0);
    actions.push({
      id: 'wfh-day',
      title: 'Work from home one day a week (every day during smog alerts)',
      category: 'transport',
      detail: 'Cities under GRAP Stage III/IV in Delhi-NCR actively ask offices to do this.',
      perHousehold: {
        co2KgPerYear: co2,
        pm25GPerYear: round(
          (commute.current.pm25EmittedGPerWeek / WORK_DAYS_PER_WEEK) * WORK_WEEKS_PER_YEAR,
          0,
        ),
        noxGPerYear: nox,
      },
      impactStatement: `Avoids ~${co2} kg CO₂ a year and removes ${commute.current.inhaledPm25UgPerDay} µg of inhaled PM2.5 on each home-working day.`,
    });
  }

  const mode = household.lifestyle.commuteMode;
  if (isCar(mode) || mode === 'two_wheeler') {
    const litresPerHour =
      mode === 'two_wheeler' ? f.twoWheelerIdleLitresPerHour : f.carIdleLitresPerHour;
    const co2 = round(
      (f.idleMinutesPerDay / 60) * litresPerHour * f.petrolCo2KgPerLitre * workDays,
      0,
    );
    actions.push({
      id: 'no-idling',
      title: 'Switch off the engine at signals longer than 10 seconds',
      category: 'transport',
      detail: 'Delhi\'s "Red Light On, Gaadi Off" campaign targets exactly this.',
      perHousehold: { co2KgPerYear: co2, pm25GPerYear: null, noxGPerYear: null },
      impactStatement: `Skipping ~${f.idleMinutesPerDay} min of idling a day saves ~${co2} kg CO₂ a year and keeps exhaust away from pedestrians at junctions.`,
    });
  }

  if (household.lifestyle.cookingFuel === 'biomass') {
    const pm = f.biomassStoveKgPerDay * 365 * f.biomassPm25GPerKg;
    actions.push({
      id: 'clean-cooking-fuel',
      title: 'Move from wood or dung to LPG or induction cooking',
      category: 'home',
      detail: 'PMUY (Ujjwala) connections and induction cooktops make the switch affordable.',
      perHousehold: { co2KgPerYear: null, pm25GPerYear: pm, noxGPerYear: null },
      impactStatement: `Removes ~${(pm / 1000).toFixed(1)} kg of PM2.5 a year that is currently released inside or right next to your home.`,
    });
  }

  if (household.lifestyle.heating === 'wood_or_coal') {
    const pm = f.brazierKgPerNight * f.winterNights * f.brazierPm25GPerKg;
    const co2 = round(
      f.brazierKgPerNight * f.winterNights * f.coalCo2KgPerKg -
        f.electricHeaterKwhPerNight * f.winterNights * GRID_CO2_KG_PER_KWH,
      0,
    );
    actions.push({
      id: 'clean-heating',
      title: 'Replace the coal/wood brazier with an electric heater',
      category: 'home',
      detail: 'Add layered bedding and door draught-stoppers so the heater can stay on low.',
      perHousehold: { co2KgPerYear: co2, pm25GPerYear: pm, noxGPerYear: null },
      impactStatement: `Cuts ~${pm} g of PM2.5 per winter at home and removes the carbon-monoxide risk; net CO₂ falls by ~${co2} kg.`,
    });
  }

  const burnedPm = f.assumedBurnedKgPerWeek * 52 * f.openBurningPm25GPerKg;
  actions.push({
    id: 'never-burn-waste',
    title: 'Compost leaves and hand over waste: never burn it',
    category: 'waste',
    detail:
      "Report open burning to your municipal helpline or CPCB's Sameer app; organise a society compost pit.",
    perHousehold: { co2KgPerYear: null, pm25GPerYear: burnedPm, noxGPerYear: null },
    impactStatement: `Not burning ${f.assumedBurnedKgPerWeek} kg of leaves or garbage a week avoids ~${burnedPm} g of PM2.5 a year, about what a petrol car emits over ${Math.round(burnedPm / MODE_PROFILES.car_petrol.pm25GPerKm).toLocaleString('en-US')} km (exhaust + brakes + tyres).`,
  });

  const kwhCo2 = round(f.savedKwhPerDay * 365 * GRID_CO2_KG_PER_KWH, 0);
  actions.push({
    id: 'save-electricity',
    title: 'Save 1 kWh a day: heater thermostat, geyser timer, LED lights',
    category: 'energy',
    detail: "Most of India's winter electricity comes from coal plants upwind of cities.",
    perHousehold: { co2KgPerYear: kwhCo2, pm25GPerYear: null, noxGPerYear: null },
    impactStatement: `Avoids ~${kwhCo2} kg CO₂ a year (grid factor ${GRID_CO2_KG_PER_KWH} kg/kWh) plus the SO₂ and NOx from burning that coal.`,
  });

  return actions.map((a) => ({
    ...a,
    community: scale(a.perHousehold, household.communityHouseholds),
  }));
}
