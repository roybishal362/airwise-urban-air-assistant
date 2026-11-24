import type { Household } from './household.js';
import { windowLabel } from './time.js';
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

export function roomVolume(areaSqm: number): number {
  return areaSqm * MODEL.ceilingHeightM;
}

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

function option(
  id: IndoorOption['id'],
  label: string,
  cadr: number,
  volume: number,
  outdoor: number,
  baseline: number,
): IndoorOption {
  const indoor = estimateIndoorPm25(outdoor, cadr, volume);
  return {
    id,
    label,
    cadrM3h: cadr,
    airChangesPerHour: Math.round((cadr / volume) * 10) / 10,
    indoorPm25: indoor,
    reductionPct: baseline > 0 ? Math.round(((baseline - indoor) / baseline) * 100) : 0,
  };
}

function purifierHacks(input: IndoorInput, plan: Omit<IndoorPlan, 'hacks'>): IndoorHack[] {
  const { household, airLevel } = input;
  const current = plan.options.find((o) => o.id === 'current_purifier');
  const diy = plan.options.find((o) => o.id === 'diy_fan_filter');
  const hacks: IndoorHack[] = [];

  if (current) {
    const undersized = current.cadrM3h < plan.recommendedCadrM3h * 0.6;
    hacks.push({
      id: 'run-purifier',
      title: 'Run the purifier where the family sleeps',
      detail:
        'Keep it on high in the bedroom with the door closed, ideally from evening until morning when outdoor smog peaks.' +
        (undersized
          ? ` It is undersized for ${household.home.roomAreaSqm} m² (needs ~${plan.recommendedCadrM3h} m³/h); use it in a smaller room or add a DIY fan filter.`
          : ''),
      impact: `Indoor PM2.5 ≈ ${plan.baselineIndoorPm25} → ${current.indoorPm25} µg/m³ (−${current.reductionPct}%).`,
      priority: 1,
    });
  } else if (diy) {
    hacks.push({
      id: 'diy-fan-filter',
      title: 'Build a DIY fan filter tonight',
      detail: `Strap a MERV-13 or HEPA filter to the intake side of a box or table fan (about ₹1,500–2,500). If you buy a purifier, pick a CADR of at least ${plan.recommendedCadrM3h} m³/h for this room.`,
      impact: `Indoor PM2.5 ≈ ${plan.baselineIndoorPm25} → ${diy.indoorPm25} µg/m³ (−${diy.reductionPct}%).`,
      priority: airLevel >= 2 ? 1 : 3,
    });
  }
  return hacks;
}

function ventilationHack(input: IndoorInput): IndoorHack {
  const window = input.ventilationWindow;
  if (window && window.level <= 2) {
    return {
      id: 'ventilate-smart',
      title: `Open windows ${windowLabel(window.start, window.end, input.now ?? window.start)} only`,
      detail:
        'That is the cleanest stretch of the day. Close windows again before evening, when the smog layer settles.',
      impact: `Flushes indoor CO₂, moisture and cooking fumes while outdoor AQI averages ~${window.averageAqi}.`,
      priority: 2,
    };
  }
  const when = window
    ? ` around ${windowLabel(window.start, window.end, input.now ?? window.start)}`
    : '';
  return {
    id: 'ventilate-brief',
    title: 'Keep windows shut; air out briefly',
    detail: `Open windows for just 5–10 minutes${when} to release CO₂ and humidity, then close them.`,
    impact: 'Short airing refreshes the room without letting the room fill with outdoor smog.',
    priority: 2,
  };
}

function cookingHack(household: Household): IndoorHack {
  const fuel = household.lifestyle.cookingFuel;
  if (fuel === 'biomass' || fuel === 'kerosene') {
    return {
      id: 'clean-cooking',
      title: 'Switch cooking to LPG or induction',
      detail:
        'Solid fuel and kerosene stoves are the largest source of indoor pollution in many homes. Until you switch, cook with doors and windows open and keep children away from the stove.',
      impact:
        'Kitchen PM2.5 from wood or dung stoves often exceeds 300 µg/m³ (WHO); LPG or induction cuts this by roughly 70–90%.',
      priority: 1,
    };
  }
  return {
    id: 'kitchen-exhaust',
    title: 'Run the chimney or exhaust while cooking',
    detail:
      'Use lids, prefer boiling or steaming to deep-frying on high-AQI days, and keep the exhaust on for 10 minutes after cooking.',
    impact:
      'Frying and tempering (tadka) can push indoor PM2.5 above 200 µg/m³ for a short time; extraction removes most of it at source.',
    priority: 2,
  };
}

function heatingHack(household: Household): IndoorHack | null {
  switch (household.lifestyle.heating) {
    case 'wood_or_coal':
      return {
        id: 'no-angithi',
        title: 'Never burn coal or wood (angithi) in a closed room',
        detail:
          'Use an electric heater, layered clothing and draught stoppers instead. If you must burn fuel, never do it in a sleeping room.',
        impact:
          'Coal braziers release carbon monoxide that kills silently every winter, plus heavy smoke indoors.',
        priority: 1,
      };
    case 'kerosene':
    case 'gas':
      return {
        id: 'vent-combustion-heater',
        title: 'Ventilate when using a fuel heater',
        detail:
          'Keep a window slightly open and switch it off before sleeping; prefer an electric oil-filled heater.',
        impact:
          'Unvented heaters raise indoor NO₂ and CO; an electric heater adds no indoor pollution.',
        priority: 1,
      };
    default:
      return null;
  }
}

/** Build indoor estimates and a prioritised list of practical "hacks". */
export function buildIndoorPlan(input: IndoorInput): IndoorPlan {
  const { household, outdoorPm25, airLevel } = input;
  const volume = roomVolume(household.home.roomAreaSqm);
  const baseline = estimateIndoorPm25(outdoorPm25, 0, volume);
  const recommended = recommendedCadr(household.home.roomAreaSqm);

  const options: IndoorOption[] = [];
  if (household.home.hasAirPurifier && household.home.purifierCadrM3h > 0) {
    options.push(
      option(
        'current_purifier',
        'Your purifier',
        household.home.purifierCadrM3h,
        volume,
        outdoorPm25,
        baseline,
      ),
    );
  } else {
    options.push(
      option(
        'diy_fan_filter',
        'DIY fan + filter',
        MODEL.diyFanFilterCadrM3h,
        volume,
        outdoorPm25,
        baseline,
      ),
    );
  }
  options.push(
    option(
      'recommended_purifier',
      'Purifier rated for this room',
      recommended,
      volume,
      outdoorPm25,
      baseline,
    ),
  );

  const partial = {
    roomVolumeM3: Math.round(volume),
    outdoorPm25: Math.round(outdoorPm25),
    baselineIndoorPm25: baseline,
    recommendedCadrM3h: recommended,
    options,
  };

  const hacks: IndoorHack[] = [
    ...purifierHacks(input, partial),
    ventilationHack(input),
    cookingHack(household),
  ];

  const heating = heatingHack(household);
  if (heating) hacks.push(heating);

  if (airLevel >= 3) {
    const sealed = estimateIndoorPm25(outdoorPm25, 0, volume, MODEL.sealedInfiltrationAch);
    hacks.push({
      id: 'seal-gaps',
      title: 'Seal gaps around doors and windows',
      detail: 'Foam weather-strips and a rolled towel under the door cost under ₹300.',
      impact: `Halving leakage lowers indoor PM2.5 ≈ ${baseline} → ${sealed} µg/m³ even without a purifier.`,
      priority: 2,
    });
  }

  hacks.push({
    id: 'no-indoor-smoke',
    title: 'Skip incense, mosquito coils and candles on smog days',
    detail:
      'Use a mosquito net or electric repellent instead, and keep smoking out of the home entirely.',
    impact:
      'Burning one mosquito coil can emit as much PM2.5 as 75–137 cigarettes (Liu et al., Environ Health Perspect, 2003).',
    priority: airLevel >= 2 ? 2 : 3,
  });

  if (airLevel >= 2) {
    hacks.push({
      id: 'wet-cleaning',
      title: 'Damp-mop and dust with a wet cloth',
      detail: 'Dry sweeping throws settled dust back into the air; leave shoes at the door.',
      impact: 'Keeps settled smog particles from being kicked back up into the air you breathe.',
      priority: 3,
    });
  }

  hacks.push({
    id: 'plants-myth',
    title: 'Myth-buster: houseplants will not clean the air',
    detail: 'They are lovely, but filtration and source control are what work.',
    impact:
      'A 2019 review found you would need 10–1,000 plants per m² to match ordinary ventilation (Cummings & Waring, J Expo Sci Environ Epidemiol).',
    priority: 3,
  });

  hacks.sort((a, b) => a.priority - b.priority);
  return { ...partial, hacks };
}
