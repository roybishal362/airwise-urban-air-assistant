import { z } from 'zod';
import { MOLAR_VOLUME_L, MOLECULAR_WEIGHT } from '../domain/aqi/calculator.js';
import type { PollutantId } from '../domain/types.js';

/** OpenAQ v3 data shapes, parameter names and unit handling (no I/O). */

/** OpenAQ parameter names → our pollutant ids. */
export const PARAMETER_MAP: Readonly<Record<string, PollutantId>> = {
  pm25: 'pm2_5',
  pm10: 'pm10',
  no2: 'no2',
  so2: 'so2',
  o3: 'o3',
  co: 'co',
};

/** A timestamp as OpenAQ sends it, in UTC and local time. */
const timeSchema = z.object({ utc: z.string(), local: z.string() });

/** The `/locations` response: stations with their sensors. */
export const locationsSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      isMonitor: z.boolean().optional(),
      provider: z.object({ name: z.string() }).nullable().optional(),
      coordinates: z.object({ latitude: z.number(), longitude: z.number() }),
      datetimeLast: timeSchema.nullable().optional(),
      sensors: z.array(
        z.object({
          id: z.number(),
          parameter: z.object({ name: z.string(), units: z.string() }),
        }),
      ),
    }),
  ),
});

/** The `/locations/{id}/latest` response: the newest value of each sensor. */
export const latestSchema = z.object({
  results: z.array(
    z.object({
      datetime: timeSchema,
      value: z.number().nullable(),
      sensorsId: z.number(),
    }),
  ),
});

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Convert a reported value to µg/m³ (gases at 25 °C, 1 atm). Null for unknown units. */
export function toMicrograms(value: number, units: string, pollutant: PollutantId): number | null {
  const unit = units.trim().toLowerCase().replace('μ', 'µ').replace('³', '3');
  if (unit === 'µg/m3' || unit === 'ug/m3') return value;
  if (unit === 'mg/m3') return value * 1000;
  const weight = MOLECULAR_WEIGHT[pollutant];
  if (weight === undefined) return null;
  if (unit === 'ppb') return (value * weight) / MOLAR_VOLUME_L;
  if (unit === 'ppm') return (value * 1000 * weight) / MOLAR_VOLUME_L;
  return null;
}

/**
 * The units a reading is really in. OpenAQ labels India's CPCB gas sensors
 * "ppb", but the values are CPCB's native units: µg/m³, and mg/m³ for CO.
 * Verified on live Delhi data (24 Nov 2026, 10 stations): NOx (ppb) equals
 * NO + NO2 only when NO and NO2 are read as µg/m³ (R K Puram: 1.9 + 26.3
 * µg/m³ = 15.5 ppb vs NOx 0.0156 ppm), and CO "0.87 ppb" is physically
 * impossible outdoors but a typical value in mg/m³.
 */
export function effectiveUnits(
  provider: string | undefined,
  pollutant: PollutantId,
  labelled: string,
): string {
  if (provider !== 'CPCB' || pollutant === 'pm2_5' || pollutant === 'pm10') return labelled;
  return pollutant === 'co' ? 'mg/m³' : 'µg/m³';
}

/** One station from the `/locations` response. */
export type Location = z.infer<typeof locationsSchema>['results'][number];
/** One sensor value from the `/latest` response. */
export type Reading = z.infer<typeof latestSchema>['results'][number];
