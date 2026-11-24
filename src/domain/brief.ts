import { calculateAqi, resolveStandard } from './aqi/calculator.js';
import { POLLUTANT_LABELS, STANDARDS } from './aqi/standards.js';
import { InsufficientDataError } from './errors.js';
import {
  buildGlance,
  exposureEquivalents,
  type ExposureEquivalents,
  type GlanceTile,
} from './glance.js';
import { buildHourlyIndex, describeTrend, findWindow, type Trend } from './forecast.js';
import type { Household } from './household.js';
import {
  buildSustainableActions,
  compareCommute,
  summariseCommunity,
  type CommunitySummary,
  type CommuteComparison,
  type SustainableAction,
} from './impact/index.js';
import { buildIndoorPlan, type IndoorPlan } from './indoor.js';
import { localPolicy, type LocalPolicy } from './policy.js';
import { resolveRegion, type Region } from './region.js';
import { assessFamilyRisk, type FamilyRisk } from './risk.js';
import { buildRoutine, type DayWindows, type RoutineStep } from './routine.js';
import { analyzeSmog, type SmogOutlook } from './smog.js';
import { hourKey } from './time.js';
import {
  POLLUTANT_IDS,
  type AirSnapshot,
  type AqiCategory,
  type GeoLocation,
  type HourlyIndex,
  type LocalTime,
  type PollutantId,
  type StandardId,
  type StandardPreference,
  type WeatherSnapshot,
} from './types.js';

export interface PollutantReading {
  id: PollutantId;
  label: string;
  /** µg/m³, rounded to one decimal. */
  concentration: number;
  subIndex: number | null;
}

/**
 * The AirBrief is the single source of truth for one household at one place
 * and time. The UI renders it, the rule-based assistant quotes it, and the
 * GenAI assistant is grounded in it: the language model never invents numbers.
 */
export interface AirBrief {
  location: GeoLocation;
  observedAt: LocalTime;
  timezone: string;
  standard: {
    id: StandardId;
    name: string;
    shortName: string;
    /** Category bands, for drawing the AQI gauge. */
    bands: { min: number; max: number; label: string; color: string }[];
  };
  current: {
    aqi: number;
    category: AqiCategory;
    dominantPollutant: PollutantId;
    dominantLabel: string;
    pollutants: PollutantReading[];
  };
  forecast: { hours: HourlyIndex[]; trend: Trend | null; windows: DayWindows };
  smog: SmogOutlook;
  risk: FamilyRisk;
  routine: RoutineStep[];
  indoor: IndoorPlan;
  commute: CommuteComparison | null;
  actions: SustainableAction[];
  communityHouseholds: number;
  /** Headline impact if every household in the community adopts the plan. */
  community: CommunitySummary;
  /** Country context that tailors impact factors and emergency advice. */
  region: Region;
  /** Local anti-smog rules in force at this AQI (Delhi-NCR GRAP), if any. */
  policy: LocalPolicy | null;
  /** Five one-line decisions for the day (mask, windows, exercise, kids, commute). */
  glance: GlanceTile[];
  /** Today's PM2.5 in relatable terms: cigarettes a day and multiples of the WHO limit. */
  exposure: ExposureEquivalents;
  summary: string;
}

export interface BriefInput {
  location: GeoLocation;
  air: AirSnapshot;
  weather: WeatherSnapshot | null;
  household: Household;
  standard: StandardPreference;
}

/** Index of the hourly entry matching `currentTime` (or the latest one before it). */
export function currentHourIndex(times: readonly LocalTime[], currentTime: LocalTime): number {
  const key = hourKey(currentTime);
  const exact = times.findIndex((t) => hourKey(t) === key);
  if (exact >= 0) return exact;
  let latest = 0;
  times.forEach((t, i) => {
    if (t <= currentTime) latest = i;
  });
  return latest;
}

const TREND_WORDS: Readonly<Record<Trend['direction'], string>> = {
  improving: 'expected to improve',
  worsening: 'expected to worsen',
  stable: 'expected to stay about the same',
};

function summarise(brief: Omit<AirBrief, 'summary'>): string {
  const { location, current, standard, risk, forecast, smog } = brief;
  const parts = [
    `${location.name}: air is ${current.category.label} (${standard.shortName} ${current.aqi}, mainly ${current.dominantLabel}).`,
    risk.headline,
  ];
  if (forecast.trend) {
    parts.push(
      `Over the next ${forecast.trend.lookaheadHours} hours it is ${TREND_WORDS[forecast.trend.direction]} (AQI ~${forecast.trend.next}).`,
    );
  }
  if (smog.trapRisk === 'high' || smog.trapRisk === 'severe') {
    parts.push(`Smog-trap risk is ${smog.trapRisk}.`);
  }
  if (brief.policy) {
    parts.push(`Delhi-NCR GRAP ${brief.policy.stageLabel.split(' – ')[0]} conditions.`);
  }
  if (forecast.windows.outdoor) {
    const w = forecast.windows.outdoor;
    parts.push(`Cleanest hour: ${w.start.slice(11, 16)} (AQI ~${w.averageAqi}).`);
  }
  return parts.join(' ');
}

export function buildBrief(input: BriefInput): AirBrief {
  const { location, air, weather, household } = input;
  const region = resolveRegion(location, air.timezone);
  const standardId = resolveStandard(input.standard, {
    countryCode: location.countryCode,
    timezone: air.timezone,
  });
  const standard = STANDARDS[standardId];

  const index = currentHourIndex(
    air.hourly.map((h) => h.time),
    air.currentTime,
  );
  const upcoming = air.hourly.slice(index, index + 24);
  const reading =
    calculateAqi(air.current, standardId) ??
    (upcoming[0] ? calculateAqi(upcoming[0].concentrations, standardId) : null);
  if (!reading)
    throw new InsufficientDataError('No usable pollutant measurements for this location');

  const hours = buildHourlyIndex(upcoming, standardId);
  const windows: DayWindows = {
    outdoor: findWindow(hours, 1, 'best', { earliestHour: 6, latestHour: 21 }),
    ventilation: findWindow(hours, 2, 'best', { earliestHour: 8, latestHour: 19 }),
    play: findWindow(hours, 1, 'best', { earliestHour: 14, latestHour: 19 }),
    worst: findWindow(hours, 3, 'worst'),
  };

  const weatherHours = weather
    ? weather.hourly.slice(
        currentHourIndex(
          weather.hourly.map((h) => h.time),
          air.currentTime,
        ),
      )
    : [];
  const smog: SmogOutlook = analyzeSmog(weatherHours);
  const risk: FamilyRisk = assessFamilyRisk(reading, household, smog);

  const outdoorPm25 = air.current.pm2_5 ?? upcoming[0]?.concentrations.pm2_5 ?? 0;
  const indoor: IndoorPlan = buildIndoorPlan({
    outdoorPm25,
    airLevel: reading.category.level,
    household,
    ventilationWindow: windows.ventilation,
    now: air.currentTime,
  });
  const commute = compareCommute(
    household,
    outdoorPm25,
    reading.category.level,
    region.gridCo2KgPerKwh,
  );
  const actions = buildSustainableActions(household, commute, region);
  // GRAP stages are defined on the India NAQI, whatever scale the user views.
  const naqi = region.isDelhiNcr ? (calculateAqi(air.current, 'in')?.value ?? null) : null;
  const routine = buildRoutine({
    household,
    risk,
    windows,
    smog,
    commute,
    indoor,
    now: air.currentTime,
  });

  const pollutants: PollutantReading[] = [];
  for (const id of POLLUTANT_IDS) {
    const value = air.current[id];
    if (value === null || value === undefined) continue;
    pollutants.push({
      id,
      label: POLLUTANT_LABELS[id],
      concentration: Math.round(value * 10) / 10,
      subIndex: reading.subIndices[id] ?? null,
    });
  }

  const brief: Omit<AirBrief, 'summary'> = {
    location,
    observedAt: air.currentTime,
    timezone: air.timezone,
    standard: {
      id: standard.id,
      name: standard.name,
      shortName: standard.shortName,
      bands: standard.categories.map(({ min, max, label, color }) => ({ min, max, label, color })),
    },
    current: {
      aqi: reading.value,
      category: reading.category,
      dominantPollutant: reading.dominantPollutant,
      dominantLabel: POLLUTANT_LABELS[reading.dominantPollutant],
      pollutants,
    },
    forecast: { hours, trend: describeTrend(hours), windows },
    smog,
    risk,
    routine,
    indoor,
    commute,
    actions,
    communityHouseholds: household.communityHouseholds,
    community: summariseCommunity(actions, household.communityHouseholds),
    region,
    policy: localPolicy(region, naqi, household),
    glance: buildGlance({ reading, windows, commute, household, now: air.currentTime }),
    exposure: exposureEquivalents(outdoorPm25),
  };
  return { ...brief, summary: summarise(brief) };
}
