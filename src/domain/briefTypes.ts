import type { DataSource } from './calibration.js';
import type { Trend } from './forecast.js';
import type { ExposureEquivalents, GlanceTile } from './glance.js';
import type { Household } from './household.js';
import type { CommunitySummary, CommuteComparison, SustainableAction } from './impact/index.js';
import type { IndoorPlan } from './indoor.js';
import type { LocalPolicy } from './policy.js';
import type { Region } from './region.js';
import type { FamilyRisk } from './risk.js';
import type { DayWindows, RoutineStep } from './routine.js';
import type { SmogOutlook } from './smog.js';
import type {
  AirSnapshot,
  AqiCategory,
  GeoLocation,
  HourlyIndex,
  LocalTime,
  PollutantId,
  StandardId,
  StandardPreference,
  StationSnapshot,
  WeatherSnapshot,
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
  /** Where "right now" comes from: measured stations, or the model as a labelled fallback. */
  dataSource: DataSource;
  summary: string;
}

export interface BriefInput {
  location: GeoLocation;
  air: AirSnapshot;
  weather: WeatherSnapshot | null;
  household: Household;
  standard: StandardPreference;
  /** Measured station readings; when present they replace the model's "now". */
  station?: StationSnapshot | null;
}
