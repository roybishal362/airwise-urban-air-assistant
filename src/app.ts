import compression from 'compression';
import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiNotFound, errorHandler } from './http/middleware/errorHandler.js';
import { requestId, requireJson, sameOriginOnly } from './http/middleware/requestGuards.js';
import { securityHeaders } from './http/middleware/security.js';
import { createApiRouter, type ApiDependencies } from './http/routes.js';
import type { Logger } from './lib/logger.js';

export interface AppDependencies extends ApiDependencies {
  logger: Logger;
  trustProxyHops: number;
  /** Where the UI is served from (default: the readable sources in public/). */
  staticDir?: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Readable, unbundled UI sources (development). `src/` and `dist/` both sit next to it. */
export const PUBLIC_DIR = path.join(ROOT, 'public');

/** Production UI from `npm run build`: one hashed, minified JS and CSS file each. */
export const WEB_BUILD_DIR = path.join(ROOT, 'dist', 'web');

/** Hashed build output (/assets/name-HASH.ext) never changes, so it is cached for a year. */
const HASHED_ASSET = /[\\/]assets[\\/][^\\/]+-[A-Z0-9]{8}\.(?:js|css)$/;

/**
 * - Hashed /assets/ files: cached for a year ("immutable"); a deploy changes the name.
 * - HTML and the unbundled development modules: revalidated every time (cheap 304s
 *   via ETag) so a deploy never mixes old and new files.
 * - Icons and the manifest: a day.
 */
export function cacheControlFor(filePath: string): string {
  if (HASHED_ASSET.test(filePath)) return 'public, max-age=31536000, immutable';
  if (/\.(svg|webmanifest)$/.test(filePath)) return 'public, max-age=86400';
  return 'no-cache';
}

/** App factory: all dependencies are injected, so tests run without network. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Needed for correct client IPs (rate limiting) behind a platform proxy (Vercel, Cloud Run).
  app.set('trust proxy', deps.trustProxyHops);

  app.use(requestId);
  app.use(securityHeaders());
  app.use(compression());

  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      // Path only: query strings and bodies may contain personal data.
      deps.logger.info('request', {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  });

  app.use(
    '/api',
    sameOriginOnly,
    requireJson,
    express.json({ limit: '16kb' }),
    createApiRouter(deps),
    apiNotFound,
  );

  app.use(
    express.static(deps.staticDir ?? PUBLIC_DIR, {
      index: 'index.html',
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => res.setHeader('Cache-Control', cacheControlFor(filePath)),
    }),
  );

  app.use(errorHandler(deps.logger));
  return app;
}
