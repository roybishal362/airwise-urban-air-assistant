import type { Household } from './household.js';
import {
  MODEL,
  estimateIndoorPm25,
  type IndoorHack,
  type IndoorInput,
  type IndoorPlan,
  type Room,
} from './indoorModel.js';
import { windowLabel } from './time.js';
import type { SeverityLevel } from './types.js';

/** Practical indoor air-quality hacks, each with its estimated effect for this home. */

/** Purifier advice: use or size the current purifier, or build a DIY fan filter. */
export function purifierHacks(input: IndoorInput, plan: Omit<IndoorPlan, 'hacks'>): IndoorHack[] {
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

/** When to air the home, or to keep windows shut when no hour is clean enough. */
export function ventilationHack(input: IndoorInput): IndoorHack {
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

/** Cleaner cooking: switch from solid fuel or kerosene, or run the chimney or exhaust while cooking. */
export function cookingHack(household: Household): IndoorHack {
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

/** Cleaner winter heating; null when the home does not heat with fuel. */
export function heatingHack(household: Household): IndoorHack | null {
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

/** Low-cost habits that help in any home, chosen by how polluted the air is. */
export function everydayHacks(airLevel: SeverityLevel, room: Room): IndoorHack[] {
  const hacks: IndoorHack[] = [];
  if (airLevel >= 3) {
    const sealed = estimateIndoorPm25(room.outdoor, 0, room.volume, MODEL.sealedInfiltrationAch);
    hacks.push({
      id: 'seal-gaps',
      title: 'Seal gaps around doors and windows',
      detail: 'Foam weather-strips and a rolled towel under the door cost under ₹300.',
      impact: `Halving leakage lowers indoor PM2.5 ≈ ${String(room.baseline)} → ${String(sealed)} µg/m³ even without a purifier.`,
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
  return hacks;
}
