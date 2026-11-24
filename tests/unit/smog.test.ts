import { describe, expect, it } from 'vitest';
import { analyzeSmog, classifyDispersion, ventilationCoefficient } from '../../src/domain/smog.js';
import { addHours } from '../../src/domain/time.js';
import type { HourlyWeather } from '../../src/domain/types.js';
import { makeWeather } from '../fixtures/data.js';

const hours = (count: number, overrides: Partial<HourlyWeather> = {}): HourlyWeather[] =>
  Array.from({ length: count }, (_, i) => ({
    time: addHours('2026-11-24T00:00', i),
    temperatureC: 20,
    humidityPct: 50,
    windKmh: 18,
    boundaryLayerM: 1500,
    ...overrides,
  }));

describe('ventilation coefficient', () => {
  it('multiplies mixing height by wind speed in m/s', () => {
    expect(ventilationCoefficient(1000, 36)).toBe(10_000);
    expect(ventilationCoefficient(50, 3.6)).toBe(50);
  });

  it('is unknown when an input is missing or invalid', () => {
    expect(ventilationCoefficient(null, 5)).toBeNull();
    expect(ventilationCoefficient(500, null)).toBeNull();
    expect(ventilationCoefficient(-1, 5)).toBeNull();
  });

  it('classifies dispersion', () => {
    expect(classifyDispersion(1500)).toBe('poor');
    expect(classifyDispersion(4000)).toBe('moderate');
    expect(classifyDispersion(6000)).toBe('good');
  });
});

describe('analyzeSmog', () => {
  it('flags a severe smog trap for calm, shallow winter air (real Delhi pattern)', () => {
    const outlook = analyzeSmog(makeWeather().hourly);
    expect(outlook.available).toBe(true);
    expect(outlook.trapRisk).toBe('severe');
    expect(outlook.stagnantHours).toBe(24);
    expect(outlook.dispersionNow).toBe('poor');
    expect(outlook.bestDispersion?.start).toBe('2026-11-24T12:00');
    expect(outlook.explanation.join(' ')).toMatch(/inversion/);
  });

  it('reports low risk for windy, well-mixed air', () => {
    const outlook = analyzeSmog(hours(24));
    expect(outlook.trapRisk).toBe('low');
    expect(outlook.dispersionNow).toBe('good');
    expect(outlook.explanation.join(' ')).not.toMatch(/inversion/);
  });

  it('falls back to wind speed when mixing height is unavailable', () => {
    const outlook = analyzeSmog(hours(24, { boundaryLayerM: null, windKmh: 3 }));
    expect(outlook.trapRisk).toBe('severe');
    expect(outlook.ventilationNowM2s).toBeNull();
    expect(outlook.bestDispersion).toBeNull();
    expect(outlook.explanation[0]).toMatch(/Wind is 3.0 km\/h/);
  });

  it('grades partial stagnation as moderate or high', () => {
    const mixed = [...hours(8, { windKmh: 2, boundaryLayerM: 100 }), ...hours(16)];
    expect(analyzeSmog(mixed).trapRisk).toBe('moderate');
    const mostly = [...hours(14, { windKmh: 2, boundaryLayerM: 100 }), ...hours(10)];
    expect(analyzeSmog(mostly).trapRisk).toBe('high');
  });

  it('detects fog-forming conditions', () => {
    expect(analyzeSmog(hours(24, { humidityPct: 95, temperatureC: 8 })).fogLikely).toBe(true);
  });

  it('returns an explicit "unknown" outlook without data', () => {
    const outlook = analyzeSmog([]);
    expect(outlook).toMatchObject({ available: false, trapRisk: 'unknown', hoursAnalysed: 0 });
  });
});
