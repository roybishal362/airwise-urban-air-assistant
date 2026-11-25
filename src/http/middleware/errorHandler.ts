import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { InsufficientDataError } from '../../domain/errors.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';

interface ErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

/** The JSON error envelope every API error uses. */
const body = (code: string, message: string, issues?: ErrorBody['error']['issues']): ErrorBody => ({
  error: issues ? { code, message, issues } : { code, message },
});

/** 404 for unknown API routes, as JSON (never the HTML page). */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json(body('NOT_FOUND', 'Unknown API route'));
};

/** body-parser attaches `type` to its errors (e.g. payload too large, bad JSON). */
const parserErrorType = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string'
    ? error.type
    : undefined;

/** A known error's status code and safe response body. */
interface Mapped {
  status: number;
  payload: ErrorBody;
}

/** Validation, app and data errors with their safe responses; null for anything else. */
function mapKnownError(error: unknown): Mapped | null {
  if (error instanceof ZodError) {
    const issues = error.issues
      .slice(0, 10)
      .map((i) => ({ path: i.path.join('.'), message: i.message }));
    return {
      status: 400,
      payload: body('INVALID_REQUEST', 'Some fields are missing or invalid.', issues),
    };
  }
  if (error instanceof AppError) {
    return { status: error.status, payload: body(error.code, error.message) };
  }
  if (error instanceof InsufficientDataError) {
    return {
      status: 502,
      payload: body('NO_DATA', 'Air-quality data for this place is temporarily unavailable.'),
    };
  }
  return null;
}

/** Body-parser failures, by their `type`. */
const PARSER_ERRORS: ReadonlyMap<string, Mapped> = new Map([
  [
    'entity.too.large',
    { status: 413, payload: body('PAYLOAD_TOO_LARGE', 'Request body is too large.') },
  ],
  [
    'entity.parse.failed',
    { status: 400, payload: body('INVALID_JSON', 'Request body is not valid JSON.') },
  ],
]);

/**
 * Maps known errors to safe, stable responses. Unknown errors become a
 * generic 500: no stack traces, upstream URLs or user data leave the server.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    if (error instanceof AppError && error.status >= 500) {
      logger.warn('upstream or app error', {
        code: error.code,
        detail: error.detail,
        path: req.path,
      });
    }
    const known = mapKnownError(error) ?? PARSER_ERRORS.get(parserErrorType(error) ?? '');
    if (known) {
      res.status(known.status).json(known.payload);
      return;
    }
    logger.error('unhandled error', {
      path: req.path,
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
    });
    res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
  };
}
