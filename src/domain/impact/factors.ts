import type { CommuteMode } from '../household.js';

/**
 * "Clearly explain the direct impact of their choices": every number shown to
 * the user comes from the transparent factors below. They are typical urban
 * values, rounded, and labelled as estimates in the UI and README.
 *
 * Sources (approximate, per passenger-km unless noted):
 *  - CO₂ of fuel modes: ARAI/ICCT India fleet averages. Electric modes use
 *    energy per km × the local grid factor (see region.ts).
 *  - NOx / PM2.5 (exhaust + brake/tyre wear): BS-VI real-world estimates
 *    (ICCT 2021) and the EMEP/EEA non-exhaust guidebook.
 *  - Exposure ratio (in-vehicle ÷ ambient PM2.5): Goel et al. 2015,
 *    "On-road PM2.5 pollution exposure in multiple transport
 *    microenvironments in Delhi", Atmospheric Environment.
 *  - Inhalation rates: US EPA Exposure Factors Handbook (2011), ch. 6.
 */

export const WORK_DAYS_PER_WEEK = 5;
export const WORK_WEEKS_PER_YEAR = 48;
/** Commonly cited yearly CO₂ uptake of one mature tree. */
export const TREE_CO2_KG_PER_YEAR = 21;

export type TravelMode = Exclude<CommuteMode, 'none'> | 'carpool';

export interface ModeProfile {
  label: string;
  /** Direct (fuel) CO₂ per passenger-km. */
  co2KgPerKm: number;
  /** Grid electricity per passenger-km; its CO₂ depends on where you live. */
  kwhPerKm: number;
  noxGPerKm: number;
  pm25GPerKm: number;
  exposureRatio: number;
  inhalationM3PerHour: number;
  speedKmh: number;
  /** Longest one-way trip for which the mode is a realistic suggestion. */
  maxSuggestedKm?: number;
  active?: boolean;
}

const seated = { exposureRatio: 0.8, inhalationM3PerHour: 0.6, speedKmh: 24 } as const;

export const MODE_PROFILES: Readonly<Record<TravelMode, ModeProfile>> = {
  car_petrol: {
    label: 'Petrol car (alone)',
    co2KgPerKm: 0.15,
    kwhPerKm: 0,
    noxGPerKm: 0.06,
    pm25GPerKm: 0.02,
    ...seated,
  },
  car_diesel: {
    label: 'Diesel car (alone)',
    co2KgPerKm: 0.16,
    kwhPerKm: 0,
    noxGPerKm: 0.3,
    pm25GPerKm: 0.025,
    ...seated,
  },
  car_cng: {
    label: 'CNG car (alone)',
    co2KgPerKm: 0.12,
    kwhPerKm: 0,
    noxGPerKm: 0.05,
    pm25GPerKm: 0.015,
    ...seated,
  },
  ev_car: {
    label: 'Electric car (alone)',
    co2KgPerKm: 0,
    kwhPerKm: 0.14,
    noxGPerKm: 0,
    pm25GPerKm: 0.012,
    ...seated,
  },
  carpool: {
    label: 'Carpool (3 people)',
    co2KgPerKm: 0.05,
    kwhPerKm: 0,
    noxGPerKm: 0.02,
    pm25GPerKm: 0.007,
    ...seated,
  },
  two_wheeler: {
    label: 'Motorbike / scooter',
    co2KgPerKm: 0.045,
    kwhPerKm: 0,
    noxGPerKm: 0.1,
    pm25GPerKm: 0.012,
    exposureRatio: 1.3,
    inhalationM3PerHour: 0.8,
    speedKmh: 28,
  },
  auto_rickshaw: {
    label: 'Auto-rickshaw (CNG)',
    co2KgPerKm: 0.05,
    kwhPerKm: 0,
    noxGPerKm: 0.05,
    pm25GPerKm: 0.01,
    exposureRatio: 1.4,
    inhalationM3PerHour: 0.7,
    speedKmh: 20,
  },
  bus: {
    label: 'City bus',
    co2KgPerKm: 0.03,
    kwhPerKm: 0,
    noxGPerKm: 0.08,
    pm25GPerKm: 0.004,
    exposureRatio: 1.2,
    inhalationM3PerHour: 0.6,
    speedKmh: 15,
  },
  metro: {
    label: 'Metro / suburban rail',
    co2KgPerKm: 0,
    kwhPerKm: 0.028,
    noxGPerKm: 0,
    pm25GPerKm: 0.001,
    exposureRatio: 0.6,
    inhalationM3PerHour: 0.6,
    speedKmh: 30,
  },
  bicycle: {
    label: 'Bicycle',
    co2KgPerKm: 0,
    kwhPerKm: 0,
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
    kwhPerKm: 0,
    noxGPerKm: 0,
    pm25GPerKm: 0,
    exposureRatio: 1.2,
    inhalationM3PerHour: 1.2,
    speedKmh: 5,
    maxSuggestedKm: 3,
    active: true,
  },
};

/** Total CO₂ per passenger-km: fuel + grid electricity at the local carbon intensity. */
export function co2PerKm(profile: ModeProfile, gridCo2KgPerKwh: number): number {
  return profile.co2KgPerKm + profile.kwhPerKm * gridCo2KgPerKwh;
}

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

export const round = (value: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export const treesEquivalent = (co2KgPerYear: number): number =>
  Math.round(co2KgPerYear / TREE_CO2_KG_PER_YEAR);
