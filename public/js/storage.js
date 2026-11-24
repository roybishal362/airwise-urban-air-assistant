// @ts-check

/**
 * Household profile and chosen place live in localStorage only (privacy by
 * design: no accounts, no server-side storage). Everything read back is
 * re-validated, because storage can be stale or tampered with.
 */

const PROFILE_KEY = 'airwise.profile.v1';
const PLACE_KEY = 'airwise.place.v1';

/**
 * @typedef {{
 *   members: { adults: number, children: number, seniors: number },
 *   conditions: string[],
 *   home: { roomAreaSqm: number, hasAirPurifier: boolean, purifierCadrM3h: number },
 *   lifestyle: { commuteMode: string, commuteKm: number, workFromHomePossible: boolean, cookingFuel: string, heating: string, exercisesOutdoors: boolean },
 *   communityHouseholds: number
 * }} Household
 * @typedef {{ household: Household, standard: 'auto' | 'us' | 'in' }} Profile
 * @typedef {{ name: string, latitude: number, longitude: number, country?: string, countryCode?: string, region?: string, timezone?: string }} Place
 */

/** @type {Profile} */
export const DEFAULT_PROFILE = Object.freeze({
  household: {
    members: { adults: 2, children: 1, seniors: 1 },
    conditions: [],
    home: { roomAreaSqm: 12, hasAirPurifier: false, purifierCadrM3h: 0 },
    lifestyle: {
      commuteMode: 'two_wheeler',
      commuteKm: 10,
      workFromHomePossible: false,
      cookingFuel: 'lpg',
      heating: 'none',
      exercisesOutdoors: true,
    },
    communityHouseholds: 1,
  },
  standard: 'auto',
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {value is Profile}
 */
export function isProfile(value) {
  if (!isObject(value) || !isObject(value.household)) return false;
  const h = value.household;
  return (
    ['auto', 'us', 'in'].includes(value.standard) &&
    isObject(h.members) &&
    Array.isArray(h.conditions) &&
    isObject(h.home) &&
    isObject(h.lifestyle) &&
    Number.isFinite(h.communityHouseholds)
  );
}

/**
 * @param {unknown} value
 * @returns {value is Place}
 */
export function isPlace(value) {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= 80 &&
    Number.isFinite(value.latitude) &&
    Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.longitude) <= 180
  );
}

/**
 * @param {Storage} storage
 * @param {string} key
 */
function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * @param {Storage} storage
 * @returns {Profile}
 */
export function loadProfile(storage) {
  const stored = readJson(storage, PROFILE_KEY);
  return isProfile(stored) ? stored : structuredClone(DEFAULT_PROFILE);
}

/**
 * @param {Storage} storage
 * @param {Profile} profile
 */
export function saveProfile(storage, profile) {
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode or quota exceeded: the app still works for this session.
  }
}

/**
 * @param {Storage} storage
 * @returns {Place | null}
 */
export function loadPlace(storage) {
  const stored = readJson(storage, PLACE_KEY);
  return isPlace(stored) ? stored : null;
}

/**
 * @param {Storage} storage
 * @param {Place} place
 */
export function savePlace(storage, place) {
  try {
    storage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // Ignore storage failures (see saveProfile).
  }
}
