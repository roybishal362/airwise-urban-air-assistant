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
 * }} SearchOptions
 */

/** @param {Place} p */
export const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');

/**
 * City search, one-tap popular cities and browser geolocation.
 * @param {SearchOptions} options
 */
export function setupSearch({
  ui,
  searchPlaces,
  choosePlace,
  setStatus,
  errorMessage,
  geolocation,
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
