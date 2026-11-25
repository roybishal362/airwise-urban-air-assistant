import { UpstreamError } from './errors.js';

export type FetchFn = typeof fetch;

export interface FetchJsonOptions {
  timeoutMs: number;
  /** Extra attempts for transient failures (network, timeout, 5xx, 429). GETs are idempotent. */
  retries?: number;
  retryDelayMs?: number;
}

const USER_MESSAGE =
  'The live air-data service is not responding right now. Please try again shortly.';

/** Resolve after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Statuses worth one retry: rate limiting and server errors. */
const isTransientStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * GET a JSON document with a hard timeout and a small retry budget. Every
 * failure becomes an UpstreamError with a user-safe message; the technical
 * detail (host, status) is kept in `detail` for server logs only.
 */
export async function fetchJson(
  url: URL,
  fetchFn: FetchFn,
  options: FetchJsonOptions,
): Promise<unknown> {
  const { timeoutMs, retries = 1, retryDelayMs = 300 } = options;
  let lastDetail = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { accept: 'application/json', 'user-agent': 'airwise-assistant/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      lastDetail = `${url.host}: ${cause instanceof Error ? cause.name : 'network error'}`;
      continue;
    }
    if (!response.ok) {
      lastDetail = `${url.host}: HTTP ${response.status}`;
      if (isTransientStatus(response.status)) continue;
      throw new UpstreamError(USER_MESSAGE, { detail: lastDetail });
    }
    try {
      return await response.json();
    } catch {
      throw new UpstreamError(USER_MESSAGE, { detail: `${url.host}: invalid JSON` });
    }
  }
  throw new UpstreamError(USER_MESSAGE, { detail: lastDetail });
}
