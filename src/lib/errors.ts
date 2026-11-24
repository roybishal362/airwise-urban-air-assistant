/**
 * Errors that are safe to show to API clients carry a stable `code` and a
 * human message. `detail` is for server logs only and never sent to clients.
 * Anything that is not an AppError is reported as a generic 500, so internal
 * details (stack traces, upstream URLs) never leak.
 */
export class AppError extends Error {
  readonly detail: string | undefined;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: { detail?: string },
  ) {
    super(message);
    this.name = 'AppError';
    this.detail = options?.detail;
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, options?: { detail?: string }) {
    super(502, 'UPSTREAM_UNAVAILABLE', message, options);
    this.name = 'UpstreamError';
  }
}
