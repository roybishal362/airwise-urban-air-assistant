import compression from 'compression';
import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiNotFound, errorHandler } from './http/middleware/errorHandler.js';
import { securityHeaders } from './http/middleware/security.js';
import { createApiRouter, type ApiDependencies } from './http/routes.js';
import type { Logger } from './lib/logger.js';

export interface AppDependencies extends ApiDependencies {
  logger: Logger;
  trustProxyHops: number;
}

/** `src/` and `dist/` both sit next to `public/`. */
export const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

/** App factory: all dependencies are injected, so tests run without network. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Needed for correct client IPs (rate limiting) behind Cloud Run's proxy.
  app.set('trust proxy', deps.trustProxyHops);

  app.use(securityHeaders());
  app.use(compression());

  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      // Path only: query strings and bodies may contain personal data.
      deps.logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  });

  app.use('/api', express.json({ limit: '16kb' }), createApiRouter(deps), apiNotFound);

  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        // The UI is unbundled ES modules without hashed file names, so HTML,
        // JS and CSS must revalidate (cheap 304s via ETag) to stay in sync
        // after a deploy. Only static icons and the manifest are cached longer.
        const longLived = /\.(svg|webmanifest)$/.test(filePath);
        res.setHeader('Cache-Control', longLived ? 'public, max-age=86400' : 'no-cache');
      },
    }),
  );

  app.use(errorHandler(deps.logger));
  return app;
}
