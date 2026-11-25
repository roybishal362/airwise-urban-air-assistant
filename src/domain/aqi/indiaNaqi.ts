import {
  toBands,
  withIndex,
  type AqiStandard,
  type ConcentrationUnit,
  type PollutantScale,
  type Range,
} from './bands.js';

/**
 * India National Air Quality Index. Source: CPCB India, "National Air Quality Index"
 * (2014). The CPCB "Severe" band is open-ended; we close it with the same width as the
 * previous band so the index saturates at 500 (documented assumption, see README).
 */

const IN_INDEX: readonly Range[] = [
  [0, 50],
  [51, 100],
  [101, 200],
  [201, 300],
  [301, 400],
  [401, 500],
];

/** A CPCB scale: concentration breakpoints mapped onto the six NAQI index bands. */
const cpcb = (
  concentrations: readonly Range[],
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
