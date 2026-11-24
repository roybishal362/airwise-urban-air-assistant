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

/** @param {Place} p */
export const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');

/**
 * City search, one-tap popular cities and browser geolocation (with a
 * city-level network fallback when the device cannot locate itself).
 * @param {SearchOptions} options
 */
export function setupSearch({
  ui,
  searchPlaces,
  choosePlace,
  setStatus,
  errorMessage,
  geolocation,
  locateApproximately,
}) {
  async function search() {
    const query = ui.input.value.trim();
    if (query.length < 2) {
      setStatus('Type at least two letters of your city.', 'error');
      ui.input.focus();
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
        ui.results,
        places.map((p) => {
          const button = el('button', {
            type: 'button',
            className: 'place-option',
            text: placeLabel(p),
          });
          button.addEventListener('click', () => {
            ui.results.hidden = true;
            void choosePlace(p);
          });
          return el('li', {}, button);
        }),
      );
      ui.results.hidden = false;
      setStatus(`${places.length} place${places.length === 1 ? '' : 's'} found. Choose one.`);
      ui.results.querySelector('button')?.focus();
    } catch (error) {
      setStatus(errorMessage(error), 'error');
    }
  }

  /** Keyboard and screen-reader users land where they can act next. */
  const focusSearch = () => ui.input.focus();

  /** @param {boolean} busy */
  function setLocating(busy) {
    ui.geoButton.disabled = busy;
    ui.geoButton.setAttribute('aria-busy', String(busy));
  }

  /**
   * The device could not locate itself: fall back to the city-level area the
   * server derives from the network, clearly marked "(approximate)".
   * @param {string} reason
   */
  async function useNetworkArea(reason) {
    if (!locateApproximately) {
      setStatus(`${reason} Search for your city instead.`, 'error');
      focusSearch();
      return;
    }
    setStatus(`${reason} Finding your approximate area from your network instead…`);
    try {
      const place = await locateApproximately();
      await choosePlace(place);
    } catch {
      setStatus(`${reason} Search for your city instead.`, 'error');
      focusSearch();
    }
  }

  /** @param {GeolocationPositionError} error */
  function locationFailed(error) {
    if (error.code === 1) {
      // The user (or the browser) blocked location: respect it, no fallback.
      setStatus(
        'Location is blocked for this site. To allow it, click the icon left of the address bar, open Site settings and set Location to Allow. Or search for your city.',
        'error',
      );
      focusSearch();
      return Promise.resolve();
    }
    const reason =
      error.code === 3
        ? 'Finding your location took too long.'
        : 'Your device could not work out its location (on Windows, check Settings › Privacy & security › Location).';
    return useNetworkArea(reason);
  }

  function useMyLocation() {
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
        // ~100 m precision is plenty for a ~10 km air-quality grid and protects privacy.
        const round = (/** @type {number} */ n) => Math.round(n * 1000) / 1000;
        void choosePlace({
          name: 'Your location',
          latitude: round(position.coords.latitude),
          longitude: round(position.coords.longitude),
        });
      },
      (error) => void locationFailed(error).finally(done),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void search();
  });
  ui.geoButton.addEventListener('click', useMyLocation);
  ui.cityButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { city = '', lat = '', lon = '', country } = button.dataset;
      void choosePlace({
        name: city,
        latitude: Number(lat),
        longitude: Number(lon),
        countryCode: country,
      });
    });
  });
}
