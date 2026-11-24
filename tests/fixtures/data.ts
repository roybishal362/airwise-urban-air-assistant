import { DEFAULT_HOUSEHOLD, type Household } from '../../src/domain/household.js';
import { addHours } from '../../src/domain/time.js';
import type { AirSnapshot, GeoLocation, WeatherSnapshot } from '../../src/domain/types.js';

/**
 * Realistic fixtures captured from Open-Meteo for New Delhi in November 2026:
 * PM2.5 peaks overnight and dips mid-afternoon, and the mixing layer
 * collapses after sunset (classic winter-inversion pattern).
 */
export const START = '2026-11-24T00:00';

export const DELHI_PM25 = [
  58.9, 57.9, 57.2, 56.9, 57.2, 58.6, 63.8, 71.9, 72.9, 67.1, 58, 37.3, 31.4, 28.6, 26.8, 26, 35.7,
  56.2, 80.8, 96.9, 102.2, 99.9, 96.6, 90.6, 83.6, 77.5, 72.6, 69.2, 67.3, 68.5, 76.1, 90.3, 89.2,
  83.8, 69.2, 47, 31.5, 29.5, 28.6, 28.6, 39.8, 60.5, 84.1, 98.5, 104.1, 103.4, 97.3, 89.2,
];

export const DELHI_BLH = [
  105, 100, 110, 100, 75, 60, 50, 55, 100, 160, 240, 655, 850, 975, 1035, 1035, 45, 35, 50, 60, 55,
  50, 40, 35,
];
export const DELHI_WIND = [
  7.2, 6.6, 6.8, 6.1, 5.3, 5.1, 4.9, 5.2, 5.8, 3.9, 3.9, 4.7, 6.8, 6.9, 6.9, 5, 1.8, 4, 5.6, 5.8,
  5.8, 5.7, 5.3, 4.9,
];

export const DELHI: GeoLocation = {
  name: 'Delhi',
  latitude: 28.652,
  longitude: 77.231,
  country: 'India',
  countryCode: 'IN',
  region: 'National Capital Territory of Delhi',
  timezone: 'Asia/Kolkata',
};

export interface AirOptions {
  currentTime?: string;
  /** Multiply every PM value, to simulate cleaner or dirtier days. */
  scale?: number;
  timezone?: string;
}

export function makeAir({
  currentTime = '2026-11-24T06:30',
  scale = 1,
  timezone = 'Asia/Kolkata',
}: AirOptions = {}): AirSnapshot {
  const hourly = DELHI_PM25.map((pm25, i) => ({
    time: addHours(START, i),
    concentrations: {
      pm2_5: pm25 * scale,
      pm10: pm25 * 1.3 * scale,
      no2: 25,
      so2: 15,
      o3: 40,
      co: 700,
    },
  }));
  const index = Number(currentTime.slice(11, 13));
  const current = hourly[index]?.concentrations ?? {};
  return { timezone, currentTime, current: { ...current }, hourly };
}

export function makeWeather(): WeatherSnapshot {
  const hours = [...DELHI_BLH, ...DELHI_BLH].map((blh, i) => ({
    time: addHours(START, i),
    temperatureC: 12,
    humidityPct: 70,
    windKmh: DELHI_WIND[i % 24] ?? 5,
    boundaryLayerM: blh,
  }));
  return { timezone: 'Asia/Kolkata', hourly: hours };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

export function makeHousehold(overrides: DeepPartial<Household> = {}): Household {
  return {
    ...DEFAULT_HOUSEHOLD,
    ...overrides,
    members: { ...DEFAULT_HOUSEHOLD.members, ...overrides.members },
    conditions: overrides.conditions ?? [],
    home: { ...DEFAULT_HOUSEHOLD.home, ...overrides.home },
    lifestyle: { ...DEFAULT_HOUSEHOLD.lifestyle, ...overrides.lifestyle },
  } as Household;
}

/** Raw Open-Meteo payloads, for client and integration tests. */
export function rawAirResponse(): Record<string, unknown> {
  const air = makeAir();
  return {
    timezone: air.timezone,
    current: {
      time: air.currentTime,
      pm2_5: air.current.pm2_5,
      pm10: air.current.pm10,
      nitrogen_dioxide: air.current.no2,
      sulphur_dioxide: air.current.so2,
      ozone: air.current.o3,
      carbon_monoxide: air.current.co,
    },
    hourly: {
      time: air.hourly.map((h) => h.time),
      pm2_5: air.hourly.map((h) => h.concentrations.pm2_5),
      pm10: air.hourly.map((h) => h.concentrations.pm10),
      nitrogen_dioxide: air.hourly.map((h) => h.concentrations.no2),
      sulphur_dioxide: air.hourly.map((h) => h.concentrations.so2),
      ozone: air.hourly.map((h) => h.concentrations.o3),
      carbon_monoxide: air.hourly.map((h) => h.concentrations.co),
    },
  };
}

export function rawWeatherResponse(): Record<string, unknown> {
  const w = makeWeather();
  return {
    timezone: w.timezone,
    hourly: {
      time: w.hourly.map((h) => h.time),
      temperature_2m: w.hourly.map((h) => h.temperatureC),
      relative_humidity_2m: w.hourly.map((h) => h.humidityPct),
      wind_speed_10m: w.hourly.map((h) => h.windKmh),
      boundary_layer_height: w.hourly.map((h) => h.boundaryLayerM),
    },
  };
}

export const RAW_GEOCODING = {
  results: [
    {
      name: 'Delhi',
      latitude: 28.65195,
      longitude: 77.23149,
      country: 'India',
      country_code: 'IN',
      admin1: 'National Capital Territory of Delhi',
      timezone: 'Asia/Kolkata',
    },
  ],
};
