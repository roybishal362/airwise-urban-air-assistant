import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { InsufficientDataError } from '../../domain/errors.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';

interface ErrorBody {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

const body = (code: string, message: string, issues?: ErrorBody['error']['issues']): ErrorBody => ({
  error: issues ? { code, message, issues } : { code, message },
});

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json(body('NOT_FOUND', 'Unknown API route'));
};

/** body-parser attaches `type` to its errors (e.g. payload too large, bad JSON). */
const parserErrorType = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'type' in error && typeof error.type === 'string'
    ? error.type
    : undefined;

/**
 * Maps known errors to safe, stable responses. Unknown errors become a
 * generic 500: no stack traces, upstream URLs or user data leave the server.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json(
        body(
          'INVALID_REQUEST',
          'Some fields are missing or invalid.',
          error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
      return;
    }
    if (error instanceof AppError) {
      if (error.status >= 500)
        logger.warn('upstream or app error', {
          code: error.code,
          detail: error.detail,
          path: req.path,
        });
      res.status(error.status).json(body(error.code, error.message));
      return;
    }
    if (error instanceof InsufficientDataError) {
      res
        .status(502)
        .json(body('NO_DATA', 'Air-quality data for this place is temporarily unavailable.'));
      return;
    }
    const type = parserErrorType(error);
    if (type === 'entity.too.large') {
      res.status(413).json(body('PAYLOAD_TOO_LARGE', 'Request body is too large.'));
      return;
    }
    if (type === 'entity.parse.failed') {
      res.status(400).json(body('INVALID_JSON', 'Request body is not valid JSON.'));
      return;
    }
    logger.error('unhandled error', {
      path: req.path,
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
    });
    res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
  };
}
