// @ts-check

/** Thin client for the AirWise API with timeouts and friendly error messages. */

/**
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {import('./chat.js').ChatAnswer} ChatAnswer
 * @typedef {{ status?: string, assistant?: string }} Health
 * @typedef {{ error?: { message?: string, code?: string } }} ErrorBody
 */

/** An API failure: a message safe to show the user, plus the HTTP status and error code. */
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

const NETWORK_ERROR = 'Could not reach AirWise. Check your connection and try again.';
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** @param {RequestInit} init */
const jsonHeaders = (init) => ({
  accept: 'application/json',
  ...(init.body ? { 'content-type': 'application/json' } : {}),
});

/**
 * A message to show the user for any error: an ApiError's own message, otherwise a generic one.
 * @param {unknown} error
 */
export const errorMessage = (error) => (error instanceof ApiError ? error.message : GENERIC_ERROR);

/**
 * fetch, with a failure to connect (offline, DNS, timeout) as a friendly ApiError.
 * @param {typeof fetch} fetchFn @param {string} url @param {RequestInit} init
 */
async function send(fetchFn, url, init) {
  try {
    return await fetchFn(url, init);
  } catch {
    throw new ApiError(NETWORK_ERROR, 0, 'NETWORK');
  }
}

/**
 * The server's `{ error: { code, message } }` envelope as an ApiError.
 * @param {number} status @param {unknown} data  parsed body, or null when it was not JSON
 */
function errorFrom(status, data) {
  const error = /** @type {ErrorBody | null} */ (data)?.error;
  return new ApiError(error?.message ?? GENERIC_ERROR, status, error?.code ?? 'HTTP_ERROR');
}

/**
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [options]
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<unknown>}  the parsed JSON body; each endpoint function below types it
 */
export async function requestJson(url, options = {}, fetchFn = fetch) {
  const { timeoutMs = 25_000, ...init } = options;
  const response = await send(fetchFn, url, {
    ...init,
    headers: jsonHeaders(init),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(response.status, data);
  return data;
}

/**
 * @param {string} query
 * @param {typeof fetch} [fetchFn]
 */
export async function searchPlaces(query, fetchFn) {
  const url = `/api/places?q=${encodeURIComponent(query)}`;
  const data = /** @type {{ places: Place[] }} */ (await requestJson(url, {}, fetchFn));
  return data.places;
}

/**
 * Health details travel in the POST body, never in the URL.
 * @param {object} payload
 * @param {typeof fetch} [fetchFn]
 */
export async function fetchBrief(payload, fetchFn) {
  const init = { method: 'POST', body: JSON.stringify(payload) };
  const data = /** @type {{ brief: AirBrief }} */ (await requestJson('/api/brief', init, fetchFn));
  return data.brief;
}

/**
 * @param {object} payload
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<ChatAnswer>}
 */
export async function sendChat(payload, fetchFn) {
  return /** @type {ChatAnswer} */ (
    await requestJson(
      '/api/chat',
      { method: 'POST', body: JSON.stringify(payload), timeoutMs: 40_000 },
      fetchFn,
    )
  );
}

/**
 * City-level area from the server (the host's IP geolocation), used only when
 * the device cannot locate itself.
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Place>}
 */
export async function locateApproximately(fetchFn) {
  const data = /** @type {{ place: Place }} */ (await requestJson('/api/locate', {}, fetchFn));
  return data.place;
}

/**
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Health>}
 */
export async function fetchHealth(fetchFn) {
  return /** @type {Health} */ (await requestJson('/api/health', {}, fetchFn));
}
