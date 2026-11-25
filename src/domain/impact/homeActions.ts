import type { Household } from '../household.js';
import type { Region } from '../region.js';
import type { Draft } from './actions.js';
import { ACTION_FACTORS, MODE_PROFILES, round } from './factors.js';

/** Home, waste and energy actions, each with a quantified, location-aware impact. */

/** Moving from wood or dung to LPG or induction cooking; null for other fuels. */
function cleanCookingAction(household: Household, region: Region): Draft | null {
  const f = ACTION_FACTORS;
  if (household.lifestyle.cookingFuel === 'biomass') {
    const pm = f.biomassStoveKgPerDay * 365 * f.biomassPm25GPerKg;
    return {
      id: 'clean-cooking-fuel',
      title: 'Move from wood or dung to LPG or induction cooking',
      category: 'home',
      detail: region.isIndia
        ? 'PMUY (Ujjwala) connections and induction cooktops make the switch affordable.'
        : 'LPG and induction cooktops are widely available, low-smoke alternatives.',
      perHousehold: { co2KgPerYear: null, pm25GPerYear: pm, noxGPerYear: null },
      impactStatement: `Removes ~${(pm / 1000).toFixed(1)} kg of PM2.5 a year that is currently released inside or right next to your home.`,
    };
  }
  return null;
}

/** Replacing a coal or wood brazier with an electric heater; null for other heating. */
function cleanHeatingAction(household: Household, region: Region): Draft | null {
  const f = ACTION_FACTORS;
  if (household.lifestyle.heating === 'wood_or_coal') {
    const pm = f.brazierKgPerNight * f.winterNights * f.brazierPm25GPerKg;
    const co2 = round(
      f.brazierKgPerNight * f.winterNights * f.coalCo2KgPerKg -
        f.electricHeaterKwhPerNight * f.winterNights * region.gridCo2KgPerKwh,
      0,
    );
    return {
      id: 'clean-heating',
      title: 'Replace the coal/wood brazier with an electric heater',
      category: 'home',
      detail: 'Add layered bedding and door draught-stoppers so the heater can stay on low.',
      perHousehold: { co2KgPerYear: co2, pm25GPerYear: pm, noxGPerYear: null },
      impactStatement: `Cuts ~${pm} g of PM2.5 per winter at home and removes the carbon-monoxide risk; net CO₂ falls by ~${co2} kg.`,
    };
  }
  return null;
}

/** Composting leaves and handing over waste instead of burning it. */
function noBurningAction(region: Region): Draft {
  const f = ACTION_FACTORS;
  const burnedPm = f.assumedBurnedKgPerWeek * 52 * f.openBurningPm25GPerKg;
  return {
    id: 'never-burn-waste',
    title: 'Compost leaves and hand over waste: never burn it',
    category: 'waste',
    detail: region.isIndia
      ? "Report open burning to your municipal helpline or CPCB's Sameer app; organise a society compost pit."
      : 'Report open burning to your local council; organise a neighbourhood compost scheme.',
    perHousehold: { co2KgPerYear: null, pm25GPerYear: burnedPm, noxGPerYear: null },
    impactStatement: `Not burning ${f.assumedBurnedKgPerWeek} kg of leaves or garbage a week avoids ~${burnedPm} g of PM2.5 a year, about what a petrol car emits over ${Math.round(burnedPm / MODE_PROFILES.car_petrol.pm25GPerKm).toLocaleString('en-US')} km (exhaust + brakes + tyres).`,
  };
}

/** Saving one kWh a day, priced with the local grid's carbon intensity. */
function saveElectricityAction(region: Region): Draft {
  const f = ACTION_FACTORS;
  const kwhCo2 = round(f.savedKwhPerDay * 365 * region.gridCo2KgPerKwh, 0);
  return {
    id: 'save-electricity',
    title: 'Save 1 kWh a day: heater thermostat, geyser timer, LED lights',
    category: 'energy',
    detail: region.isIndia
      ? "Most of India's winter electricity comes from coal plants upwind of cities."
      : `Your grid emits about ${region.gridCo2KgPerKwh} kg CO₂ for every kWh you use.`,
    perHousehold: { co2KgPerYear: kwhCo2, pm25GPerYear: null, noxGPerYear: null },
    impactStatement: `Avoids ~${kwhCo2} kg CO₂ a year (grid factor ${region.gridCo2KgPerKwh} kg/kWh) plus the pollutants from generating that power.`,
  };
}

/** The home actions that apply to this household, in display order. */
export function homeActions(household: Household, region: Region): Draft[] {
  const optional = [cleanCookingAction(household, region), cleanHeatingAction(household, region)];
  return [
    ...optional.filter((draft): draft is Draft => draft !== null),
    noBurningAction(region),
    saveElectricityAction(region),
  ];
}
