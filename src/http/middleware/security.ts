import type { RequestHandler } from 'express';
import helmet from 'helmet';

/**
 * Strict Content-Security-Policy: the UI ships no inline scripts or styles and
 * calls only its own API, so everything except 'self' is blocked. This
 * neutralises injected markup even if a rendering bug ever slipped through.
 */
export function securityHeaders(): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    }),
    (_req, res, next) => {
      // Geolocation is opt-in ("Use my location"); every other powerful API is off.
      res.setHeader(
        'Permissions-Policy',
        'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
      );
      next();
    },
  ];
}
