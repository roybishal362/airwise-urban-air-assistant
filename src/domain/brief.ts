import { calculateAqi, resolveStandard } from './aqi/calculator.js';
import type { AirBrief, BriefInput } from './briefTypes.js';
import { currentSummary, standardSummary, summarise } from './briefSummary.js';
import { calibrateAir } from './calibration.js';
import { buildHourlyIndex, describeTrend } from './forecast.js';
import { buildGlance, exposureEquivalents } from './glance.js';
import { currentHourIndex, dayWindows, readingNow, weatherFromNow } from './hoursAhead.js';
import type { Household } from './household.js';
import { buildSustainableActions, compareCommute, summariseCommunity } from './impact/index.js';
import { buildIndoorPlan } from './indoor.js';
import { localPolicy } from './policy.js';
import { resolveRegion, type Region } from './region.js';
import { assessFamilyRisk } from './risk.js';
import { buildRoutine, type DayWindows } from './routine.js';
import { analyzeSmog, type SmogOutlook } from './smog.js';
import type { AqiReading, Concentrations, LocalTime } from './types.js';

export type { AirBrief, BriefInput, PollutantReading } from './briefTypes.js';
export { currentHourIndex } from './hoursAhead.js';

/** GRAP stages are defined on the India NAQI, whatever scale the user views. */
const delhiNaqi = (region: Region, current: Concentrations): number | null =>
  region.isDelhiNcr ? (calculateAqi(current, 'in')?.value ?? null) : null;

/** The place's region and standard, the calibrated air, the next 24 hours and the reading now. */
function airNow(input: BriefInput) {
  const { location } = input;
  const region = resolveRegion(location, input.air.timezone);
  const standardId = resolveStandard(input.standard, {
    countryCode: location.countryCode,
    timezone: input.air.timezone,
  });
  const index = currentHourIndex(
    input.air.hourly.map((h) => h.time),
    input.air.currentTime,
  );
  // Measured station values replace the model's "now"; the forecast is rescaled to match.
  const { air, source: dataSource } = calibrateAir(input.air, input.station ?? null, index);
  const upcoming = air.hourly.slice(index, index + 24);
  return {
    region,
    standardId,
    air,
    dataSource,
    upcoming,
    reading: readingNow(air, upcoming, standardId),
  };
}

/** What the family plan depends on. */
interface PlanContext {
  household: Household;
  region: Region;
  reading: AqiReading;
  windows: DayWindows;
  smog: SmogOutlook;
  outdoorPm25: number;
  now: LocalTime;
}

/** The household's plan: risk, daily routine, indoor plan, commute comparison and actions. */
function familyPlan(
  c: PlanContext,
): Pick<AirBrief, 'risk' | 'routine' | 'indoor' | 'commute' | 'actions'> {
  const { household, region, reading, windows, smog, outdoorPm25, now } = c;
  const airLevel = reading.category.level;
  const risk = assessFamilyRisk(reading, household, smog);
  const indoor = buildIndoorPlan({
    outdoorPm25,
    airLevel,
    household,
    ventilationWindow: windows.ventilation,
    now,
  });
  const commute = compareCommute(household, outdoorPm25, airLevel, region.gridCo2KgPerKwh);
  const actions = buildSustainableActions(household, commute, region);
  const routine = buildRoutine({ household, risk, windows, smog, commute, indoor, now });
  return { risk, routine, indoor, commute, actions };
}

/** Assemble the complete AirBrief for one place and household from air, weather and station data. */
export function buildBrief(input: BriefInput): AirBrief {
  const { location, weather, household } = input;
  const { region, standardId, air, dataSource, upcoming, reading } = airNow(input);
  const now = air.currentTime;
  const hours = buildHourlyIndex(upcoming, standardId);
  const windows = dayWindows(hours);
  const smog = analyzeSmog(weatherFromNow(weather, now));
  const outdoorPm25 = air.current.pm2_5 ?? upcoming[0]?.concentrations.pm2_5 ?? 0;
  const plan = familyPlan({ household, region, reading, windows, smog, outdoorPm25, now });
  const brief: Omit<AirBrief, 'summary'> = {
    location,
    observedAt: now,
    timezone: air.timezone,
    standard: standardSummary(standardId),
    current: currentSummary(air.current, reading),
    forecast: { hours, trend: describeTrend(hours), windows },
    smog,
    ...plan,
    communityHouseholds: household.communityHouseholds,
    community: summariseCommunity(plan.actions, household.communityHouseholds),
    region,
    policy: localPolicy(region, delhiNaqi(region, air.current), household),
    glance: buildGlance({ reading, windows, commute: plan.commute, household, now }),
    exposure: exposureEquivalents(outdoorPm25),
    dataSource,
  };
  return { ...brief, summary: summarise(brief) };
}
