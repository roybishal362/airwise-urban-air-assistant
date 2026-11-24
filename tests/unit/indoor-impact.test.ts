import { describe, expect, it } from 'vitest';
import {
  ACTION_FACTORS,
  MODE_PROFILES,
  alternativeNote,
  buildSustainableActions,
  compareCommute,
  computeModeImpact,
  treesEquivalent,
} from '../../src/domain/impact/index.js';
import {
  MODEL,
  buildIndoorPlan,
  estimateIndoorPm25,
  recommendedCadr,
  roomVolume,
} from '../../src/domain/indoor.js';
import { resolveRegion } from '../../src/domain/region.js';
import type { TimeWindow } from '../../src/domain/types.js';
import { DELHI, makeHousehold } from '../fixtures/data.js';

const INDIA = resolveRegion(DELHI);

const window = (level: 0 | 1 | 2 | 3 | 4 | 5, averageAqi = 80): TimeWindow => ({
  start: '2026-11-24T14:00',
  end: '2026-11-24T16:00',
  averageAqi,
  peakAqi: averageAqi,
  level,
});

describe('indoor mass-balance model', () => {
  it('estimates indoor PM2.5 with windows shut and no filter', () => {
    // 100 × 0.8 × 1.0 / (1.0 + 0.2) = 66.7
    expect(estimateIndoorPm25(100, 0, roomVolume(12))).toBe(67);
  });

  it('shows how a purifier and sealing gaps cut indoor PM2.5', () => {
    const volume = roomVolume(12);
    // 5 air changes per hour: 100 × 0.8 / (1 + 0.2 + 5) = 12.9
    expect(estimateIndoorPm25(100, volume * 5, volume)).toBe(13);
    // Halving infiltration: 100 × 0.8 × 0.5 / 0.7 = 57.1
    expect(estimateIndoorPm25(100, 0, volume, MODEL.sealedInfiltrationAch)).toBe(57);
    expect(estimateIndoorPm25(100, 100, 0)).toBe(67);
  });

  it('sizes a purifier for ~5 air changes per hour', () => {
    expect(roomVolume(10)).toBeCloseTo(27);
    expect(recommendedCadr(12)).toBe(170);
  });
});

describe('buildIndoorPlan', () => {
  const plan = (
    overrides: Parameters<typeof makeHousehold>[0],
    airLevel: 0 | 1 | 2 | 3 | 4 | 5,
    ventilation: TimeWindow | null = window(1),
  ) =>
    buildIndoorPlan({
      outdoorPm25: 150,
      airLevel,
      household: makeHousehold(overrides),
      ventilationWindow: ventilation,
    });

  it("quantifies the family's own purifier and flags undersized ones", () => {
    const result = plan(
      { home: { roomAreaSqm: 20, hasAirPurifier: true, purifierCadrM3h: 100 } },
      3,
    );
    const purifier = result.options.find((o) => o.id === 'current_purifier');
    expect(purifier?.reductionPct).toBeGreaterThan(50);
    const hack = result.hacks.find((h) => h.id === 'run-purifier');
    expect(hack?.priority).toBe(1);
    expect(hack?.detail).toMatch(/undersized/);
    expect(hack?.impact).toMatch(/µg\/m³ \(−\d+%\)/);
  });

  it('suggests a DIY fan filter when there is no purifier', () => {
    const result = plan({}, 3);
    expect(result.options.map((o) => o.id)).toEqual(['diy_fan_filter', 'recommended_purifier']);
    expect(result.hacks[0]?.id).toBe('diy-fan-filter');
    expect(plan({}, 0).hacks.find((h) => h.id === 'diy-fan-filter')?.priority).toBe(3);
  });

  it('times window-opening to the cleanest slot, or keeps windows shut', () => {
    expect(plan({}, 2, window(1)).hacks.map((h) => h.id)).toContain('ventilate-smart');
    const shut = plan({}, 4, window(4, 260)).hacks.find((h) => h.id === 'ventilate-brief');
    expect(shut?.detail).toMatch(/14:00–16:00/);
    expect(plan({}, 4, null).hacks.find((h) => h.id === 'ventilate-brief')?.detail).not.toMatch(
      /around/,
    );
  });

  it('prioritises clean cooking and safe heating', () => {
    const dirty = plan(
      {
        lifestyle: {
          ...makeHousehold().lifestyle,
          cookingFuel: 'biomass',
          heating: 'wood_or_coal',
        },
      },
      2,
    );
    expect(dirty.hacks.filter((h) => h.priority === 1).map((h) => h.id)).toEqual(
      expect.arrayContaining(['clean-cooking', 'no-angithi']),
    );
    const kerosene = plan({ lifestyle: { ...makeHousehold().lifestyle, heating: 'kerosene' } }, 2);
    expect(kerosene.hacks.map((h) => h.id)).toContain('vent-combustion-heater');
    expect(plan({}, 2).hacks.map((h) => h.id)).toContain('kitchen-exhaust');
  });

  it('adds gap sealing only on poor days and always sorts by priority', () => {
    expect(plan({}, 2).hacks.map((h) => h.id)).not.toContain('seal-gaps');
    const poor = plan({}, 3);
    expect(poor.hacks.map((h) => h.id)).toContain('seal-gaps');
    const priorities = poor.hacks.map((h) => h.priority);
    expect(priorities).toEqual([...priorities].sort());
    expect(poor.hacks.at(-1)?.id).toBe('plants-myth');
  });
});

describe('computeModeImpact', () => {
  it('derives time, emissions and inhaled dose from transparent factors', () => {
    // 20 km/day at 24 km/h; 100 km/week; 100 µg/m³ × 0.8 × 0.6 m³/h × 0.833 h
    expect(computeModeImpact('car_petrol', 10, 100)).toEqual({
      mode: 'car_petrol',
      label: 'Petrol car (alone)',
      minutesPerDay: 50,
      co2KgPerWeek: 15,
      noxGPerWeek: 6,
      pm25EmittedGPerWeek: 2,
      inhaledPm25UgPerDay: 40,
    });
  });

  it('has a complete, non-negative profile for every mode', () => {
    for (const profile of Object.values(MODE_PROFILES)) {
      expect(profile.co2KgPerKm).toBeGreaterThanOrEqual(0);
      expect(profile.speedKmh).toBeGreaterThan(0);
      expect(profile.exposureRatio).toBeGreaterThan(0);
    }
  });
});

describe('compareCommute', () => {
  const family = makeHousehold({
    lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'two_wheeler', commuteKm: 10 },
  });

  it('puts options that are safe today ahead of bigger CO₂ savings on smoggy days', () => {
    const result = compareCommute(family, 100, 3);
    expect(result?.current.inhaledPm25UgPerDay).toBe(74);
    expect(result?.alternatives.map((a) => [a.mode, a.suitableToday])).toEqual([
      ['metro', true],
      ['bicycle', false],
      ['bus', false],
    ]);
    expect(result?.alternatives[0]).toMatchObject({
      co2SavedKgPerYear: 120,
      inhaledChangePct: -68,
    });
  });

  it('treats every lower-emission option as suitable on clean days', () => {
    const result = compareCommute(family, 20, 1);
    expect(result?.alternatives.every((a) => a.suitableToday)).toBe(true);
    expect(result?.alternatives[0]?.mode).toBe('bicycle');
  });

  it('offers carpooling and EVs to car drivers and walking only for short trips', () => {
    const car = compareCommute(
      makeHousehold({
        lifestyle: { ...family.lifestyle, commuteMode: 'car_diesel', commuteKm: 2 },
      }),
      50,
      1,
    );
    expect(car?.alternatives.map((a) => a.mode)).toEqual(
      expect.arrayContaining(['carpool', 'ev_car', 'walk', 'bicycle']),
    );
    const long = compareCommute(
      makeHousehold({ lifestyle: { ...family.lifestyle, commuteKm: 25 } }),
      50,
      1,
    );
    expect(long?.alternatives.map((a) => a.mode)).not.toContain('walk');
    expect(long?.alternatives.map((a) => a.mode)).not.toContain('bicycle');
  });

  it('returns null without a commute', () => {
    expect(
      compareCommute(
        makeHousehold({ lifestyle: { ...family.lifestyle, commuteMode: 'none' } }),
        50,
        1,
      ),
    ).toBeNull();
    expect(
      compareCommute(makeHousehold({ lifestyle: { ...family.lifestyle, commuteKm: 0 } }), 50, 1),
    ).toBeNull();
  });

  it('writes notes consistent with the safety gate', () => {
    expect(alternativeNote('ev_car', 0, true)).toMatch(/next vehicle/);
    expect(alternativeNote('bicycle', 300, false)).toMatch(/best on cleaner days/);
    expect(alternativeNote('bicycle', 300, true)).toMatch(/daily exercise/);
    expect(alternativeNote('bus', 60, false)).toMatch(/raises your exposure/);
    expect(alternativeNote('bus', 10, true)).toMatch(/small rise/);
    expect(alternativeNote('metro', -40, true)).toMatch(/lower personal exposure/);
  });
});

describe('buildSustainableActions', () => {
  it("quantifies the default family's actions", () => {
    const household = makeHousehold();
    const actions = buildSustainableActions(household, compareCommute(household, 100, 3), INDIA);
    expect(actions.map((a) => a.id)).toEqual([
      'switch-commute',
      'no-idling',
      'never-burn-waste',
      'save-electricity',
    ]);
    expect(actions[0]?.perHousehold).toEqual({
      co2KgPerYear: 120,
      pm25GPerYear: 53,
      noxGPerYear: 480,
    });
    expect(actions[1]?.perHousehold.co2KgPerYear).toBe(14);
    expect(actions[2]?.perHousehold.pm25GPerYear).toBe(
      ACTION_FACTORS.assumedBurnedKgPerWeek * 52 * ACTION_FACTORS.openBurningPm25GPerKg,
    );
    expect(actions[3]?.perHousehold.co2KgPerYear).toBe(263);
  });

  it('scales every figure by the number of households acting together', () => {
    const household = makeHousehold({ communityHouseholds: 50 });
    const actions = buildSustainableActions(household, compareCommute(household, 100, 3), INDIA);
    for (const action of actions) {
      for (const key of ['co2KgPerYear', 'pm25GPerYear', 'noxGPerYear'] as const) {
        const one = action.perHousehold[key];
        expect(action.community[key]).toBe(one === null ? null : Math.round(one * 50));
      }
    }
  });

  it('adds home-working, clean-cooking and clean-heating actions when relevant', () => {
    const household = makeHousehold({
      lifestyle: {
        ...makeHousehold().lifestyle,
        commuteMode: 'car_petrol',
        workFromHomePossible: true,
        cookingFuel: 'biomass',
        heating: 'wood_or_coal',
      },
    });
    const ids = buildSustainableActions(household, compareCommute(household, 100, 3), INDIA).map(
      (a) => a.id,
    );
    expect(ids).toEqual(
      expect.arrayContaining(['wfh-day', 'no-idling', 'clean-cooking-fuel', 'clean-heating']),
    );
  });

  it('skips commute actions for people who do not commute', () => {
    const household = makeHousehold({
      lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'none' },
    });
    expect(buildSustainableActions(household, null, INDIA).map((a) => a.id)).toEqual([
      'never-burn-waste',
      'save-electricity',
    ]);
  });

  it('converts CO₂ into tree-equivalents', () => {
    expect(treesEquivalent(210)).toBe(10);
  });
});
