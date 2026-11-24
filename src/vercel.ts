import type { Express } from 'express';
import { composeApp } from './server.js';

/** Vercel's edge is exactly one proxy hop in front of the function. */
export const VERCEL_PROXY_HOPS = '1';

/**
 * Serverless entry for Vercel (`api/index.js` re-exports it).
 *
 * - The app is built once per function instance and reused across requests
 *   (Fluid compute), so caches stay warm between requests on an instance.
 * - Vercel overwrites `X-Forwarded-For` with the real client IP and is one
 *   hop away, so trust is pinned to one hop. Any other value is a
 *   misconfiguration here: 0 would put every visitor in one rate-limit bucket
 *   (it happens when a local .env with TRUST_PROXY_HOPS=0 is imported), and
 *   2+ would let clients spoof their IP.
 * - Static files in `public/` are served by Vercel's CDN; this function only
 *   receives `/api/*` (see vercel.json), with the same security headers.
 */
export function createVercelApp(env: NodeJS.ProcessEnv = process.env): Express {
  return composeApp({ ...env, TRUST_PROXY_HOPS: VERCEL_PROXY_HOPS }).app;
}
