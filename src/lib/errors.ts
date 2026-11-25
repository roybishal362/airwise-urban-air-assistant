/**
 * Errors that are safe to show to API clients carry a stable `code` and a
 * human message. `detail` is for server logs only and never sent to clients.
 * Anything that is not an AppError is reported as a generic 500, so internal
 * details (stack traces, upstream URLs) never leak.
 */
export class AppError extends Error {
  readonly detail: string | undefined;

  /**
   * @param status HTTP status sent to the client
   * @param code stable machine-readable error code
   * @param message user-facing message
   * @param options `detail` is written to server logs only
   */
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

/** An upstream service failed or answered with something unusable (HTTP 502). */
export class UpstreamError extends AppError {
  /** @param message user-facing message @param options `detail` for server logs only */
  constructor(message: string, options?: { detail?: string }) {
    super(502, 'UPSTREAM_UNAVAILABLE', message, options);
    this.name = 'UpstreamError';
  }
}
