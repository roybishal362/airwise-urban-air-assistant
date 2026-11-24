import { describe, expect, it } from 'vitest';
import {
  MAX_INDEX,
  calculateAqi,
  categoryFor,
  convertFromMicrograms,
  resolveStandard,
  subIndex,
  truncate,
} from '../../src/domain/aqi/calculator.js';
import { STANDARDS } from '../../src/domain/aqi/standards.js';
import { POLLUTANT_IDS } from '../../src/domain/types.js';

/** WCAG 2.x relative luminance / contrast ratio. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('truncate', () => {
  it('truncates instead of rounding, as the EPA method requires', () => {
    expect(truncate(35.49, 1)).toBe(35.4);
    expect(truncate(54.9, 0)).toBe(54);
  });

  it('is robust to binary floating-point artefacts', () => {
    expect(truncate(35.4, 1)).toBe(35.4);
    expect(truncate(0.3, 1)).toBe(0.3);
  });
});

describe('convertFromMicrograms', () => {
  it('converts gases to ppb/ppm at 25 °C', () => {
    expect(convertFromMicrograms(100, 'ppb', 'o3')).toBeCloseTo(50.94, 2);
    expect(convertFromMicrograms(1145.6, 'ppm', 'co')).toBeCloseTo(1.0, 2);
  });

  it('converts µg/m³ to mg/m³ and passes µg/m³ through', () => {
    expect(convertFromMicrograms(2500, 'mg/m3', 'co')).toBe(2.5);
    expect(convertFromMicrograms(42, 'ug/m3', 'pm2_5')).toBe(42);
  });

  it('refuses to convert particles to a gas unit', () => {
    expect(() => convertFromMicrograms(10, 'ppb', 'pm2_5')).toThrow(/not a gas/);
  });
});

describe('US EPA sub-indices (2024 PM2.5 breakpoints)', () => {
  it.each([
    [0, 0],
    [9.0, 50],
    [9.1, 51],
    [12.0, 56],
    [35.4, 100],
    [35.5, 101],
    [55.4, 150],
    [125.5, 201],
    [325.4, 500],
  ])('PM2.5 %d µg/m³ → %d', (c, expected) => {
    expect(subIndex(c, 'pm2_5', 'us')).toBe(expected);
  });

  it('caps concentrations above the table at 500', () => {
    expect(subIndex(900, 'pm2_5', 'us')).toBe(MAX_INDEX);
  });

  it('converts ozone from µg/m³ before the lookup', () => {
    // 123 µg/m³ ≈ 62.7 ppb → truncated to 62 → 51 + 49/15 × 7 ≈ 74
    expect(subIndex(123, 'o3', 'us')).toBe(74);
  });

  it('ignores missing, negative or non-finite values', () => {
    expect(subIndex(null, 'pm2_5', 'us')).toBeNull();
    expect(subIndex(undefined, 'pm2_5', 'us')).toBeNull();
    expect(subIndex(-1, 'pm2_5', 'us')).toBeNull();
    expect(subIndex(Number.NaN, 'pm2_5', 'us')).toBeNull();
  });
});

describe('India NAQI sub-indices (CPCB)', () => {
  it.each([
    [30, 50],
    [31, 51],
    [45, 75],
    [60, 100],
    [90, 200],
    [250, 400],
    [251, 401],
  ])('PM2.5 %d µg/m³ → %d', (c, expected) => {
    expect(subIndex(c, 'pm2_5', 'in')).toBe(expected);
  });

  it('clamps values that fall between two integer bands', () => {
    // 30.5 truncates to 30 (Good); 60.9 truncates to 60 (top of Satisfactory)
    expect(subIndex(30.5, 'pm2_5', 'in')).toBe(50);
    expect(subIndex(60.9, 'pm2_5', 'in')).toBe(100);
  });

  it('uses mg/m³ for carbon monoxide', () => {
    expect(subIndex(2000, 'co', 'in')).toBe(100);
  });
});

describe('calculateAqi', () => {
  it('reports the maximum sub-index and its pollutant as dominant', () => {
    const reading = calculateAqi({ pm2_5: 80, pm10: 120, no2: 30, o3: 50 }, 'in');
    expect(reading).not.toBeNull();
    expect(reading?.value).toBe(166); // 101 + 99/29 × (80 − 61)
    expect(reading?.dominantPollutant).toBe('pm2_5');
    expect(reading?.category.label).toBe('Moderate');
    expect(Object.keys(reading?.subIndices ?? {})).toEqual(['pm2_5', 'pm10', 'no2', 'o3']);
  });

  it('breaks ties in favour of PM2.5 for deterministic output', () => {
    const reading = calculateAqi({ pm2_5: 30, pm10: 50 }, 'in');
    expect(reading?.value).toBe(50);
    expect(reading?.dominantPollutant).toBe('pm2_5');
  });

  it('returns null when no pollutant is usable', () => {
    expect(calculateAqi({ pm2_5: null, no2: undefined }, 'us')).toBeNull();
    expect(calculateAqi({}, 'in')).toBeNull();
  });
});

describe('categoryFor', () => {
  it('maps index values to categories and severity levels', () => {
    expect(categoryFor(0, 'us')).toMatchObject({ level: 0, label: 'Good' });
    expect(categoryFor(150, 'us')).toMatchObject({
      level: 2,
      label: 'Unhealthy for Sensitive Groups',
    });
    expect(categoryFor(450, 'in')).toMatchObject({ level: 5, label: 'Severe' });
    expect(categoryFor(999, 'us')).toMatchObject({ level: 5 });
  });

  it('does not leak the internal min/max fields', () => {
    expect(categoryFor(10, 'in')).not.toHaveProperty('min');
  });
});

describe('resolveStandard', () => {
  it('uses India NAQI for Indian places in auto mode', () => {
    expect(resolveStandard('auto', { countryCode: 'in' })).toBe('in');
    expect(resolveStandard('auto', { timezone: 'Asia/Kolkata' })).toBe('in');
    expect(resolveStandard('auto', { timezone: 'Asia/Calcutta' })).toBe('in');
  });

  it('defaults to the US AQI elsewhere and honours explicit choices', () => {
    expect(resolveStandard('auto', { countryCode: 'GB', timezone: 'Europe/London' })).toBe('us');
    expect(resolveStandard('auto', {})).toBe('us');
    expect(resolveStandard('us', { countryCode: 'IN' })).toBe('us');
  });
});

describe('standard tables', () => {
  for (const standard of Object.values(STANDARDS)) {
    it(`${standard.id}: bands are ordered and end at 500`, () => {
      for (const pollutant of POLLUTANT_IDS) {
        const { bands } = standard.scales[pollutant];
        expect(bands).toHaveLength(6);
        bands.forEach((band, i) => {
          expect(band.cHigh).toBeGreaterThan(band.cLow);
          expect(band.iHigh).toBeGreaterThan(band.iLow);
          if (i > 0) expect(band.cLow).toBeGreaterThan(bands[i - 1]?.cHigh ?? Infinity);
        });
        expect(bands.at(-1)?.iHigh).toBe(500);
      }
    });

    it(`${standard.id}: every category colour pair meets WCAG AA contrast`, () => {
      for (const category of standard.categories) {
        expect(contrast(category.color, category.textColor), category.label).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }
});
