import { describe, expect, it } from 'vitest';
import { categoryFor } from '../../src/domain/aqi/calculator.js';
import {
  DEFAULT_HOUSEHOLD,
  assessVulnerability,
  formatList,
  householdSchema,
  householdSize,
} from '../../src/domain/household.js';
import { assessFamilyRisk, verdictFor } from '../../src/domain/risk.js';
import { analyzeSmog } from '../../src/domain/smog.js';
import type { AqiReading } from '../../src/domain/types.js';
import { makeHousehold, makeWeather } from '../fixtures/data.js';

const reading = (value: number): AqiReading => ({
  standard: 'in',
  value,
  category: categoryFor(value, 'in'),
  dominantPollutant: 'pm2_5',
  subIndices: { pm2_5: value },
});

describe('householdSchema', () => {
  it('accepts the default household', () => {
    expect(householdSchema.parse(DEFAULT_HOUSEHOLD)).toEqual(DEFAULT_HOUSEHOLD);
  });

  it('removes duplicate conditions', () => {
    const parsed = householdSchema.parse({
      ...DEFAULT_HOUSEHOLD,
      conditions: ['asthma', 'asthma'],
    });
    expect(parsed.conditions).toEqual(['asthma']);
  });

  it('rejects unknown keys, empty households and out-of-range values', () => {
    expect(householdSchema.safeParse({ ...DEFAULT_HOUSEHOLD, extra: 1 }).success).toBe(false);
    expect(
      householdSchema.safeParse({
        ...DEFAULT_HOUSEHOLD,
        members: { adults: 0, children: 0, seniors: 0 },
      }).success,
    ).toBe(false);
    expect(
      householdSchema.safeParse({
        ...DEFAULT_HOUSEHOLD,
        home: { ...DEFAULT_HOUSEHOLD.home, roomAreaSqm: 1 },
      }).success,
    ).toBe(false);
    expect(householdSchema.safeParse({ ...DEFAULT_HOUSEHOLD, conditions: ['flu'] }).success).toBe(
      false,
    );
    expect(
      householdSchema.safeParse({ ...DEFAULT_HOUSEHOLD, communityHouseholds: 0.5 }).success,
    ).toBe(false);
  });
});

describe('vulnerability helpers', () => {
  it('lists sensitive groups in plain language', () => {
    const v = assessVulnerability(
      makeHousehold({ conditions: ['asthma', 'allergies', 'heart_disease'] }),
    );
    expect(v.isSensitive).toBe(true);
    expect(v.groups).toEqual([
      'children',
      'older adults',
      'the family member with asthma',
      'the family member with heart disease',
    ]);
    expect(v.hasRespiratory).toBe(true);
    expect(v.hasCardiac).toBe(true);
  });

  it('treats a household of healthy adults as not sensitive', () => {
    const v = assessVulnerability(
      makeHousehold({ members: { adults: 2, children: 0, seniors: 0 } }),
    );
    expect(v).toEqual({ isSensitive: false, groups: [], hasRespiratory: false, hasCardiac: false });
  });

  it('formats lists and counts members', () => {
    expect(formatList([])).toBe('');
    expect(formatList(['a'])).toBe('a');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b and c');
    expect(householdSize(DEFAULT_HOUSEHOLD)).toBe(4);
  });
});

describe('assessFamilyRisk', () => {
  const adultsOnly = makeHousehold({ members: { adults: 2, children: 0, seniors: 0 } });

  it('maps levels to verdicts', () => {
    expect([0, 1, 2, 3, 4, 5].map((l) => verdictFor(l as 0))).toEqual([
      'normal',
      'normal',
      'take_care',
      'limit_outdoor',
      'stay_indoors',
      'stay_indoors',
    ]);
  });

  it('does not raise risk on a clean day, even for sensitive families', () => {
    const risk = assessFamilyRisk(reading(40), makeHousehold({ conditions: ['asthma'] }));
    expect(risk.level).toBe(0);
    expect(risk.verdict).toBe('normal');
    expect(risk.memberAdvice.some((m) => m.who.includes('asthma'))).toBe(false);
  });

  it('raises risk by one level for sensitive members and says who for', () => {
    const risk = assessFamilyRisk(reading(150), makeHousehold());
    expect(risk.level).toBe(3);
    expect(risk.verdict).toBe('limit_outdoor');
    expect(risk.headline).toMatch(/children and older adults/);
    expect(risk.reasons.join(' ')).toMatch(/raise the family's risk by one level/);
  });

  it('keeps the healthy-adult household at the air level', () => {
    const risk = assessFamilyRisk(reading(150), adultsOnly);
    expect(risk.level).toBe(2);
    expect(risk.memberAdvice).toEqual([
      { who: 'Adults', advice: expect.stringContaining('Fine for most adults') },
    ]);
  });

  it('tells everyone to stay in on very poor days', () => {
    expect(assessFamilyRisk(reading(350), adultsOnly).headline).toMatch(/Stay indoors/);
    expect(assessFamilyRisk(reading(250), makeHousehold()).headline).toMatch(
      /Keep children and older adults indoors/,
    );
    expect(assessFamilyRisk(reading(250), adultsOnly).headline).toMatch(
      /limit outdoor time for everyone/,
    );
  });

  it('adds condition-specific advice and smog context', () => {
    const risk = assessFamilyRisk(
      reading(120),
      makeHousehold({
        conditions: ['asthma', 'copd', 'heart_disease', 'diabetes', 'pregnancy', 'allergies'],
      }),
      analyzeSmog(makeWeather().hourly),
    );
    expect(risk.memberAdvice.filter((m) => m.who.startsWith('Family member'))).toHaveLength(6);
    expect(risk.reasons.join(' ')).toMatch(/Smog-trap risk is severe/);
  });

  it('gives graded advice to children and older adults', () => {
    const family = makeHousehold();
    expect(assessFamilyRisk(reading(40), family).memberAdvice.map((m) => m.advice)).toContain(
      'Outdoor play is fine.',
    );
    expect(
      assessFamilyRisk(reading(250), family).memberAdvice.find((m) => m.who === 'Children')?.advice,
    ).toMatch(/Move play indoors/);
    expect(
      assessFamilyRisk(reading(450), family).memberAdvice.find((m) => m.who === 'Children')?.advice,
    ).toMatch(/child-size N95/);
    expect(
      assessFamilyRisk(reading(450), family).memberAdvice.find((m) => m.who === 'Older adults')
        ?.advice,
    ).toMatch(/Stay indoors/);
    expect(
      assessFamilyRisk(reading(450), family).memberAdvice.find((m) => m.who === 'Adults')?.advice,
    ).toMatch(/Avoid outdoor exercise/);
    expect(
      assessFamilyRisk(reading(250), family).memberAdvice.find((m) => m.who === 'Adults')?.advice,
    ).toMatch(/Reduce long/);
  });
});
