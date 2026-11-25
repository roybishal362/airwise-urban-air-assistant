import type { IncomingHttpHeaders } from 'node:http';
import type { z } from 'zod';
import { locationSchema } from './schemas.js';

/**
 * City-level location from the hosting platform's IP geolocation headers
 * (Vercel adds `x-vercel-ip-*`; docs: vercel.com/docs/headers/request-headers).
 *
 * Used only when the browser cannot locate the device and the user has not
 * blocked location. Nothing is stored or logged, the result goes back only to
 * the same requester, and every value is validated with the same strict place
 * schema as user input (place names reach the GenAI prompt). Returns null when
 * the platform provides no usable location, e.g. in local development.
 */
export type ApproximatePlace = z.infer<typeof locationSchema>;

/** A trimmed, non-empty header value, or undefined. */
const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** City names are percent-encoded for non-ASCII characters (RFC 3986). */
const decodeCity = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
};

/** ~1 km: city-level is all an IP address can honestly tell us. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** City-level place from Vercel's IP-geolocation headers, validated like user input; null without coordinates. */
export function approximatePlace(headers: IncomingHttpHeaders): ApproximatePlace | null {
  const latitude = Number(header(headers, 'x-vercel-ip-latitude'));
  const longitude = Number(header(headers, 'x-vercel-ip-longitude'));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;

  const city = decodeCity(header(headers, 'x-vercel-ip-city'));
  const candidate = {
    name: `${city ?? 'Your area'} (approximate)`,
    latitude: round2(latitude),
    longitude: round2(longitude),
    countryCode: header(headers, 'x-vercel-ip-country'),
    timezone: header(headers, 'x-vercel-ip-timezone'),
  };
  const parsed = locationSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  // A city name with unexpected characters must not cost the user their area.
  const withoutCity = locationSchema.safeParse({ ...candidate, name: 'Your area (approximate)' });
  return withoutCity.success ? withoutCity.data : null;
}
