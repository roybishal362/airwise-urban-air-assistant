import { calculateAqi } from './aqi/calculator.js';
import { addHours, hourOf } from './time.js';
import type { HourlyAir, HourlyIndex, SeverityLevel, StandardId, TimeWindow } from './types.js';

/**
 * Hour-by-hour index. Consumer decisions ("can we go out at 4 pm?") depend on
 * the hourly exposure, so we apply the standard's breakpoints to hourly
 * concentrations (as most consumer AQI apps do) rather than to 24-h averages.
 */
export function buildHourlyIndex(hours: readonly HourlyAir[], standard: StandardId): HourlyIndex[] {
  const points: HourlyIndex[] = [];
  for (const hour of hours) {
    const reading = calculateAqi(hour.concentrations, standard);
    if (!reading) continue;
    points.push({
      time: hour.time,
      aqi: reading.value,
      level: reading.category.level,
      label: reading.category.label,
    });
  }
  return points;
}

export interface WindowOptions {
  /** Only consider hours whose clock hour is ≥ this value (0–23). */
  earliestHour?: number;
  /** Only consider hours whose clock hour is < this value (1–24). */
  latestHour?: number;
}

const maxLevel = (points: readonly HourlyIndex[]): SeverityLevel =>
  points.reduce<SeverityLevel>((acc, p) => (p.level > acc ? p.level : acc), 0);

/**
 * Sliding-window search (O(n·k), n ≤ 48) for the cleanest or most polluted
 * contiguous block of `durationHours`. Ties resolve to the earliest window.
 */
export function findWindow(
  points: readonly HourlyIndex[],
  durationHours: number,
  mode: 'best' | 'worst',
  options: WindowOptions = {},
): TimeWindow | null {
  const { earliestHour = 0, latestHour = 24 } = options;
  const allowed = (p: HourlyIndex): boolean => {
    const hour = hourOf(p.time);
    return hour >= earliestHour && hour < latestHour;
  };
  const best = bestSlice(points, durationHours, mode, allowed);
  return best ? toTimeWindow(best.slice, best.average) : null;
}

interface Scored {
  slice: HourlyIndex[];
  average: number;
}

const averageAqi = (slice: readonly HourlyIndex[]): number =>
  slice.reduce((sum, p) => sum + p.aqi, 0) / slice.length;

/** The allowed contiguous block with the lowest ('best') or highest ('worst') average AQI. */
function bestSlice(
  points: readonly HourlyIndex[],
  durationHours: number,
  mode: 'best' | 'worst',
  allowed: (p: HourlyIndex) => boolean,
): Scored | null {
  const beats = (a: number, b: number) => (mode === 'best' ? a < b : a > b);
  let best: Scored | null = null;
  for (let i = 0; i + durationHours <= points.length; i += 1) {
    const slice = points.slice(i, i + durationHours);
    if (!slice.every(allowed)) continue;
    const average = averageAqi(slice);
    if (best === null || beats(average, best.average)) best = { slice, average };
  }
  return best;
}

function toTimeWindow(slice: readonly HourlyIndex[], average: number): TimeWindow | null {
  const first = slice[0];
  const last = slice.at(-1);
  if (!first || !last) return null;
  return {
    start: first.time,
    end: addHours(last.time, 1),
    averageAqi: Math.round(average),
    peakAqi: Math.max(...slice.map((p) => p.aqi)),
    level: maxLevel(slice),
  };
}

export interface Trend {
  direction: 'improving' | 'worsening' | 'stable';
  /** Current hourly AQI. */
  now: number;
  /** Average AQI over the look-ahead period. */
  next: number;
  lookaheadHours: number;
}

/** Compare "now" with the average of the next few hours (±10 % counts as stable). */
export function describeTrend(points: readonly HourlyIndex[], lookaheadHours = 6): Trend | null {
  const current = points[0];
  const upcoming = points.slice(1, 1 + lookaheadHours);
  if (!current || upcoming.length === 0) return null;
  const next = Math.round(upcoming.reduce((s, p) => s + p.aqi, 0) / upcoming.length);
  const change = (next - current.aqi) / Math.max(current.aqi, 1);
  const direction = change <= -0.1 ? 'improving' : change >= 0.1 ? 'worsening' : 'stable';
  return { direction, now: current.aqi, next, lookaheadHours: upcoming.length };
}
