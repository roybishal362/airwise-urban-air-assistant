/**
 * Shared domain types. The domain layer is pure (no I/O) so every rule that
 * drives a recommendation can be unit-tested and explained to the user.
 */

export const POLLUTANT_IDS = ['pm2_5', 'pm10', 'no2', 'so2', 'o3', 'co'] as const;
export type PollutantId = (typeof POLLUTANT_IDS)[number];

/** `us` = US EPA AQI (2024 revision), `in` = India National AQI (CPCB). */
export type StandardId = 'us' | 'in';
export type StandardPreference = StandardId | 'auto';

/** Standard-agnostic severity: 0 good … 5 hazardous/severe. */
export type SeverityLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Pollutant concentrations in µg/m³ (the unit Open-Meteo reports for all six). */
export type Concentrations = Partial<Record<PollutantId, number | null>>;

export interface AqiCategory {
  level: SeverityLevel;
  label: string;
  /** Background colour defined by the standard. */
  color: string;
  /** Text colour chosen to keep WCAG AA contrast (≥ 4.5:1) on `color`. */
  textColor: string;
  meaning: string;
}

export interface AqiReading {
  standard: StandardId;
  value: number;
  category: AqiCategory;
  dominantPollutant: PollutantId;
  subIndices: Partial<Record<PollutantId, number>>;
}

export interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string | undefined;
  countryCode?: string | undefined;
  region?: string | undefined;
  timezone?: string | undefined;
}

/** Local wall-clock time string as returned by Open-Meteo: `YYYY-MM-DDTHH:mm`. */
export type LocalTime = string;

export interface HourlyAir {
  time: LocalTime;
  concentrations: Concentrations;
}

export interface AirSnapshot {
  timezone: string;
  currentTime: LocalTime;
  current: Concentrations;
  hourly: HourlyAir[];
}

export interface HourlyWeather {
  time: LocalTime;
  temperatureC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  boundaryLayerM: number | null;
}

export interface WeatherSnapshot {
  timezone: string;
  hourly: HourlyWeather[];
}

export interface HourlyIndex {
  time: LocalTime;
  aqi: number;
  level: SeverityLevel;
  label: string;
}

export interface TimeWindow {
  start: LocalTime;
  /** Exclusive end of the window. */
  end: LocalTime;
  averageAqi: number;
  peakAqi: number;
  level: SeverityLevel;
}

/** One monitoring station that contributed to a measured reading. */
export interface StationInfo {
  name: string;
  distanceKm: number;
  /** Local wall-clock time of the measurement, e.g. `2026-11-24T15:00`. */
  measuredAtLocal: LocalTime;
}

/** Measured concentrations (µg/m³) averaged over the nearest fresh stations. */
export interface StationSnapshot {
  provider: string;
  stations: StationInfo[];
  concentrations: Concentrations;
}
