import type { PollutantId, StandardId } from '../types.js';
import type { AqiStandard } from './bands.js';
import { INDIA_NAQI } from './indiaNaqi.js';
import { US_EPA } from './usEpa.js';

/**
 * The supported AQI standards. Tables are data, not code: adding a standard means
 * adding a table module (see usEpa.ts and indiaNaqi.ts) and registering it here.
 */

export type {
  AqiStandard,
  Band,
  CategoryDefinition,
  ConcentrationUnit,
  PollutantScale,
} from './bands.js';
export { INDIA_NAQI } from './indiaNaqi.js';
export { US_EPA } from './usEpa.js';

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
