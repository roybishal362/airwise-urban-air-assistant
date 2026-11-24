import { describe, expect, it } from 'vitest';
import { categoryFor } from '../../src/domain/aqi/calculator.js';
import { buildBrief } from '../../src/domain/brief.js';
import {
  PM25_PER_CIGARETTE,
  WHO_PM25_24H,
  buildGlance,
  exposureEquivalents,
  type GlanceInput,
} from '../../src/domain/glance.js';
import { compareCommute } from '../../src/domain/impact/index.js';
import type { AqiReading, PollutantId, TimeWindow } from '../../src/domain/types.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const reading = (value: number, dominant: PollutantId = 'pm2_5'): AqiReading => ({
  standard: 'in',
  value,
  category: categoryFor(value, 'in'),
  dominantPollutant: dominant,
  subIndices: {},
});

const w = (level: 0 | 1 | 2 | 3 | 4 | 5, aqi: number, start = '2026-11-24T15:00'): TimeWindow => ({
  start,
  end: '2026-11-24T16:00',
  averageAqi: aqi,
  peakAqi: aqi,
  level,
});

const input = (overrides: Partial<GlanceInput> = {}): GlanceInput => {
  const household = overrides.household ?? makeHousehold();
  return {
    reading: reading(80),
    windows: { outdoor: w(1, 70), ventilation: w(1, 70), play: w(1, 70), worst: null },
    commute: compareCommute(household, 40, 1),
    household,
    now: '2026-11-24T09:00',
    ...overrides,
  };
};

const tile = (tiles: ReturnType<typeof buildGlance>, id: string) => tiles.find((t) => t.id === id);

describe('buildGlance', () => {
  it('gives a clean day five green decisions', () => {
    const tiles = buildGlance(input());
    expect(tiles.map((t) => t.id)).toEqual(['mask', 'windows', 'exercise', 'kids', 'commute']);
    expect(tiles.every((t) => t.tone === 'good')).toBe(true);
    expect(tile(tiles, 'windows')?.value).toBe('Open 15:00–16:00');
  });

  it('escalates mask advice for particles and explains gases', () => {
    expect(tile(buildGlance(input({ reading: reading(150) })), 'mask')).toMatchObject({
      value: 'N95 for sensitive',
      tone: 'caution',
    });
    expect(tile(buildGlance(input({ reading: reading(320) })), 'mask')).toMatchObject({
      value: 'N95 outdoors',
      tone: 'bad',
    });
    expect(tile(buildGlance(input({ reading: reading(150, 'o3') })), 'mask')?.detail).toMatch(
      /masks do not filter/,
    );
  });

  it('keeps windows shut, exercise and play indoors on polluted days', () => {
    const smoggy = buildGlance(
      input({
        reading: reading(320),
        windows: { outdoor: w(4, 320), ventilation: w(4, 320), play: w(4, 320), worst: null },
      }),
    );
    expect(tile(smoggy, 'windows')).toMatchObject({ value: 'Keep shut', tone: 'bad' });
    expect(tile(smoggy, 'exercise')).toMatchObject({ value: 'Indoors today', tone: 'bad' });
    expect(tile(smoggy, 'exercise')?.detail).toMatch(/AQI ~320/);
    expect(tile(smoggy, 'kids')).toMatchObject({ value: 'Indoor play', tone: 'bad' });
    const none = buildGlance(
      input({ windows: { outdoor: null, ventilation: null, play: null, worst: null } }),
    );
    expect(tile(none, 'exercise')?.detail).toMatch(/No clean hour/);
  });

  it('offers short play on fair afternoons and labels tomorrow', () => {
    const tiles = buildGlance(
      input({
        windows: {
          outdoor: w(1, 70, '2026-11-25T07:00'),
          ventilation: w(1, 70),
          play: w(2, 140),
          worst: null,
        },
      }),
    );
    expect(tile(tiles, 'kids')).toMatchObject({ value: 'Short play 15:00–16:00', tone: 'caution' });
    expect(tile(tiles, 'exercise')?.value).toBe('Outdoors 07:00–16:00 tomorrow');
  });

  it('applies the stricter exercise threshold for sensitive families', () => {
    const fair = { outdoor: w(2, 140), ventilation: w(2, 140), play: null, worst: null };
    expect(tile(buildGlance(input({ windows: fair })), 'exercise')?.tone).toBe('bad');
    const adults = makeHousehold({ members: { adults: 2, children: 0, seniors: 0 } });
    const tiles = buildGlance(input({ household: adults, windows: fair, commute: null }));
    expect(tile(tiles, 'exercise')?.tone).toBe('good');
    expect(tiles.map((t) => t.id)).toEqual(['mask', 'windows', 'exercise']);
  });

  it('suggests protection when the commute is already low-emission', () => {
    const metro = makeHousehold({
      lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'metro' },
    });
    expect(
      tile(
        buildGlance(input({ household: metro, commute: compareCommute(metro, 200, 4) })),
        'commute',
      ),
    ).toMatchObject({
      value: 'Protect yourself',
      tone: 'caution',
    });
  });
});

describe('exposureEquivalents', () => {
  it('converts PM2.5 into cigarettes a day and multiples of the WHO limit', () => {
    expect(exposureEquivalents(PM25_PER_CIGARETTE * 3)).toEqual({
      pm25: 66,
      cigarettesPerDay: 3,
      whoMultiple: 4.4,
    });
    expect(exposureEquivalents(WHO_PM25_24H)).toMatchObject({ whoMultiple: 1 });
    expect(exposureEquivalents(-5)).toEqual({ pm25: 0, cigarettesPerDay: 0, whoMultiple: 0 });
  });

  it('is part of every brief, together with gauge bands', () => {
    const brief = buildBrief({
      location: DELHI,
      air: makeAir(),
      weather: makeWeather(),
      household: makeHousehold(),
      standard: 'auto',
    });
    expect(brief.exposure.cigarettesPerDay).toBeCloseTo(63.8 / 22, 1);
    expect(brief.standard.bands).toHaveLength(6);
    expect(brief.standard.bands[0]).toEqual({ min: 0, max: 50, label: 'Good', color: '#009933' });
    expect(brief.glance.length).toBeGreaterThanOrEqual(3);
  });
});
