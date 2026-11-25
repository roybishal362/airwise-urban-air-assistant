// @ts-check
import { byId, el, replaceChildren } from './dom.js';

/**
 * @typedef {import('./storage.js').Place} Place
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {ReturnType<typeof createShell>} Shell
 */

/**
 * The app shell around the plan: the status line, the landing ↔ app view,
 * the page title and the location bar. Presentation only; no data loading.
 */
export function createShell() {
  const status = byId('status', HTMLParagraphElement);
  const landing = byId('landing', HTMLElement);
  const howItWorks = byId('how-it-works', HTMLUListElement);
  const changeCity = byId('change-city', HTMLButtonElement);
  const placeInput = byId('place-input', HTMLInputElement);
  const appTitle = document.title;

  /** @param {string} message @param {'info' | 'error'} [kind] */
  function setStatus(message, kind = 'info') {
    // Errors are announced assertively, progress politely.
    status.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    status.textContent = message;
    status.dataset.kind = kind;
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

  /**
   * In a single-page app the title is how screen-reader users (and browser
   * tabs/history) know where they are: "Forecast · Delhi · AirWise".
   * @param {string} section @param {string | null} placeName  null before a plan exists
   */
  function setTitle(section, placeName) {
    document.title = placeName
      ? [section, placeName, 'AirWise'].filter(Boolean).join(' · ')
      : appTitle;
  }

  /** @param {Place} place */
  function showPlace(place) {
    replaceChildren(
      byId('current-place', HTMLParagraphElement),
      'Plan for ',
      el('strong', { text: place.name }),
    );
  }

  /** @param {AirBrief} brief */
  function showAqi(brief) {
    const pill = byId('location-aqi', HTMLSpanElement);
    const { category } = brief.current;
    pill.textContent = `${brief.standard.shortName} ${String(brief.current.aqi)} · ${category.label}`;
    // CSSOM assignment is CSP-safe.
    pill.style.backgroundColor = category.color;
    pill.style.color = category.textColor;
    document.body.dataset.aqiLevel = String(category.level);
    const source = byId('location-source', HTMLSpanElement);
    const live = brief.dataSource.kind === 'station';
    // The "live" dot is drawn in CSS so screen readers don't read "black circle".
    source.textContent = live ? 'Live station data' : 'Model estimate';
    source.classList.toggle('is-live', live);
  }

  const focusSearch = () => placeInput.focus();

  // "Change city" reopens the search over the app (and closes it again).
  changeCity.addEventListener('click', () => {
    const opening = landing.hidden;
    landing.hidden = !opening;
    changeCity.setAttribute('aria-expanded', String(opening));
    if (opening) focusSearch();
  });

  setView(false);
  return { setStatus, setView, setTitle, showPlace, showAqi, focusSearch };
}
