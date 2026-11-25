import type { AqiCategory, PollutantId, StandardId } from '../types.js';

/**
 * Breakpoint tables for the two supported AQI standards.
 *
 * Sources:
 *  - US EPA, "Technical Assistance Document for the Reporting of Daily Air
 *    Quality – the AQI" (2024 revision, new PM2.5 breakpoints).
 *  - CPCB India, "National Air Quality Index" (2014). The CPCB "Severe" band
 *    is open-ended; we close it with the same width as the previous band so
 *    the index saturates at 500 (documented assumption, see README).
 *
 * Tables are data, not code: adding a standard means adding a table.
 */

export interface Band {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
}

export type ConcentrationUnit = 'ug/m3' | 'mg/m3' | 'ppb' | 'ppm';

export interface PollutantScale {
  unit: ConcentrationUnit;
  /** Concentrations are truncated to this many decimals before lookup (EPA rule). */
  decimals: number;
  bands: readonly Band[];
}

export interface CategoryDefinition extends AqiCategory {
  min: number;
  max: number;
}

export interface AqiStandard {
  id: StandardId;
  name: string;
  shortName: string;
  categories: readonly CategoryDefinition[];
  scales: Readonly<Record<PollutantId, PollutantScale>>;
}

type Row = readonly [cLow: number, cHigh: number, iLow: number, iHigh: number];

const toBands = (rows: readonly Row[]): Band[] =>
  rows.map(([cLow, cHigh, iLow, iHigh]) => ({ cLow, cHigh, iLow, iHigh }));

const US_INDEX: readonly (readonly [number, number])[] = [
  [0, 50],
  [51, 100],
  [101, 150],
  [151, 200],
  [201, 300],
  [301, 500],
];

const withIndex = (
  concentrations: readonly (readonly [number, number])[],
  index: readonly (readonly [number, number])[],
): Row[] =>
  concentrations.map(([cLow, cHigh], i) => {
    const range = index[i];
    if (!range) throw new Error('Breakpoint table and index table lengths differ');
    return [cLow, cHigh, range[0], range[1]] as const;
  });

export const US_EPA: AqiStandard = {
  id: 'us',
  name: 'US EPA Air Quality Index',
  shortName: 'US AQI',
  categories: [
    {
      min: 0,
      max: 50,
      level: 0,
      label: 'Good',
      color: '#00E400',
      textColor: '#000000',
      meaning: 'Air quality is satisfactory and poses little or no risk.',
    },
    {
      min: 51,
      max: 100,
      level: 1,
      label: 'Moderate',
      color: '#FFFF00',
      textColor: '#000000',
      meaning:
        'Acceptable; unusually sensitive people should consider limiting prolonged exertion.',
    },
    {
      min: 101,
      max: 150,
      level: 2,
      label: 'Unhealthy for Sensitive Groups',
      color: '#FF7E00',
      textColor: '#000000',
      meaning: 'Children, older adults and people with heart or lung disease may be affected.',
    },
    {
      min: 151,
      max: 200,
      level: 3,
      label: 'Unhealthy',
      color: '#FF0000',
      textColor: '#000000',
      meaning: 'Everyone may begin to feel effects; sensitive groups more seriously.',
    },
    {
      min: 201,
      max: 300,
      level: 4,
      label: 'Very Unhealthy',
      color: '#8F3F97',
      textColor: '#FFFFFF',
      meaning: 'Health alert: the risk of health effects is increased for everyone.',
    },
    {
      min: 301,
      max: 500,
      level: 5,
      label: 'Hazardous',
      color: '#7E0023',
      textColor: '#FFFFFF',
      meaning: 'Health warning of emergency conditions: everyone is more likely to be affected.',
    },
  ],
  scales: {
    pm2_5: {
      unit: 'ug/m3',
      decimals: 1,
      bands: toBands(
        withIndex(
          [
            [0, 9.0],
            [9.1, 35.4],
            [35.5, 55.4],
            [55.5, 125.4],
            [125.5, 225.4],
            [225.5, 325.4],
          ],
          US_INDEX,
        ),
      ),
    },
    pm10: {
      unit: 'ug/m3',
      decimals: 0,
      bands: toBands(
        withIndex(
          [
            [0, 54],
            [55, 154],
            [155, 254],
            [255, 354],
            [355, 424],
            [425, 604],
          ],
          US_INDEX,
        ),
      ),
    },
    // 8-hour ozone table; the 301–500 range is approximated from the 1-hour table (rare in practice).
    o3: {
      unit: 'ppb',
      decimals: 0,
      bands: toBands(
        withIndex(
          [
            [0, 54],
            [55, 70],
            [71, 85],
            [86, 105],
            [106, 200],
            [201, 604],
          ],
          US_INDEX,
        ),
      ),
    },
    no2: {
      unit: 'ppb',
      decimals: 0,
      bands: toBands(
        withIndex(
          [
            [0, 53],
            [54, 100],
            [101, 360],
            [361, 649],
            [650, 1249],
            [1250, 2049],
          ],
          US_INDEX,
        ),
      ),
    },
    so2: {
      unit: 'ppb',
      decimals: 0,
      bands: toBands(
        withIndex(
          [
            [0, 35],
            [36, 75],
            [76, 185],
            [186, 304],
            [305, 604],
            [605, 1004],
          ],
          US_INDEX,
        ),
      ),
    },
    co: {
      unit: 'ppm',
      decimals: 1,
      bands: toBands(
        withIndex(
          [
            [0, 4.4],
            [4.5, 9.4],
            [9.5, 12.4],
            [12.5, 15.4],
            [15.5, 30.4],
            [30.5, 50.4],
          ],
          US_INDEX,
        ),
      ),
    },
  },
};

const IN_INDEX: readonly (readonly [number, number])[] = [
  [0, 50],
  [51, 100],
  [101, 200],
  [201, 300],
  [301, 400],
  [401, 500],
];

/** A CPCB scale: concentration breakpoints mapped onto the six NAQI index bands. */
const cpcb = (
  concentrations: readonly (readonly [number, number])[],
  unit: ConcentrationUnit = 'ug/m3',
  decimals = 0,
): PollutantScale => ({ unit, decimals, bands: toBands(withIndex(concentrations, IN_INDEX)) });

export const INDIA_NAQI: AqiStandard = {
  id: 'in',
  name: 'India National Air Quality Index (CPCB)',
  shortName: 'NAQI',
  categories: [
    {
      min: 0,
      max: 50,
      level: 0,
      label: 'Good',
      color: '#009933',
      textColor: '#000000',
      meaning: 'Minimal impact.',
    },
    {
      min: 51,
      max: 100,
      level: 1,
      label: 'Satisfactory',
      color: '#58FF09',
      textColor: '#000000',
      meaning: 'Minor breathing discomfort to sensitive people.',
    },
    {
      min: 101,
      max: 200,
      level: 2,
      label: 'Moderate',
      color: '#FFFF00',
      textColor: '#000000',
      meaning:
        'Breathing discomfort to people with lung or heart disease, children and older adults.',
    },
    {
      min: 201,
      max: 300,
      level: 3,
      label: 'Poor',
      color: '#FFA500',
      textColor: '#000000',
      meaning: 'Breathing discomfort to most people on prolonged exposure.',
    },
    {
      min: 301,
      max: 400,
      level: 4,
      label: 'Very Poor',
      color: '#FF0000',
      textColor: '#000000',
      meaning: 'Respiratory illness on prolonged exposure.',
    },
    {
      min: 401,
      max: 500,
      level: 5,
      label: 'Severe',
      color: '#990000',
      textColor: '#FFFFFF',
      meaning: 'Affects healthy people and seriously impacts those with existing diseases.',
    },
  ],
  scales: {
    pm2_5: cpcb([
      [0, 30],
      [31, 60],
      [61, 90],
      [91, 120],
      [121, 250],
      [251, 380],
    ]),
    pm10: cpcb([
      [0, 50],
      [51, 100],
      [101, 250],
      [251, 350],
      [351, 430],
      [431, 510],
    ]),
    o3: cpcb([
      [0, 50],
      [51, 100],
      [101, 168],
      [169, 208],
      [209, 748],
      [749, 1000],
    ]),
    no2: cpcb([
      [0, 40],
      [41, 80],
      [81, 180],
      [181, 280],
      [281, 400],
      [401, 520],
    ]),
    so2: cpcb([
      [0, 40],
      [41, 80],
      [81, 380],
      [381, 800],
      [801, 1600],
      [1601, 2400],
    ]),
    co: cpcb(
      [
        [0, 1.0],
        [1.1, 2.0],
        [2.1, 10],
        [10.1, 17],
        [17.1, 34],
        [34.1, 51],
      ],
      'mg/m3',
      1,
    ),
  },
};

export const STANDARDS: Readonly<Record<StandardId, AqiStandard>> = {
  us: US_EPA,
  in: INDIA_NAQI,
};

export const POLLUTANT_LABELS: Readonly<Record<PollutantId, string>> = {
  pm2_5: 'PM2.5 (fine particles)',
  pm10: 'PM10 (coarse dust)',
  no2: 'NO₂ (traffic exhaust)',
  so2: 'SO₂ (coal & industry)',
  o3: 'Ozone (O₃)',
  co: 'Carbon monoxide (CO)',
};
