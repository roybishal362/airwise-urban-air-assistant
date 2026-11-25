import type { GeoLocation } from './types.js';

/**
 * Location context that tailors numbers and advice to where the family lives:
 * the carbon intensity of the local grid (drives EV, metro, heating and
 * electricity-saving impacts), the emergency number to dial, and whether
 * India- or Delhi-NCR-specific schemes and rules apply.
 */
export interface Region {
  countryCode: string | null;
  isIndia: boolean;
  isDelhiNcr: boolean;
  /** kg CO₂ emitted per kWh drawn from the local grid. */
  gridCo2KgPerKwh: number;
  /** What to dial in a medical emergency. */
  emergencyNumber: string;
}

/**
 * Approximate grid carbon intensity, kg CO₂/kWh (Ember / IEA 2023 values,
 * rounded; India uses CEA CO₂ Baseline Database v19). Unknown countries fall
 * back to the world average.
 */
export const GRID_CO2_KG_PER_KWH: Readonly<Record<string, number>> = {
  IN: 0.72,
  BD: 0.57,
  PK: 0.4,
  CN: 0.58,
  ID: 0.68,
  ZA: 0.9,
  AU: 0.55,
  JP: 0.46,
  US: 0.37,
  DE: 0.38,
  GB: 0.21,
  CA: 0.13,
  FR: 0.06,
  BR: 0.1,
};
export const WORLD_AVERAGE_GRID_CO2 = 0.48;
export const INDIA_GRID_CO2 = 0.72;

const EMERGENCY_NUMBERS: Readonly<Record<string, string>> = {
  IN: '112 (ambulance 108)',
  US: '911',
  CA: '911',
  GB: '999 or 112',
  AU: '000',
};
const EU_112 = new Set([
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'PL',
  'AT',
  'IE',
  'PT',
  'SE',
  'DK',
  'FI',
]);

/**
 * Delhi National Capital Region, approximated by a bounding box that covers
 * Delhi, Gurugram, Faridabad, Noida, Ghaziabad, Sonipat and nearby districts.
 */
export const DELHI_NCR_BOUNDS = {
  minLat: 27.85,
  maxLat: 29.45,
  minLon: 76.2,
  maxLon: 78.1,
} as const;

const INDIAN_TIMEZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);

/** True inside the Delhi-NCR bounding box. */
export function isInDelhiNcr(latitude: number, longitude: number): boolean {
  const b = DELHI_NCR_BOUNDS;
  return (
    latitude >= b.minLat && latitude <= b.maxLat && longitude >= b.minLon && longitude <= b.maxLon
  );
}

/** Country context for a place: country code, Delhi-NCR, grid carbon intensity and emergency number. */
export function resolveRegion(location: GeoLocation, timezone?: string): Region {
  const fromTimezone = timezone && INDIAN_TIMEZONES.has(timezone) ? 'IN' : null;
  const countryCode = location.countryCode?.toUpperCase() ?? fromTimezone;
  const key = countryCode ?? '';
  const isIndia = countryCode === 'IN';
  const emergencyNumber =
    EMERGENCY_NUMBERS[key] ?? (EU_112.has(key) ? '112' : 'your local emergency number');
  return {
    countryCode,
    isIndia,
    isDelhiNcr: isIndia && isInDelhiNcr(location.latitude, location.longitude),
    gridCo2KgPerKwh: GRID_CO2_KG_PER_KWH[key] ?? WORLD_AVERAGE_GRID_CO2,
    emergencyNumber,
  };
}
