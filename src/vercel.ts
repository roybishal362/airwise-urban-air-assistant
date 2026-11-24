import type { Express } from 'express';
import { composeApp } from './server.js';

/**
 * Serverless entry for Vercel (`api/index.js` re-exports it).
 *
 * - The app is built once per function instance and reused across requests
 *   (Fluid compute), so caches stay warm between requests on an instance.
 * - Vercel's edge is exactly one proxy hop and overwrites `X-Forwarded-For`
 *   with the real client IP, so trusting one hop gives rate limiting the true
 *   address. An explicit TRUST_PROXY_HOPS still wins.
 * - Static files in `public/` are served by Vercel's CDN; this function only
 *   receives `/api/*` (see vercel.json), with the same security headers.
 */
export function createVercelApp(env: NodeJS.ProcessEnv = process.env): Express {
  return composeApp({ TRUST_PROXY_HOPS: '1', ...env }).app;
}
