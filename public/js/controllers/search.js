// @ts-check
import { el, replaceChildren } from '../dom.js';

/**
 * @typedef {import('../storage.js').Place} Place
 * @typedef {{
 *   form: HTMLFormElement,
 *   input: HTMLInputElement,
 *   results: HTMLUListElement,
 *   geoButton: HTMLButtonElement,
 *   cityButtons: NodeListOf<HTMLButtonElement>,
 * }} SearchUi
 * @typedef {{
 *   ui: SearchUi,
 *   searchPlaces: (query: string) => Promise<Place[]>,
 *   choosePlace: (place: Place) => unknown,
 *   setStatus: (message: string, kind?: 'info' | 'error') => void,
 *   errorMessage: (error: unknown) => string,
 *   geolocation: Geolocation | null | undefined,
 *   locateApproximately?: () => Promise<Place>,
 * }} SearchOptions
 */

const BLOCKED =
  'Location is blocked for this site. To allow it, click the icon left of the address bar, open Site settings and set Location to Allow. Or search for your city.';
const TOO_SLOW = 'Finding your location took too long.';
const NO_FIX =
  'Your device could not work out its location (on Windows, check Settings › Privacy & security › Location).';

/** @param {Place} p */
export const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');

/**
 * ~100 m precision is plenty for a ~10 km air-quality grid and protects privacy.
 * @param {GeolocationPosition} position
 * @returns {Place}
 */
function roundedPlace({ coords }) {
  const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
  return {
    name: 'Your location',
    latitude: round(coords.latitude),
    longitude: round(coords.longitude),
  };
}

/**
 * A one-tap popular city: `<button data-city data-lat data-lon data-country>`.
 * @param {HTMLButtonElement} button
 * @returns {Place}
 */
function chipPlace(button) {
  const { city = '', lat = '', lon = '', country } = button.dataset;
  return { name: city, latitude: Number(lat), longitude: Number(lon), countryCode: country };
}

/**
 * One button per match; choosing one hides the list.
 * @param {HTMLUListElement} list @param {Place[]} places
 * @param {(place: Place) => unknown} choosePlace
 */
function showMatches(list, places, choosePlace) {
  replaceChildren(
    list,
    places.map((p) => {
      const button = el('button', {
        type: 'button',
        className: 'place-option',
        text: placeLabel(p),
      });
      button.addEventListener('click', () => {
        list.hidden = true;
        void choosePlace(p);
      });
      return el('li', {}, button);
    }),
  );
  list.hidden = false;
}

/**
 * Search by name: validate, look up, list the matches and focus the first.
 * @param {Pick<SearchOptions, 'ui' | 'searchPlaces' | 'choosePlace' | 'setStatus' | 'errorMessage'>} options
 */
function createTextSearch({ ui, searchPlaces, choosePlace, setStatus, errorMessage }) {
  /** @param {string} query */
  async function find(query) {
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
      showMatches(ui.results, places, choosePlace);
      setStatus(`${places.length} place${places.length === 1 ? '' : 's'} found. Choose one.`);
      ui.results.querySelector('button')?.focus();
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    }
  }

  return async function search() {
    const query = ui.input.value.trim();
    if (query.length >= 2) return find(query);
    setStatus('Type at least two letters of your city.', 'error');
    ui.input.focus();
  };
}

/**
 * "Use my location": browser geolocation, with a city-level network fallback
 * when the device cannot locate itself (but never when the user blocked it).
 * @param {Pick<SearchOptions, 'ui' | 'choosePlace' | 'setStatus' | 'geolocation' | 'locateApproximately'>} options
 */
function createLocator({ ui, choosePlace, setStatus, geolocation, locateApproximately }) {
  /** Keyboard and screen-reader users land where they can act next. @param {string} message */
  function searchInstead(message) {
    setStatus(message, 'error');
    ui.input.focus();
  }

  /**
   * Fall back to the area the server derives from the network, marked "(approximate)".
   * @param {string} reason
   */
  async function useNetworkArea(reason) {
    if (!locateApproximately) return searchInstead(`${reason} Search for your city instead.`);
    setStatus(`${reason} Finding your approximate area from your network instead…`);
    try {
      await choosePlace(await locateApproximately());
    } catch {
      searchInstead(`${reason} Search for your city instead.`);
    }
  }

  /** @param {GeolocationPositionError} error */
  async function locationFailed(error) {
    // The user (or the browser) blocked location: respect it, no fallback.
    if (error.code === 1) return searchInstead(BLOCKED);
    return useNetworkArea(error.code === 3 ? TOO_SLOW : NO_FIX);
  }

  /** @param {boolean} busy */
  function setLocating(busy) {
    ui.geoButton.disabled = busy;
    ui.geoButton.setAttribute('aria-busy', String(busy));
  }

  return function useMyLocation() {
    setLocating(true);
    const done = () => setLocating(false);
    if (!geolocation) {
      void useNetworkArea('This browser cannot share your location.').finally(done);
      return;
    }
    setStatus('Asking your browser for your location…');
    geolocation.getCurrentPosition(
      (position) => {
        done();
        void choosePlace(roundedPlace(position));
      },
      (error) => void locationFailed(error).finally(done),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };
}

/**
 * City search, one-tap popular cities and browser geolocation.
 * @param {SearchOptions} options
 */
export function setupSearch(options) {
  const { ui, choosePlace } = options;
  const search = createTextSearch(options);
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void search();
  });
  ui.geoButton.addEventListener('click', createLocator(options));
  ui.cityButtons.forEach((button) => {
    button.addEventListener('click', () => void choosePlace(chipPlace(button)));
  });
}
