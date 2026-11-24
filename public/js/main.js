// @ts-check
import { ApiError, fetchBrief, fetchHealth, searchPlaces, sendChat } from './api.js';
import { createChat } from './chat.js';
import { byId, el, replaceChildren } from './dom.js';
import { readProfile, writeProfile } from './profileForm.js';
import { planToText, renderBrief } from './render.js';
import { loadPlace, loadProfile, savePlace, saveProfile } from './storage.js';

/** @typedef {import('./storage.js').Place} Place */
/** @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief */

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
  profile: loadProfile(localStorage),
  /** @type {Place | null} */
  place: loadPlace(localStorage),
  /** @type {AirBrief | null} */
  brief: null,
};

/** @param {string} message @param {'info' | 'error'} [kind] */
function setStatus(message, kind = 'info') {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

/** @param {unknown} error */
const errorMessage = (error) =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';

function showCurrentPlace() {
  if (!state.place) return;
  ui.currentPlace.hidden = false;
  replaceChildren(ui.currentPlace, 'Showing plan for ', el('strong', { text: state.place.name }));
}

/** @param {{ focusResults?: boolean }} [options] */
async function loadBrief({ focusResults = false } = {}) {
  if (!state.place) return;
  const place = state.place;
  setStatus(`Fetching live air and weather data for ${place.name}…`);
  ui.results.setAttribute('aria-busy', 'true');
  try {
    /** @type {AirBrief} */
    const brief = await fetchBrief({
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
  savePlace(localStorage, place);
  ui.placeResults.hidden = true;
  replaceChildren(ui.placeResults);
  showCurrentPlace();
  void loadBrief({ focusResults: true });
}

/** @param {Place} p */
const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');

ui.placeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = ui.placeInput.value.trim();
  if (query.length < 2) {
    setStatus('Type at least two letters of your city.', 'error');
    ui.placeInput.focus();
    return;
  }
  setStatus(`Searching for "${query}"…`);
  try {
    const places = await searchPlaces(query);
    if (places.length === 0) {
      setStatus(
        `No places found for "${query}". Check the spelling or try a nearby city.`,
        'error',
      );
      return;
    }
    replaceChildren(
      ui.placeResults,
      places.map((/** @type {Place} */ p) => {
        const button = el('button', {
          type: 'button',
          className: 'place-option',
          text: placeLabel(p),
        });
        button.addEventListener('click', () => choosePlace(p));
        return el('li', {}, button);
      }),
    );
    ui.placeResults.hidden = false;
    setStatus(`${places.length} place${places.length === 1 ? '' : 's'} found. Choose one.`);
    ui.placeResults.querySelector('button')?.focus();
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  }
});

ui.geoButton.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setStatus('Location is not available in this browser. Search for your city instead.', 'error');
    return;
  }
  setStatus('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // ~100 m precision is plenty for a ~10 km air-quality grid and protects privacy.
      const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
      choosePlace({
        name: 'Your location',
        latitude: round(position.coords.latitude),
        longitude: round(position.coords.longitude),
      });
    },
    () => setStatus('Could not get your location. Search for your city instead.', 'error'),
    { timeout: 10_000, maximumAge: 600_000 },
  );
});

ui.profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    state.profile = readProfile(ui.profileForm);
  } catch (error) {
    ui.profileError.textContent =
      error instanceof RangeError ? error.message : 'Please check the form.';
    ui.profileError.hidden = false;
    return;
  }
  ui.profileError.hidden = true;
  saveProfile(localStorage, state.profile);
  if (state.place) void loadBrief({ focusResults: true });
  else {
    setStatus('Profile saved. Now choose your city above.');
    ui.placeInput.focus();
  }
});

ui.shareButton.addEventListener('click', async () => {
  if (!state.brief) return;
  const text = planToText(state.brief);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'AirWise plan', text });
    } else {
      await navigator.clipboard.writeText(text);
      setStatus('Plan copied. Paste it into your family or society group chat.');
    }
  } catch {
    // The user cancelled the share sheet; nothing to do.
  }
});

if ('speechSynthesis' in window) {
  ui.speakButton.hidden = false;
  ui.speakButton.addEventListener('click', () => {
    if (!state.brief) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(planToText(state.brief));
    utterance.lang = 'en-IN';
    speechSynthesis.speak(utterance);
  });
}

const chat = createChat({
  log: byId('chat-log', HTMLDivElement),
  form: byId('chat-form', HTMLFormElement),
  input: byId('chat-input', HTMLTextAreaElement),
  suggestions: byId('chat-suggestions', HTMLDivElement),
  send: (message, history) =>
    sendChat({
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
chat.showSuggestions([
  'Is it safe for my kids to play outside today?',
  'What is the best time to go for a walk?',
  'How can my family cut emissions this week?',
]);

fetchHealth()
  .then((health) => {
    ui.chatMode.textContent =
      health.assistant === 'rules'
        ? 'Running in offline mode: answers come from AirWise rules using your live data.'
        : `Powered by ${health.assistant === 'gemini' ? 'Google Gemini' : 'Claude'}, grounded in your live air data. Your household details are sent without any names.`;
  })
  .catch(() => undefined);

writeProfile(ui.profileForm, state.profile);
showCurrentPlace();
void loadBrief();
