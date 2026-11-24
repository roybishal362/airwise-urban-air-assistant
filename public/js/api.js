// @ts-check

/** Thin client for the AirWise API with timeouts and friendly error messages. */

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} code
   */
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<any>}
 */
export async function requestJson(url, options = {}, fetchFn = fetch) {
  const { timeoutMs = 25_000, ...init } = options;
  let response;
  try {
    response = await fetchFn(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(
      'Could not reach AirWise. Check your connection and try again.',
      0,
      'NETWORK',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message ?? 'Something went wrong. Please try again.';
    throw new ApiError(message, response.status, data?.error?.code ?? 'HTTP_ERROR');
  }
  return data;
}

/**
 * @param {string} query
 * @param {typeof fetch} [fetchFn]
 */
export async function searchPlaces(query, fetchFn) {
  const data = await requestJson(`/api/places?q=${encodeURIComponent(query)}`, {}, fetchFn);
  return data.places;
}

/**
 * Health details travel in the POST body, never in the URL.
 * @param {object} payload
 * @param {typeof fetch} [fetchFn]
 */
export async function fetchBrief(payload, fetchFn) {
  const data = await requestJson(
    '/api/brief',
    { method: 'POST', body: JSON.stringify(payload) },
    fetchFn,
  );
  return data.brief;
}

/**
 * @param {object} payload
 * @param {typeof fetch} [fetchFn]
 */
export function sendChat(payload, fetchFn) {
  return requestJson(
    '/api/chat',
    { method: 'POST', body: JSON.stringify(payload), timeoutMs: 40_000 },
    fetchFn,
  );
}

/** @param {typeof fetch} [fetchFn] */
export function fetchHealth(fetchFn) {
  return requestJson('/api/health', {}, fetchFn);
}
