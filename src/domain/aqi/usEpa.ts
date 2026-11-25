import { toBands, withIndex, type AqiStandard, type Range } from './bands.js';

/**
 * US EPA Air Quality Index. Source: US EPA, "Technical Assistance Document for the
 * Reporting of Daily Air Quality – the AQI" (2024 revision, new PM2.5 breakpoints).
 */

const US_INDEX: readonly Range[] = [
  [0, 50],
  [51, 100],
  [101, 150],
  [151, 200],
  [201, 300],
  [301, 500],
];

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
