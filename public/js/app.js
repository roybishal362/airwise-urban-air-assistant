// @ts-check
import * as defaultApi from './api.js';
import { createChat } from './chat.js';
import { byId, el, replaceChildren } from './dom.js';
import { FieldError, readProfile, writeProfile } from './profileForm.js';
import { planToText, renderBrief } from './render/index.js';
import { loadPlace, loadProfile, savePlace, saveProfile } from './storage.js';

/**
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {Pick<typeof defaultApi, 'searchPlaces' | 'fetchBrief' | 'sendChat' | 'fetchHealth'>} Api
 * @typedef {{
 *   storage?: Storage,
 *   api?: Api,
 *   geolocation?: Geolocation | null,
 *   speech?: SpeechSynthesis | null,
 *   share?: ((data: ShareData) => Promise<void>) | null,
 *   clipboard?: Pick<Clipboard, 'writeText'> | null,
 * }} AppOptions
 */

const INITIAL_SUGGESTIONS = [
  'Is it safe for my kids to play outside today?',
  'What is the best time to go for a walk?',
  'How can my family cut emissions this week?',
];

/**
 * Wire the UI to the API. Every browser capability is injected so the whole
 * flow is testable in jsdom; `main.js` passes the real ones.
 * @param {AppOptions} [options]
 */
export function startApp(options = {}) {
  const storage = options.storage ?? localStorage;
  const api = options.api ?? defaultApi;
  const geolocation =
    options.geolocation === undefined ? navigator.geolocation : options.geolocation;
  const speech = options.speech === undefined ? globalThis.speechSynthesis : options.speech;
  const share = options.share === undefined ? navigator.share?.bind(navigator) : options.share;
  const clipboard = options.clipboard === undefined ? navigator.clipboard : options.clipboard;

  const ui = {
    placeForm: byId('place-form', HTMLFormElement),
    placeInput: byId('place-input', HTMLInputElement),
    placeResults: byId('place-results', HTMLUListElement),
    geoButton: byId('geo-button', HTMLButtonElement),
    currentPlace: byId('current-place', HTMLParagraphElement),
    profileForm: byId('profile-form', HTMLFormElement),
    profileError: byId('profile-error', HTMLParagraphElement),
    status: byId('status', HTMLParagraphElement),
    results: byId('results', HTMLDivElement),
    nowSection: byId('now', HTMLElement),
    shareButton: byId('share-button', HTMLButtonElement),
    speakButton: byId('speak-button', HTMLButtonElement),
    chatMode: byId('chat-mode', HTMLParagraphElement),
  };

  const targets = {
    now: byId('now-body', HTMLDivElement),
    family: byId('family-body', HTMLDivElement),
    forecast: byId('forecast-body', HTMLDivElement),
    routine: byId('routine-body', HTMLDivElement),
    indoor: byId('indoor-body', HTMLDivElement),
    impact: byId('impact-body', HTMLDivElement),
  };

  const state = {
    profile: loadProfile(storage),
    /** @type {Place | null} */
    place: loadPlace(storage),
    /** @type {AirBrief | null} */
    brief: null,
  };

  /**
   * Errors are announced assertively, progress politely.
   * @param {string} message
   * @param {'info' | 'error'} [kind]
   */
  function setStatus(message, kind = 'info') {
    ui.status.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  /** @param {unknown} error */
  const errorMessage = (error) =>
    error instanceof defaultApi.ApiError
      ? error.message
      : 'Something went wrong. Please try again.';

  function showCurrentPlace() {
    if (!state.place) return;
    ui.currentPlace.hidden = false;
    replaceChildren(ui.currentPlace, 'Showing plan for ', el('strong', { text: state.place.name }));
  }

  /** @param {{ focusResults?: boolean }} [opts] */
  async function loadBrief({ focusResults = false } = {}) {
    if (!state.place) return;
    const place = state.place;
    setStatus(`Fetching live air and weather data for ${place.name}…`);
    ui.results.setAttribute('aria-busy', 'true');
    try {
      /** @type {AirBrief} */
      const brief = await api.fetchBrief({
        location: place,
        standard: state.profile.standard,
        household: state.profile.household,
      });
      state.brief = brief;
      renderBrief(brief, targets);
      ui.results.hidden = false;
      setStatus(
        `Plan ready for ${place.name}: ${brief.current.category.label}, AQI ${brief.current.aqi}.`,
      );
      if (focusResults) ui.nowSection.focus();
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    } finally {
      ui.results.setAttribute('aria-busy', 'false');
    }
  }

  /** @param {Place} place */
  function choosePlace(place) {
    state.place = place;
    savePlace(storage, place);
    ui.placeResults.hidden = true;
    replaceChildren(ui.placeResults);
    showCurrentPlace();
    return loadBrief({ focusResults: true });
  }

  /** @param {Place} p */
  const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');

  async function searchForPlace() {
    const query = ui.placeInput.value.trim();
    if (query.length < 2) {
      setStatus('Type at least two letters of your city.', 'error');
      ui.placeInput.focus();
      return;
    }
    setStatus(`Searching for "${query}"…`);
    try {
      /** @type {Place[]} */
      const places = await api.searchPlaces(query);
      if (places.length === 0) {
        setStatus(
          `No places found for "${query}". Check the spelling or try a nearby city.`,
          'error',
        );
        return;
      }
      replaceChildren(
        ui.placeResults,
        places.map((p) => {
          const button = el('button', {
            type: 'button',
            className: 'place-option',
            text: placeLabel(p),
          });
          button.addEventListener('click', () => void choosePlace(p));
          return el('li', {}, button);
        }),
      );
      ui.placeResults.hidden = false;
      setStatus(`${places.length} place${places.length === 1 ? '' : 's'} found. Choose one.`);
      ui.placeResults.querySelector('button')?.focus();
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    }
  }

  function useMyLocation() {
    if (!geolocation) {
      setStatus(
        'Location is not available in this browser. Search for your city instead.',
        'error',
      );
      return;
    }
    setStatus('Asking your browser for your location…');
    geolocation.getCurrentPosition(
      (position) => {
        // ~100 m precision is plenty for a ~10 km air-quality grid and protects privacy.
        const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
        void choosePlace({
          name: 'Your location',
          latitude: round(position.coords.latitude),
          longitude: round(position.coords.longitude),
        });
      },
      () => setStatus('Could not get your location. Search for your city instead.', 'error'),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  function clearFieldErrors() {
    ui.profileForm.querySelectorAll('[aria-invalid="true"]').forEach((node) => {
      node.removeAttribute('aria-invalid');
      const described = (node.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter((id) => id && id !== 'profile-error');
      if (described.length) node.setAttribute('aria-describedby', described.join(' '));
      else node.removeAttribute('aria-describedby');
    });
  }

  function submitProfile() {
    clearFieldErrors();
    try {
      state.profile = readProfile(ui.profileForm);
    } catch (error) {
      ui.profileError.textContent =
        error instanceof RangeError ? error.message : 'Please check the form.';
      ui.profileError.hidden = false;
      if (error instanceof FieldError) {
        // Tie the message to the offending field so screen readers announce both.
        const field = ui.profileForm.elements.namedItem(error.field);
        if (field instanceof HTMLElement) {
          field.setAttribute('aria-invalid', 'true');
          const described = field.getAttribute('aria-describedby');
          field.setAttribute(
            'aria-describedby',
            described ? `${described} profile-error` : 'profile-error',
          );
          field.focus();
        }
      }
      return;
    }
    ui.profileError.hidden = true;
    saveProfile(storage, state.profile);
    if (state.place) void loadBrief({ focusResults: true });
    else {
      setStatus('Profile saved. Now choose your city above.');
      ui.placeInput.focus();
    }
  }

  async function sharePlan() {
    if (!state.brief) return;
    const text = planToText(state.brief);
    try {
      if (share) {
        await share({ title: 'AirWise plan', text });
      } else if (clipboard) {
        await clipboard.writeText(text);
        setStatus('Plan copied. Paste it into your family or society group chat.');
      }
    } catch {
      // The user cancelled the share sheet; nothing to do.
    }
  }

  function speakPlan() {
    if (!state.brief || !speech) return;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(planToText(state.brief));
    utterance.lang = 'en-IN';
    speech.speak(utterance);
  }

  ui.placeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void searchForPlace();
  });
  ui.geoButton.addEventListener('click', useMyLocation);
  ui.profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitProfile();
  });
  ui.shareButton.addEventListener('click', () => void sharePlan());
  if (speech) {
    ui.speakButton.hidden = false;
    ui.speakButton.addEventListener('click', speakPlan);
  }

  const chat = createChat({
    log: byId('chat-log', HTMLDivElement),
    form: byId('chat-form', HTMLFormElement),
    input: byId('chat-input', HTMLTextAreaElement),
    suggestions: byId('chat-suggestions', HTMLDivElement),
    send: (message, history) =>
      api.sendChat({
        location: state.place,
        standard: state.profile.standard,
        household: state.profile.household,
        message,
        history,
      }),
    canSend: () => state.place !== null,
    onBlocked: () => {
      setStatus('Choose your city first so answers use your local air data.', 'error');
      ui.placeInput.focus();
    },
  });
  chat.showSuggestions(INITIAL_SUGGESTIONS);

  const ready = api
    .fetchHealth()
    .then((health) => {
      ui.chatMode.textContent =
        health.assistant === 'rules'
          ? 'Running in offline mode: answers come from AirWise rules using your live data.'
          : `Powered by ${health.assistant === 'gemini' ? 'Google Gemini' : 'Claude'}, grounded in your live air data. Your household details are sent without any names.`;
    })
    .catch(() => undefined);

  writeProfile(ui.profileForm, state.profile);
  showCurrentPlace();
  const initialLoad = loadBrief();

  return { state, chat, loadBrief, choosePlace, ready: Promise.all([ready, initialLoad]) };
}
