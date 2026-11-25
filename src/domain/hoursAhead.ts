import { calculateAqi } from './aqi/calculator.js';
import { InsufficientDataError } from './errors.js';
import { findWindow } from './forecast.js';
import type { DayWindows } from './routine.js';
import { hourKey } from './time.js';
import type {
  AirSnapshot,
  AqiReading,
  HourlyAir,
  HourlyIndex,
  HourlyWeather,
  LocalTime,
  StandardId,
  WeatherSnapshot,
} from './types.js';

/** Where "now" is in the hourly series, the reading at that hour, and the day ahead. */

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

/** The AQI "now": measured (or current) values, else the first forecast hour. */
export function readingNow(
  air: AirSnapshot,
  upcoming: readonly HourlyAir[],
  standardId: StandardId,
): AqiReading {
  const first = upcoming[0];
  const reading =
    calculateAqi(air.current, standardId) ??
    (first ? calculateAqi(first.concentrations, standardId) : null);
  if (!reading)
    throw new InsufficientDataError('No usable pollutant measurements for this location');
  return reading;
}

/** The day's cleanest and worst windows from the next 24 hours. */
export function dayWindows(hours: readonly HourlyIndex[]): DayWindows {
  return {
    outdoor: findWindow(hours, 1, 'best', { earliestHour: 6, latestHour: 21 }),
    ventilation: findWindow(hours, 2, 'best', { earliestHour: 8, latestHour: 19 }),
    play: findWindow(hours, 1, 'best', { earliestHour: 14, latestHour: 19 }),
    worst: findWindow(hours, 3, 'worst'),
  };
}

/** Weather from the current hour on; empty without weather (the smog outlook then degrades gracefully). */
export function weatherFromNow(weather: WeatherSnapshot | null, now: LocalTime): HourlyWeather[] {
  if (!weather) return [];
  const index = currentHourIndex(
    weather.hourly.map((h) => h.time),
    now,
  );
  return weather.hourly.slice(index);
}
