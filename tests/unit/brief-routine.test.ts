import { describe, expect, it } from 'vitest';
import { buildBrief, currentHourIndex } from '../../src/domain/brief.js';
import { InsufficientDataError } from '../../src/domain/errors.js';
import { compareCommute } from '../../src/domain/impact/index.js';
import { buildIndoorPlan } from '../../src/domain/indoor.js';
import { assessFamilyRisk } from '../../src/domain/risk.js';
import { buildRoutine, type DayWindows } from '../../src/domain/routine.js';
import { analyzeSmog } from '../../src/domain/smog.js';
import type { AqiReading, TimeWindow } from '../../src/domain/types.js';
import { categoryFor } from '../../src/domain/aqi/calculator.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

describe('buildBrief (real Delhi winter pattern)', () => {
  const brief = buildBrief({
    location: DELHI,
    air: makeAir(),
    weather: makeWeather(),
    household: makeHousehold(),
    standard: 'auto',
  });

  it('uses India NAQI for Delhi and aligns the 06:30 reading to the 06:00 hour', () => {
    expect(brief.standard.id).toBe('in');
    expect(brief.current).toMatchObject({ aqi: 108, dominantPollutant: 'pm2_5' });
    expect(brief.current.category.label).toBe('Moderate');
    expect(brief.forecast.hours).toHaveLength(24);
    expect(brief.forecast.hours[0]?.time).toBe('2026-11-24T06:00');
  });

  it('finds the clean afternoon and the polluted evening', () => {
    // 14:00 (26.8 → 26) and 15:00 (26.0) tie at AQI 43; ties resolve to the earlier hour.
    expect(brief.forecast.windows.outdoor).toMatchObject({
      start: '2026-11-24T14:00',
      averageAqi: 43,
    });
    expect(brief.forecast.windows.ventilation?.start).toBe('2026-11-24T14:00');
    expect(brief.forecast.windows.worst?.start).toBe('2026-11-24T19:00');
    expect(brief.forecast.windows.worst?.peakAqi).toBe(239);
  });

  it('connects the smog trap, family risk, routine, indoor plan and actions', () => {
    expect(brief.smog.trapRisk).toBe('severe');
    expect(brief.risk.verdict).toBe('limit_outdoor');
    expect(brief.routine.map((s) => s.id)).toEqual([
      'exercise',
      'commute',
      'ventilate',
      'play',
      'evening',
      'cooking',
      'bedtime',
    ]);
    expect(brief.indoor.outdoorPm25).toBe(64);
    expect(brief.commute?.alternatives[0]?.mode).toBe('metro');
    expect(brief.actions.length).toBeGreaterThanOrEqual(3);
    expect(brief.summary).toMatch(/^Delhi: air is Moderate \(NAQI 108/);
    expect(brief.summary).toMatch(/Smog-trap risk is severe/);
    expect(brief.current.pollutants.map((p) => p.id)).toEqual([
      'pm2_5',
      'pm10',
      'no2',
      'so2',
      'o3',
      'co',
    ]);
  });

  it('switches to the US AQI on request and degrades without weather', () => {
    const us = buildBrief({
      location: DELHI,
      air: makeAir(),
      weather: null,
      household: makeHousehold(),
      standard: 'us',
    });
    expect(us.standard.id).toBe('us');
    expect(us.current.category.label).toBe('Unhealthy');
    expect(us.smog.available).toBe(false);
    expect(us.summary).not.toMatch(/Smog-trap/);
  });

  it('falls back to the hourly series when the current reading is empty', () => {
    const air = makeAir();
    air.current = { pm2_5: null };
    expect(
      buildBrief({
        location: DELHI,
        air,
        weather: null,
        household: makeHousehold(),
        standard: 'in',
      }).current.aqi,
    ).toBe(108);
  });

  it('throws InsufficientDataError when nothing is measurable', () => {
    const air = makeAir();
    air.current = {};
    air.hourly = air.hourly.map((h) => ({ ...h, concentrations: {} }));
    expect(() =>
      buildBrief({
        location: DELHI,
        air,
        weather: null,
        household: makeHousehold(),
        standard: 'in',
      }),
    ).toThrow(InsufficientDataError);
  });
});

describe('currentHourIndex', () => {
  const times = ['2026-11-24T00:00', '2026-11-24T01:00', '2026-11-24T03:00'];
  it('matches the hour or falls back to the latest earlier hour', () => {
    expect(currentHourIndex(times, '2026-11-24T01:45')).toBe(1);
    expect(currentHourIndex(times, '2026-11-24T02:30')).toBe(1);
    expect(currentHourIndex(times, '2026-11-23T22:00')).toBe(0);
  });
});

describe('buildRoutine branches', () => {
  const reading = (value: number): AqiReading => ({
    standard: 'in',
    value,
    category: categoryFor(value, 'in'),
    dominantPollutant: 'pm2_5',
    subIndices: {},
  });
  const w = (
    level: 0 | 1 | 2 | 3 | 4 | 5,
    aqi: number,
    start = '2026-11-24T15:00',
  ): TimeWindow => ({ start, end: '2026-11-24T16:00', averageAqi: aqi, peakAqi: aqi, level });

  const routineFor = (
    aqi: number,
    overrides: Parameters<typeof makeHousehold>[0],
    windows: Partial<DayWindows>,
    trap = makeWeather().hourly,
  ) => {
    const household = makeHousehold(overrides);
    const r = reading(aqi);
    const indoor = buildIndoorPlan({
      outdoorPm25: aqi / 2,
      airLevel: r.category.level,
      household,
      ventilationWindow: windows.ventilation ?? null,
    });
    return buildRoutine({
      household,
      risk: assessFamilyRisk(r, household),
      windows: { outdoor: null, ventilation: null, play: null, worst: null, ...windows },
      smog: analyzeSmog(trap),
      commute: compareCommute(household, aqi / 2, r.category.level),
      indoor,
      now: '2026-11-24T06:00',
    });
  };

  it('sends healthy adults out in a clean hour and keeps workouts indoors otherwise', () => {
    const adults = { members: { adults: 2, children: 0, seniors: 0 } };
    expect(
      routineFor(80, adults, { outdoor: w(1, 70) }).find((s) => s.id === 'exercise')?.title,
    ).toMatch(/outdoors/);
    expect(
      routineFor(300, adults, { outdoor: w(3, 220) }).find((s) => s.id === 'exercise')?.detail,
    ).toMatch(/AQI ~220/);
    expect(routineFor(300, adults, {}).find((s) => s.id === 'exercise')?.title).toMatch(/indoors/);
    expect(
      routineFor(
        80,
        { lifestyle: { ...makeHousehold().lifestyle, exercisesOutdoors: false } },
        {},
      ).find((s) => s.id === 'exercise'),
    ).toBeUndefined();
  });

  it('recommends home-working on severe days when possible', () => {
    const steps = routineFor(
      450,
      { lifestyle: { ...makeHousehold().lifestyle, workFromHomePossible: true } },
      {},
    );
    expect(steps.find((s) => s.id === 'commute')?.title).toBe('Work from home today');
  });

  it('falls back to protection advice when no cleaner commute fits', () => {
    const steps = routineFor(
      450,
      { lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'metro' } },
      {},
    );
    expect(steps.find((s) => s.id === 'commute')?.title).toBe('Protect yourself on the commute');
    const car = routineFor(
      450,
      { lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'ev_car' } },
      {},
    );
    expect(car.find((s) => s.id === 'commute')?.detail).toMatch(/recirculate/);
    expect(
      routineFor(
        450,
        { lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'none' } },
        {},
      ).find((s) => s.id === 'commute'),
    ).toBeUndefined();
  });

  it("grades children's play time", () => {
    expect(routineFor(80, {}, { play: w(1, 60) }).find((s) => s.id === 'play')?.title).toMatch(
      /Outdoor play/,
    );
    expect(routineFor(150, {}, { play: w(2, 140) }).find((s) => s.id === 'play')?.title).toMatch(
      /Short, gentle/,
    );
    expect(routineFor(300, {}, { play: w(3, 240) }).find((s) => s.id === 'play')?.why).toMatch(
      /AQI ~240/,
    );
    expect(routineFor(300, {}, {}).find((s) => s.id === 'play')?.why).toMatch(/No clean afternoon/);
    expect(
      routineFor(300, { members: { adults: 1, children: 0, seniors: 0 } }, {}).find(
        (s) => s.id === 'play',
      ),
    ).toBeUndefined();
  });

  it('warns before the evening peak only when it matters', () => {
    const calm = makeWeather().hourly.map((h) => ({ ...h, windKmh: 30, boundaryLayerM: 1500 }));
    expect(
      routineFor(40, {}, { worst: w(0, 40) }, calm).find((s) => s.id === 'evening'),
    ).toBeUndefined();
    expect(
      routineFor(300, {}, { worst: w(4, 320, '2026-11-24T20:00') }).find((s) => s.id === 'evening')
        ?.when,
    ).toBe('Before 20:00');
    const tomorrow = routineFor(300, {}, { worst: w(4, 320, '2026-11-25T07:00') });
    expect(tomorrow.find((s) => s.id === 'evening')?.when).toBe('Before 07:00 tomorrow');
  });

  it('adapts cooking and bedtime steps to fuel, heating and purifier', () => {
    const dirty = routineFor(
      300,
      {
        lifestyle: {
          ...makeHousehold().lifestyle,
          cookingFuel: 'kerosene',
          heating: 'wood_or_coal',
        },
      },
      {},
    );
    expect(dirty.find((s) => s.id === 'cooking')?.title).toMatch(/maximum ventilation/);
    expect(dirty.find((s) => s.id === 'bedtime')?.detail).toMatch(/carbon-monoxide/);
    const purifier = routineFor(
      300,
      { home: { roomAreaSqm: 12, hasAirPurifier: true, purifierCadrM3h: 250 } },
      {},
    );
    expect(purifier.find((s) => s.id === 'bedtime')?.title).toMatch(/purifier/);
  });
});
