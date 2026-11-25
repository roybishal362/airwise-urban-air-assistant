// @ts-check
import * as defaultApi from './api.js';
import { createChat } from './chat.js';
import { setupImpactControls } from './controllers/impact.js';
import { setupProfile } from './controllers/profile.js';
import { setupSearch } from './controllers/search.js';
import { setupShare } from './controllers/share.js';
import { setupTabs } from './controllers/tabs.js';
import { setupVoice } from './controllers/voice.js';
import { byId } from './dom.js';
import { renderBrief } from './render/index.js';
import { createShell } from './shell.js';
import { loadPlace, loadProfile, savePlace, saveProfile } from './storage.js';

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
 */

const INITIAL_SUGGESTIONS = [
  'Is it safe for my kids to play outside today?',
  'What is the best time to go for a walk?',
  'How can my family cut emissions this week?',
];

/**
 * Real browser capabilities unless a test injects replacements.
 * @param {AppOptions} options
 */
function resolveEnvironment(options) {
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

function collectTargets() {
  return {
    now: byId('now-body', HTMLDivElement),
    glance: byId('glance-body', HTMLDivElement),
    family: byId('family-body', HTMLDivElement),
    forecast: byId('forecast-body', HTMLDivElement),
    routine: byId('routine-body', HTMLDivElement),
    indoor: byId('indoor-body', HTMLDivElement),
    impact: byId('impact-body', HTMLDivElement),
  };
}

/** @param {unknown} error */
const errorMessage = (error) =>
  error instanceof defaultApi.ApiError ? error.message : 'Something went wrong. Please try again.';

/**
 * @typedef {ReturnType<typeof resolveEnvironment>} Environment
 * @typedef {{ profile: Profile, place: Place | null, brief: AirBrief | null }} AppState
 * @typedef {import('./shell.js').Shell} Shell
 * @typedef {ReturnType<typeof setupTabs>} Tabs
 */

/**
 * The plan loader: fetch the brief for the chosen place and family, render
 * every tab, and update the shell.
 * @param {{ env: Environment, state: AppState, shell: Shell, tabs: Tabs, pledged: ReadonlySet<string>, onLoaded: () => void }} ctx
 */
function createPlanLoader({ env, state, shell, tabs, pledged, onLoaded }) {
  const results = byId('results', HTMLDivElement);
  const targets = collectTargets();
  /** @param {{ focusResults?: boolean }} [opts] */
  return async function loadBrief({ focusResults = false } = {}) {
    const place = state.place;
    if (!place) return;
    shell.setStatus(`Fetching live air and weather data for ${place.name}…`);
    results.setAttribute('aria-busy', 'true');
    try {
      /** @type {AirBrief} */
      const brief = await env.api.fetchBrief({
        location: place,
        standard: state.profile.standard,
        household: state.profile.household,
      });
      state.brief = brief;
      renderBrief(brief, targets, pledged);
      shell.showAqi(brief);
      results.hidden = false;
      shell.setView(true);
      onLoaded();
      const { category, aqi } = brief.current;
      shell.setStatus(`Plan ready for ${place.name}: ${category.label}, AQI ${String(aqi)}.`);
      if (focusResults) tabs.select('today', { focus: 'panel' });
    } catch (error) {
      shell.setStatus(errorMessage(error), 'error');
    } finally {
      results.setAttribute('aria-busy', 'false');
    }
  };
}

/**
 * The family editor: saving reloads the plan (or asks for a city first).
 * @param {{ env: Environment, state: AppState, shell: Shell, loadBrief: (opts?: { focusResults?: boolean }) => Promise<void> }} ctx
 */
function setupFamily({ env, state, shell, loadBrief }) {
  const hadProfile = env.storage.getItem('airwise.profile.v1') !== null;
  const hint = byId('family-hint', HTMLParagraphElement);
  const profile = setupProfile({
    ui: {
      form: byId('profile-form', HTMLFormElement),
      summary: byId('family-summary', HTMLUListElement),
      hint,
      error: byId('profile-error', HTMLParagraphElement),
    },
    storage: env.storage,
    getProfile: () => state.profile,
    setProfile: (next) => {
      state.profile = next;
    },
    onSaved: () => {
      if (state.place) {
        void loadBrief({ focusResults: true });
        return;
      }
      shell.setStatus('Profile saved. Now choose your city above.');
      shell.focusSearch();
    },
  });
  if (!hadProfile) {
    hint.textContent =
      'Showing a sample family. Tap “Edit family” to match yours: it changes every recommendation.';
  }
  return profile;
}

/** @param {string | undefined} assistant */
const assistantModeText = (assistant) => {
  if (assistant === 'rules') {
    return 'Running in offline mode: answers come from AirWise rules using your live data.';
  }
  const engine = assistant === 'gemini' ? 'Google Gemini' : 'Claude';
  return `Powered by ${engine}, grounded in your live air data. Your household details are sent without any names.`;
};

/**
 * The assistant: chat, voice input and the "which engine answers" line.
 * @param {{ env: Environment, state: AppState, shell: Shell }} ctx
 */
function setupAssistant({ env, state, shell }) {
  const input = byId('chat-input', HTMLTextAreaElement);
  const chat = createChat({
    log: byId('chat-log', HTMLDivElement),
    form: byId('chat-form', HTMLFormElement),
    input,
    suggestions: byId('chat-suggestions', HTMLDivElement),
    send: (message, history) =>
      env.api.sendChat({
        location: state.place,
        standard: state.profile.standard,
        household: state.profile.household,
        message,
        history,
      }),
    canSend: () => state.place !== null,
    onBlocked: () => {
      shell.setStatus('Choose your city first so answers use your local air data.', 'error');
      shell.focusSearch();
    },
  });
  chat.showSuggestions(INITIAL_SUGGESTIONS);
  setupVoice({
    button: byId('voice-button', HTMLButtonElement),
    input,
    onTranscript: (text) => void chat.ask(text),
    setStatus: shell.setStatus,
    Recognition: env.Recognition,
  });
  const health = env.api
    .fetchHealth()
    .then((info) => {
      byId('chat-mode', HTMLParagraphElement).textContent = assistantModeText(info.assistant);
    })
    .catch(() => undefined);
  return { chat, health };
}

/**
 * City search, the city chips and "use my location".
 * @param {{ env: Environment, shell: Shell, choosePlace: (place: Place) => Promise<void> }} ctx
 */
function setupPlaceSearch({ env, shell, choosePlace }) {
  setupSearch({
    ui: {
      form: byId('place-form', HTMLFormElement),
      input: byId('place-input', HTMLInputElement),
      results: byId('place-results', HTMLUListElement),
      geoButton: byId('geo-button', HTMLButtonElement),
      cityButtons: document.querySelectorAll('.chip-city'),
    },
    searchPlaces: env.api.searchPlaces,
    choosePlace,
    setStatus: shell.setStatus,
    errorMessage,
    geolocation: env.geolocation,
    locateApproximately: env.api.locateApproximately,
  });
}

/**
 * Share the plan, or read it aloud.
 * @param {{ env: Environment, state: AppState, shell: Shell }} ctx
 */
function setupSharing({ env, state, shell }) {
  setupShare({
    shareButton: byId('share-button', HTMLButtonElement),
    speakButton: byId('speak-button', HTMLButtonElement),
    getBrief: () => state.brief,
    setStatus: shell.setStatus,
    share: env.share,
    clipboard: env.clipboard,
    speech: env.speech,
  });
}

/**
 * Compose the UI: state, the shell, tabs, the plan loader and every
 * controller. All browser capabilities are injectable so the whole flow is
 * testable in jsdom.
 * @param {AppOptions} [options]
 */
export function startApp(options = {}) {
  const env = resolveEnvironment(options);
  const shell = createShell();
  /** @type {AppState} */
  const state = { profile: loadProfile(env.storage), place: loadPlace(env.storage), brief: null };
  /** @param {string} tabId */
  const updateTitle = (tabId) => {
    const section = document.getElementById(`tab-${tabId}`)?.textContent?.trim() ?? '';
    shell.setTitle(section, state.brief && state.place ? state.place.name : null);
  };
  const tabs = setupTabs({
    tablist: /** @type {HTMLElement} */ (document.querySelector('[role="tablist"]')),
    onChange: updateTitle,
  });
  const impact = setupImpactControls({
    container: byId('impact-body', HTMLDivElement),
    storage: env.storage,
    getBrief: () => state.brief,
    setBrief: (brief) => {
      state.brief = brief;
    },
    onHouseholdsChange: (households) => {
      state.profile.household.communityHouseholds = households;
      saveProfile(env.storage, state.profile);
      profile.renderSummary();
    },
  });
  const loadBrief = createPlanLoader({
    env,
    state,
    shell,
    tabs,
    pledged: impact.pledged,
    onLoaded: () => updateTitle(tabs.current()),
  });

  /** @param {Place} place */
  function choosePlace(place) {
    state.place = place;
    savePlace(env.storage, place);
    shell.showPlace(place);
    return loadBrief({ focusResults: true });
  }

  setupPlaceSearch({ env, shell, choosePlace });
  const profile = setupFamily({ env, state, shell, loadBrief });
  setupSharing({ env, state, shell });
  const { chat, health } = setupAssistant({ env, state, shell });

  if (state.place) shell.showPlace(state.place);
  const initialLoad = loadBrief();
  return { state, chat, tabs, loadBrief, choosePlace, ready: Promise.all([health, initialLoad]) };
}
