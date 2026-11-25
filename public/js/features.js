// @ts-check
import { errorMessage } from './api.js';
import { createChat } from './chat.js';
import { setupProfile } from './controllers/profile.js';
import { setupSearch } from './controllers/search.js';
import { setupShare } from './controllers/share.js';
import { setupVoice } from './controllers/voice.js';
import { byId } from './dom.js';

/**
 * Wiring for the family editor, the assistant, city search and sharing.
 * @typedef {import('./environment.js').Environment} Environment
 * @typedef {import('./environment.js').AppState} AppState
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('./shell.js').Shell} Shell
 */

const INITIAL_SUGGESTIONS = [
  'Is it safe for my kids to play outside today?',
  'What is the best time to go for a walk?',
  'How can my family cut emissions this week?',
];

/**
 * The family editor: saving reloads the plan (or asks for a city first).
 * @param {{ env: Environment, state: AppState, shell: Shell, loadBrief: (opts?: { focusResults?: boolean }) => Promise<void> }} ctx
 */
export function setupFamily({ env, state, shell, loadBrief }) {
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
export function setupAssistant({ env, state, shell }) {
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
export function setupPlaceSearch({ env, shell, choosePlace }) {
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
export function setupSharing({ env, state, shell }) {
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
