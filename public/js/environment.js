// @ts-check
import * as defaultApi from './api.js';

/** The browser capabilities the app uses, and the shared app-state shape. */

/**
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('./storage.js').Profile} Profile
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {import('./controllers/voice.js').RecogniserConstructor} RecogniserConstructor
 * @typedef {Pick<typeof defaultApi, 'searchPlaces' | 'fetchBrief' | 'sendChat' | 'fetchHealth'>
 *   & Partial<Pick<typeof defaultApi, 'locateApproximately'>>} Api
 * @typedef {{
 *   storage?: Storage,
 *   api?: Api,
 *   geolocation?: Geolocation | null,
 *   speech?: SpeechSynthesis | null,
 *   share?: ((data: ShareData) => Promise<void>) | null,
 *   clipboard?: Pick<Clipboard, 'writeText'> | null,
 *   Recognition?: RecogniserConstructor | null,
 * }} AppOptions
 * @typedef {ReturnType<typeof resolveEnvironment>} Environment
 * @typedef {{ profile: Profile, place: Place | null, brief: AirBrief | null }} AppState
 */

/**
 * Real browser capabilities unless a test injects replacements.
 * @param {AppOptions} options
 */
export function resolveEnvironment(options) {
  /** @template T @param {T | undefined} injected @param {() => T} real */
  const pick = (injected, real) => (injected === undefined ? real() : injected);
  const speechGlobals =
    /** @type {{ SpeechRecognition?: RecogniserConstructor, webkitSpeechRecognition?: RecogniserConstructor }} */ (
      /** @type {unknown} */ (globalThis)
    );
  return {
    storage: options.storage ?? localStorage,
    api: options.api ?? defaultApi,
    geolocation: pick(options.geolocation, () => navigator.geolocation ?? null),
    speech: pick(options.speech, () => globalThis.speechSynthesis ?? null),
    share: pick(options.share, () => navigator.share?.bind(navigator) ?? null),
    clipboard: pick(options.clipboard, () => navigator.clipboard ?? null),
    Recognition: pick(
      options.Recognition,
      () => speechGlobals.SpeechRecognition ?? speechGlobals.webkitSpeechRecognition ?? null,
    ),
  };
}
