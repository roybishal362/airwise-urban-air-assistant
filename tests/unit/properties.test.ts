import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateAqi, categoryFor, subIndex } from '../../src/domain/aqi/calculator.js';
import { buildBrief } from '../../src/domain/brief.js';
import { findWindow } from '../../src/domain/forecast.js';
import {
  COMMUTE_MODES,
  COOKING_FUELS,
  HEALTH_CONDITIONS,
  HEATING_TYPES,
  householdSchema,
  type Household,
} from '../../src/domain/household.js';
import { estimateIndoorPm25, roomVolume } from '../../src/domain/indoor.js';
import { addHours } from '../../src/domain/time.js';
import {
  POLLUTANT_IDS,
  type HourlyIndex,
  type SeverityLevel,
  type StandardId,
} from '../../src/domain/types.js';
import { sanitizeUserText } from '../../src/services/assistant/prompt.js';
import { DELHI, makeAir, makeWeather } from '../fixtures/data.js';

/**
 * Property-based tests: instead of a few hand-picked examples, fast-check
 * generates hundreds of random inputs and checks invariants that must hold
 * for every one of them (and shrinks any failure to a minimal case).
 */

const standard = fc.constantFrom<StandardId>('us', 'in');
const pollutant = fc.constantFrom(...POLLUTANT_IDS);
const concentration = fc.double({ min: 0, max: 5000, noNaN: true });

const householdArb: fc.Arbitrary<Household> = fc.record({
  members: fc
    .record({
      adults: fc.integer({ min: 0, max: 20 }),
      children: fc.integer({ min: 0, max: 20 }),
      seniors: fc.integer({ min: 0, max: 20 }),
    })
    .filter((m) => m.adults + m.children + m.seniors > 0),
  conditions: fc.uniqueArray(fc.constantFrom(...HEALTH_CONDITIONS)),
  home: fc.record({
    roomAreaSqm: fc.integer({ min: 4, max: 200 }),
    hasAirPurifier: fc.boolean(),
    purifierCadrM3h: fc.integer({ min: 0, max: 2000 }),
  }),
  lifestyle: fc.record({
    commuteMode: fc.constantFrom(...COMMUTE_MODES),
    commuteKm: fc.integer({ min: 0, max: 200 }),
    workFromHomePossible: fc.boolean(),
    cookingFuel: fc.constantFrom(...COOKING_FUELS),
    heating: fc.constantFrom(...HEATING_TYPES),
    exercisesOutdoors: fc.boolean(),
  }),
  communityHouseholds: fc.integer({ min: 1, max: 10_000 }),
});

describe('AQI invariants', () => {
  it('sub-indices are bounded to 0–500 and never decrease as pollution rises', () => {
    fc.assert(
      fc.property(standard, pollutant, concentration, concentration, (std, id, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const lowIndex = subIndex(low, id, std) ?? -1;
        const highIndex = subIndex(high, id, std) ?? -1;
        expect(lowIndex).toBeGreaterThanOrEqual(0);
        expect(highIndex).toBeLessThanOrEqual(500);
        expect(highIndex).toBeGreaterThanOrEqual(lowIndex);
      }),
      { numRuns: 500 },
    );
  });

  it('the overall AQI is the largest sub-index and its category matches', () => {
    fc.assert(
      fc.property(
        standard,
        fc.dictionary(pollutant, concentration, { minKeys: 1 }),
        (std, concentrations) => {
          const reading = calculateAqi(concentrations, std);
          expect(reading).not.toBeNull();
          const subs = Object.values(reading?.subIndices ?? {});
          expect(reading?.value).toBe(Math.max(...subs));
          expect(reading?.category).toEqual(categoryFor(reading?.value ?? 0, std));
          expect(reading?.subIndices[reading.dominantPollutant]).toBe(reading?.value);
        },
      ),
    );
  });
});

describe('indoor model invariants', () => {
  it('indoor PM2.5 never exceeds the penetrating share and falls as filtration rises', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 4, max: 200 }),
        (outdoor, cadrA, cadrB, area) => {
          const volume = roomVolume(area);
          const [weak, strong] = cadrA <= cadrB ? [cadrA, cadrB] : [cadrB, cadrA];
          const withWeak = estimateIndoorPm25(outdoor, weak, volume);
          const withStrong = estimateIndoorPm25(outdoor, strong, volume);
          expect(withWeak).toBeLessThanOrEqual(Math.round(outdoor * 0.8) + 1);
          expect(withStrong).toBeLessThanOrEqual(withWeak);
          expect(withStrong).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('forecast window invariants', () => {
  const series = fc
    .array(fc.integer({ min: 0, max: 500 }), { minLength: 1, maxLength: 48 })
    .map((values): HourlyIndex[] =>
      values.map((aqi, i) => ({
        time: addHours('2026-11-24T00:00', i),
        aqi,
        level: Math.min(5, Math.floor(aqi / 100)) as SeverityLevel,
        label: 'x',
      })),
    );

  it('the "best" window is never worse than any other window of the same length', () => {
    fc.assert(
      fc.property(series, fc.integer({ min: 1, max: 6 }), (points, duration) => {
        const best = findWindow(points, duration, 'best');
        if (duration > points.length) {
          expect(best).toBeNull();
          return;
        }
        for (let i = 0; i + duration <= points.length; i += 1) {
          const avg = points.slice(i, i + duration).reduce((s, p) => s + p.aqi, 0) / duration;
          expect(best?.averageAqi ?? Infinity).toBeLessThanOrEqual(Math.round(avg));
        }
      }),
    );
  });
});

describe('prompt sanitisation invariants', () => {
  it('output is bounded, tag-free, control-free and idempotent', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000, unit: 'binary' }), (text) => {
        const clean = sanitizeUserText(text);
        expect(clean.length).toBeLessThanOrEqual(600);
        expect(clean).not.toMatch(/[<>]/);
        expect([...clean].some((ch) => ch.charCodeAt(0) < 32 && !'\t\n\r'.includes(ch))).toBe(
          false,
        );
        expect(sanitizeUserText(clean)).toBe(clean);
      }),
      { numRuns: 300 },
    );
  });
});

describe('whole-pipeline fuzzing', () => {
  const air = makeAir();
  const weather = makeWeather();

  it('every valid household yields a complete brief with finite numbers and no broken text', () => {
    fc.assert(
      fc.property(
        householdArb,
        fc.constantFrom('auto', 'us', 'in') as fc.Arbitrary<'auto' | 'us' | 'in'>,
        (household, std) => {
          expect(householdSchema.safeParse(household).success).toBe(true);
          const brief = buildBrief({ location: DELHI, air, weather, household, standard: std });
          const json = JSON.stringify(brief);
          expect(json).not.toMatch(/NaN|Infinity|undefined|\[object/);
          expect(brief.routine.length).toBeGreaterThanOrEqual(2);
          expect(brief.indoor.hacks.length).toBeGreaterThanOrEqual(3);
          expect(brief.actions.length).toBeGreaterThanOrEqual(2);
          expect(brief.community.total.co2KgPerYear).toBeGreaterThanOrEqual(0);
          for (const action of brief.actions) {
            for (const value of Object.values(action.community)) {
              if (value !== null) expect(Number.isFinite(value)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
