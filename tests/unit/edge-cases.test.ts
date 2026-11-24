import { describe, expect, it } from 'vitest';
import { buildBrief, type AirBrief } from '../../src/domain/brief.js';
import type { TimeWindow } from '../../src/domain/types.js';
import { briefToContext } from '../../src/services/assistant/prompt.js';
import { composeRuleAnswer } from '../../src/services/assistant/ruleResponder.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const household = makeHousehold({ communityHouseholds: 5 });
const base = buildBrief({
  location: DELHI,
  air: makeAir(),
  weather: makeWeather(),
  household,
  standard: 'auto',
});
const severe = buildBrief({
  location: DELHI,
  air: makeAir({ scale: 4 }),
  weather: makeWeather(),
  household,
  standard: 'auto',
});

const window = (
  level: 0 | 1 | 2 | 3 | 4 | 5,
  aqi: number,
  start = '2026-11-24T15:00',
): TimeWindow => ({
  start,
  end: '2026-11-24T16:00',
  averageAqi: aqi,
  peakAqi: aqi,
  level,
});

const withWindows = (windows: Partial<AirBrief['forecast']['windows']>): AirBrief => ({
  ...base,
  forecast: { ...base.forecast, windows: { ...base.forecast.windows, ...windows } },
});

describe('rule answers describe every kind of time window', () => {
  it('labels clean, fair and still-polluted windows, and missing ones', () => {
    expect(composeRuleAnswer('best_time', withWindows({ outdoor: window(1, 60) }))).toMatch(
      /AQI ~60, clean/,
    );
    expect(composeRuleAnswer('best_time', withWindows({ outdoor: window(2, 140) }))).toMatch(
      /AQI ~140, fair/,
    );
    expect(composeRuleAnswer('best_time', withWindows({ outdoor: window(4, 320) }))).toMatch(
      /AQI ~320, still polluted/,
    );
    const none = composeRuleAnswer(
      'best_time',
      withWindows({ outdoor: null, ventilation: null, play: null, worst: null }),
    );
    expect(none).toMatch(/none clean enough/);
    expect(none).toMatch(/keep windows shut today/);
    expect(none).toMatch(/indoor play today/);
    expect(none).toMatch(/no major peak forecast/);
  });

  it('marks next-day windows as tomorrow', () => {
    const tomorrow = withWindows({ worst: window(4, 320, '2026-11-25T07:00') });
    expect(composeRuleAnswer('best_time', tomorrow)).toMatch(/07:00–16:00 tomorrow|tomorrow/);
  });

  it('copes with a brief without routine steps or risk reasons', () => {
    const sparse: AirBrief = {
      ...base,
      routine: [],
      risk: { ...base.risk, reasons: [] },
    };
    expect(composeRuleAnswer('status', sparse)).toMatch(/Top tip: Build a DIY fan filter|Top tip:/);
    expect(composeRuleAnswer('outdoor', sparse)).not.toMatch(/Children \(/);
  });
});

describe('local rules in answers and prompt', () => {
  it('mentions GRAP in the smog answer only when a stage applies', () => {
    expect(composeRuleAnswer('smog', severe)).toMatch(/GRAP\)?: Stage/);
    expect(composeRuleAnswer('smog', base)).not.toMatch(/GRAP/);
  });

  it('passes local rules, emergency number and community headline to the model', () => {
    const facts = JSON.parse(briefToContext(severe, household)) as Record<string, unknown>;
    expect(facts.emergencyNumber).toBe('112 (ambulance 108)');
    expect(facts.localSmogRules).toMatchObject({ plan: expect.stringMatching(/GRAP/) });
    expect(facts.communityHeadline).toMatchObject({ households: 5 });
    const calm = JSON.parse(briefToContext(withWindows({ outdoor: null }), household)) as {
      localSmogRules: unknown;
      windows: { cleanestHourForExercise: unknown };
    };
    expect(calm.localSmogRules).toBeNull();
    expect(calm.windows.cleanestHourForExercise).toBeNull();
  });

  it('falls back to a generic street-level phrase for unquantified actions', () => {
    const unquantified: AirBrief = {
      ...base,
      actions: base.actions.map((a) => ({
        ...a,
        community: { co2KgPerYear: null, pm25GPerYear: null, noxGPerYear: null },
      })),
    };
    expect(composeRuleAnswer('community', unquantified)).toMatch(/cleaner air at street level/);
  });
});

describe('unit-explicit quantities for the model', () => {
  it('formats grams, kilograms and tonnes explicitly', async () => {
    const { formatGrams, describeQuantity } =
      await import('../../src/services/assistant/prompt.js');
    expect(formatGrams(950)).toBe('950 g');
    expect(formatGrams(52_000)).toBe('52 kg');
    expect(formatGrams(2_500_000)).toBe('2.5 t');
    expect(describeQuantity({ co2KgPerYear: 749, pm25GPerYear: 52_000, noxGPerYear: 480 })).toBe(
      '749 kg CO2, 52 kg PM2.5, 480 g NOx per year',
    );
    expect(describeQuantity({ co2KgPerYear: null, pm25GPerYear: null, noxGPerYear: 0 })).toBe(
      'not quantified',
    );
  });

  it('never exposes raw gram-coded fields to the model', () => {
    const context = briefToContext(severe, household);
    expect(context).not.toMatch(/pm25GPerYear|noxGPerYear|co2KgPerYear/);
    expect(context).toMatch(/kg PM2\.5 per year/);
  });
});
