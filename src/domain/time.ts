import type { LocalTime } from './types.js';

/**
 * Helpers for Open-Meteo local time strings (`YYYY-MM-DDTHH:mm`, already in the
 * location's timezone). We never convert to the server's timezone: the string
 * is treated as a naive wall-clock value, which is exactly what users see.
 */

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isLocalTime(value: string): boolean {
  return LOCAL_TIME.test(value);
}

export function hourOf(time: LocalTime): number {
  return Number(time.slice(11, 13));
}

/** `2026-11-17T06:30` → `2026-11-17T06` — used to align a 15-min reading to the hourly series. */
export function hourKey(time: LocalTime): string {
  return time.slice(0, 13);
}

export function addHours(time: LocalTime, hours: number): LocalTime {
  const match = LOCAL_TIME.exec(time);
  if (!match) throw new Error(`Invalid local time: ${time}`);
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const shifted = new Date(Date.UTC(y, mo - 1, d, h + hours, mi));
  return shifted.toISOString().slice(0, 16);
}

/** `06:00` style label. */
export function clockLabel(time: LocalTime): string {
  return time.slice(11, 16);
}

/** `13:00–15:00` style label for a window with an exclusive end. */
export function rangeLabel(start: LocalTime, end: LocalTime): string {
  return `${clockLabel(start)}–${clockLabel(end)}`;
}

/**
 * Day context for a time relative to "now": '' for the same date,
 * ' tomorrow' for the next date, otherwise ' on YYYY-MM-DD'. Without it,
 * "Before 07:00" is ambiguous for anyone checking the app in the evening.
 */
export function dayQualifier(time: LocalTime, reference: LocalTime): string {
  const day = time.slice(0, 10);
  const today = reference.slice(0, 10);
  if (day === today) return '';
  if (day === addHours(`${today}T00:00`, 24).slice(0, 10)) return ' tomorrow';
  return ` on ${day}`;
}

/** `07:00–10:00 tomorrow` style label. */
export function windowLabel(start: LocalTime, end: LocalTime, reference: LocalTime): string {
  return `${rangeLabel(start, end)}${dayQualifier(start, reference)}`;
}

/** Signed percentage with a typographic minus: `+12%`, `−39%`, `0%`. */
export function signedPercent(value: number): string {
  if (value === 0) return '0%';
  return value > 0 ? `+${value}%` : `−${Math.abs(value)}%`;
}
