import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const reject = (
  res: Parameters<RequestHandler>[1],
  status: number,
  code: string,
  message: string,
): void => {
  res.status(status).json({ error: { code, message } });
};

/** Correlates a response with its log line (returned as `X-Request-Id`). */
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/**
 * Cross-site request guard for state-changing calls. The API has no cookies,
 * but a hostile page could still make visitors' browsers POST to /api/chat and
 * burn the GenAI quota. Browsers label such requests via `Sec-Fetch-Site` and
 * `Origin`; anything not same-origin is refused. Non-browser clients (no such
 * headers) are unaffected and remain rate-limited.
 */
export const sameOriginOnly: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || isSameOrigin(req)) {
    next();
    return;
  }
  reject(res, 403, 'CROSS_SITE_REQUEST', 'Cross-site requests are not allowed.');
};

/** False when the browser says the request came from another site or origin. */
function isSameOrigin(req: Request): boolean {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.get('origin');
  return !origin || hostOf(origin) === req.get('host');
}

/** Host of an Origin header, or null when it is malformed (e.g. "null"). */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** POST bodies must be JSON; anything else is rejected before parsing. */
export const requireJson: RequestHandler = (req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    reject(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.');
    return;
  }
  next();
};
