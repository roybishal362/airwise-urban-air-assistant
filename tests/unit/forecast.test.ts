import { describe, expect, it } from 'vitest';
import { buildHourlyIndex, describeTrend, findWindow } from '../../src/domain/forecast.js';
import {
  addHours,
  clockLabel,
  hourKey,
  hourOf,
  dayQualifier,
  isLocalTime,
  rangeLabel,
  signedPercent,
  windowLabel,
} from '../../src/domain/time.js';
import type { HourlyIndex, SeverityLevel } from '../../src/domain/types.js';

const points = (start: string, values: number[]): HourlyIndex[] =>
  values.map((aqi, i) => ({
    time: addHours(start, i),
    aqi,
    level: Math.min(5, Math.floor(aqi / 100)) as SeverityLevel,
    label: 'x',
  }));

describe('time helpers', () => {
  it('adds hours across day, month and year boundaries', () => {
    expect(addHours('2026-11-24T23:00', 1)).toBe('2026-11-25T00:00');
    expect(addHours('2026-11-30T23:00', 2)).toBe('2026-12-01T01:00');
    expect(addHours('2026-12-31T23:30', 1)).toBe('2027-01-01T00:30');
  });

  it('parses and formats local times', () => {
    expect(hourOf('2026-11-24T16:00')).toBe(16);
    expect(hourKey('2026-11-24T06:30')).toBe('2026-11-24T06');
    expect(clockLabel('2026-11-24T06:30')).toBe('06:30');
    expect(rangeLabel('2026-11-24T13:00', '2026-11-24T15:00')).toBe('13:00–15:00');
    expect(isLocalTime('2026-11-24T06:30')).toBe(true);
    expect(isLocalTime('24/11/2026')).toBe(false);
  });

  it('rejects malformed times', () => {
    expect(() => addHours('not-a-time', 1)).toThrow(/Invalid local time/);
  });

  it('labels windows on later days so evening users are not misled', () => {
    const now = '2026-11-30T21:15';
    expect(dayQualifier('2026-11-30T23:00', now)).toBe('');
    expect(dayQualifier('2026-12-01T07:00', now)).toBe(' tomorrow');
    expect(dayQualifier('2026-12-02T07:00', now)).toBe(' on 2026-12-02');
    expect(windowLabel('2026-12-01T07:00', '2026-12-01T10:00', now)).toBe('07:00–10:00 tomorrow');
  });

  it('formats signed percentages with a typographic minus', () => {
    expect(signedPercent(0)).toBe('0%');
    expect(signedPercent(25)).toBe('+25%');
    expect(signedPercent(-67)).toBe('−67%');
  });
});

describe('buildHourlyIndex', () => {
  it('converts concentrations to hourly AQI and skips empty hours', () => {
    const result = buildHourlyIndex(
      [
        { time: '2026-11-24T00:00', concentrations: { pm2_5: 45 } },
        { time: '2026-11-24T01:00', concentrations: { pm2_5: null } },
        { time: '2026-11-24T02:00', concentrations: { pm2_5: 100 } },
      ],
      'in',
    );
    expect(result).toEqual([
      { time: '2026-11-24T00:00', aqi: 75, level: 1, label: 'Satisfactory' },
      { time: '2026-11-24T02:00', aqi: 232, level: 3, label: 'Poor' },
    ]);
  });
});

describe('findWindow', () => {
  const day = points(
    '2026-11-24T00:00',
    [
      300, 280, 260, 240, 220, 200, 150, 120, 90, 80, 60, 55, 50, 70, 120, 200, 260, 300, 320, 330,
      310, 300, 290, 280,
    ],
  );

  it('finds the cleanest contiguous block', () => {
    expect(findWindow(day, 2, 'best')).toMatchObject({
      start: '2026-11-24T11:00',
      end: '2026-11-24T13:00',
      averageAqi: 53,
      peakAqi: 55,
    });
  });

  it('finds the most polluted block', () => {
    expect(findWindow(day, 3, 'worst')).toMatchObject({ start: '2026-11-24T18:00', peakAqi: 330 });
  });

  it('respects the allowed clock-hour range', () => {
    const evening = findWindow(day, 1, 'best', { earliestHour: 14, latestHour: 19 });
    expect(evening?.start).toBe('2026-11-24T14:00');
  });

  it('reports the highest severity level inside the window', () => {
    const w = findWindow(points('2026-11-24T00:00', [50, 250]), 2, 'best');
    expect(w?.level).toBe(2);
  });

  it('prefers the earliest window on ties and handles midnight', () => {
    const flat = points('2026-11-24T22:00', [100, 100, 100]);
    expect(findWindow(flat, 1, 'best')?.start).toBe('2026-11-24T22:00');
    expect(findWindow(flat, 3, 'best')?.end).toBe('2026-11-25T01:00');
  });

  it('returns null when no window fits', () => {
    expect(findWindow(day.slice(0, 1), 2, 'best')).toBeNull();
    expect(findWindow(day, 1, 'best', { earliestHour: 30 })).toBeNull();
  });
});

describe('describeTrend', () => {
  it('detects improving, worsening and stable air', () => {
    expect(describeTrend(points('2026-11-24T00:00', [200, 150, 140, 130]))?.direction).toBe(
      'improving',
    );
    expect(describeTrend(points('2026-11-24T00:00', [100, 150, 160]))?.direction).toBe('worsening');
    expect(describeTrend(points('2026-11-24T00:00', [100, 105, 95]))).toMatchObject({
      direction: 'stable',
      now: 100,
      next: 100,
      lookaheadHours: 2,
    });
  });

  it('needs at least two points', () => {
    expect(describeTrend([])).toBeNull();
    expect(describeTrend(points('2026-11-24T00:00', [100]))).toBeNull();
  });
});
