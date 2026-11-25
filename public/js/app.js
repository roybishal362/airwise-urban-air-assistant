// @ts-check
import { errorMessage } from './api.js';
import { setupImpactControls } from './controllers/impact.js';
import { setupTabs } from './controllers/tabs.js';
import { byId } from './dom.js';
import { resolveEnvironment } from './environment.js';
import { setupAssistant, setupFamily, setupPlaceSearch, setupSharing } from './features.js';
import { renderBrief } from './render/index.js';
import { createShell } from './shell.js';
import { loadPlace, loadProfile, savePlace, saveProfile } from './storage.js';

/**
 * @typedef {import('./environment.js').AppOptions} AppOptions
 * @typedef {import('./environment.js').Environment} Environment
 * @typedef {import('./environment.js').AppState} AppState
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {import('./shell.js').Shell} Shell
 * @typedef {ReturnType<typeof setupTabs>} Tabs
 */

/** The container of each plan section, keyed by section name. */
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
 * The impact tab's pledges and community slider; moving the slider updates the saved profile.
 * @param {{ env: Environment, state: AppState, onProfileChange: () => void }} ctx
 */
function setupImpact({ env, state, onProfileChange }) {
  return setupImpactControls({
    container: byId('impact-body', HTMLDivElement),
    storage: env.storage,
    getBrief: () => state.brief,
    setBrief: (brief) => {
      state.brief = brief;
    },
    onHouseholdsChange: (households) => {
      state.profile.household.communityHouseholds = households;
      saveProfile(env.storage, state.profile);
      onProfileChange();
    },
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
  const impact = setupImpact({ env, state, onProfileChange: () => profile.syncHouseholds() });
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
