// @ts-check
import * as defaultApi from './api.js';
import { createChat } from './chat.js';
import { setupImpactControls } from './controllers/impact.js';
import { setupProfile } from './controllers/profile.js';
import { setupSearch } from './controllers/search.js';
import { setupShare } from './controllers/share.js';
import { setupTabs } from './controllers/tabs.js';
import { setupVoice } from './controllers/voice.js';
import { byId, el, replaceChildren } from './dom.js';
import { renderBrief } from './render/index.js';
import { loadPlace, loadProfile, savePlace, saveProfile } from './storage.js';

/**
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('./storage.js').Profile} Profile
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {import('./controllers/voice.js').RecogniserConstructor} RecogniserConstructor
 * @typedef {Pick<typeof defaultApi, 'searchPlaces' | 'fetchBrief' | 'sendChat' | 'fetchHealth'>} Api
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

/**
 * Compose the UI: state, the plan loader and every controller. All browser
 * capabilities are injectable so the whole flow is testable in jsdom.
 * @param {AppOptions} [options]
 */
export function startApp(options = {}) {
  const env = resolveEnvironment(options);
  const status = byId('status', HTMLParagraphElement);
  const results = byId('results', HTMLDivElement);
  const placeInput = byId('place-input', HTMLInputElement);
  const currentPlace = byId('current-place', HTMLParagraphElement);
  const locationAqi = byId('location-aqi', HTMLSpanElement);
  const landing = byId('landing', HTMLElement);
  const howItWorks = byId('how-it-works', HTMLUListElement);
  const changeCity = byId('change-city', HTMLButtonElement);
  const targets = collectTargets();
  const tabs = setupTabs({
    tablist: /** @type {HTMLElement} */ (document.querySelector('[role="tablist"]')),
  });
  const hadProfile = env.storage.getItem('airwise.profile.v1') !== null;
  const state = {
    profile: loadProfile(env.storage),
    /** @type {Place | null} */ place: loadPlace(env.storage),
    /** @type {AirBrief | null} */ brief: null,
  };

  /** @param {string} message @param {'info' | 'error'} [kind] */
  function setStatus(message, kind = 'info') {
    // Errors are announced assertively, progress politely.
    status.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    status.textContent = message;
    status.dataset.kind = kind;
  }

  /** @param {unknown} error */
  const errorMessage = (error) =>
    error instanceof defaultApi.ApiError
      ? error.message
      : 'Something went wrong. Please try again.';

  function showCurrentPlace() {
    if (!state.place) return;
    replaceChildren(currentPlace, 'Plan for ', el('strong', { text: state.place.name }));
  }

  /**
   * Swap the landing page for the tabbed app once a plan exists.
   * @param {boolean} showApp
   */
  function setView(showApp) {
    document.body.dataset.view = showApp ? 'app' : 'landing';
    landing.hidden = showApp;
    howItWorks.hidden = showApp;
    changeCity.setAttribute('aria-expanded', String(!showApp));
  }
  setView(false);

  /** @param {AirBrief} brief */
  function showLocationAqi(brief) {
    locationAqi.textContent = `${brief.standard.shortName} ${brief.current.aqi} · ${brief.current.category.label}`;
    // CSSOM assignment is CSP-safe.
    locationAqi.style.backgroundColor = brief.current.category.color;
    locationAqi.style.color = brief.current.category.textColor;
    byId('location-source', HTMLSpanElement).textContent =
      brief.dataSource.kind === 'station' ? '● Live station data' : 'Model estimate';
  }

  const impact = setupImpactControls({
    container: targets.impact,
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

  /** @param {{ focusResults?: boolean }} [opts] */
  async function loadBrief({ focusResults = false } = {}) {
    if (!state.place) return;
    const place = state.place;
    setStatus(`Fetching live air and weather data for ${place.name}…`);
    results.setAttribute('aria-busy', 'true');
    try {
      /** @type {AirBrief} */
      const brief = await env.api.fetchBrief({
        location: place,
        standard: state.profile.standard,
        household: state.profile.household,
      });
      state.brief = brief;
      renderBrief(brief, targets, impact.pledged);
      document.body.dataset.aqiLevel = String(brief.current.category.level);
      showLocationAqi(brief);
      results.hidden = false;
      setView(true);
      setStatus(
        `Plan ready for ${place.name}: ${brief.current.category.label}, AQI ${brief.current.aqi}.`,
      );
      if (focusResults) tabs.select('today', { focus: 'panel' });
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    } finally {
      results.setAttribute('aria-busy', 'false');
    }
  }

  /** @param {Place} place */
  function choosePlace(place) {
    state.place = place;
    savePlace(env.storage, place);
    showCurrentPlace();
    return loadBrief({ focusResults: true });
  }

  setupSearch({
    ui: {
      form: byId('place-form', HTMLFormElement),
      input: placeInput,
      results: byId('place-results', HTMLUListElement),
      geoButton: byId('geo-button', HTMLButtonElement),
      cityButtons: document.querySelectorAll('.chip-city'),
    },
    searchPlaces: env.api.searchPlaces,
    choosePlace,
    setStatus,
    errorMessage,
    geolocation: env.geolocation,
  });

  const profile = setupProfile({
    ui: {
      form: byId('profile-form', HTMLFormElement),
      summary: byId('family-summary', HTMLUListElement),
      hint: byId('family-hint', HTMLParagraphElement),
      error: byId('profile-error', HTMLParagraphElement),
    },
    storage: env.storage,
    getProfile: () => state.profile,
    setProfile: (next) => {
      state.profile = next;
    },
    onSaved: () => {
      if (state.place) void loadBrief({ focusResults: true });
      else {
        setStatus('Profile saved. Now choose your city above.');
        placeInput.focus();
      }
    },
  });
  if (!hadProfile) {
    byId('family-hint', HTMLParagraphElement).textContent =
      'Showing a sample family. Tap “Edit family” to match yours: it changes every recommendation.';
  }

  setupShare({
    shareButton: byId('share-button', HTMLButtonElement),
    speakButton: byId('speak-button', HTMLButtonElement),
    getBrief: () => state.brief,
    setStatus,
    share: env.share,
    clipboard: env.clipboard,
    speech: env.speech,
  });

  const chat = createChat({
    log: byId('chat-log', HTMLDivElement),
    form: byId('chat-form', HTMLFormElement),
    input: byId('chat-input', HTMLTextAreaElement),
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
      setStatus('Choose your city first so answers use your local air data.', 'error');
      placeInput.focus();
    },
  });
  chat.showSuggestions(INITIAL_SUGGESTIONS);

  setupVoice({
    button: byId('voice-button', HTMLButtonElement),
    input: byId('chat-input', HTMLTextAreaElement),
    onTranscript: (text) => void chat.ask(text),
    setStatus,
    Recognition: env.Recognition,
  });

  const health = env.api
    .fetchHealth()
    .then((info) => {
      byId('chat-mode', HTMLParagraphElement).textContent =
        info.assistant === 'rules'
          ? 'Running in offline mode: answers come from AirWise rules using your live data.'
          : `Powered by ${info.assistant === 'gemini' ? 'Google Gemini' : 'Claude'}, grounded in your live air data. Your household details are sent without any names.`;
    })
    .catch(() => undefined);

  changeCity.addEventListener('click', () => {
    const opening = landing.hidden;
    landing.hidden = !opening;
    changeCity.setAttribute('aria-expanded', String(opening));
    if (opening) placeInput.focus();
  });

  showCurrentPlace();
  const initialLoad = loadBrief();
  return {
    state,
    chat,
    tabs,
    loadBrief,
    choosePlace,
    ready: Promise.all([health, initialLoad]),
  };
}
