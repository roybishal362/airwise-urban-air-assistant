// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../public/js/api.js';
import { startApp } from '../../public/js/app.js';
import { buildBrief } from '../../src/domain/brief.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';
import { MemoryStorage, loadPage } from '../fixtures/browser.js';

const brief = buildBrief({
  location: DELHI,
  air: makeAir({ scale: 4 }),
  weather: makeWeather(),
  household: makeHousehold({ communityHouseholds: 20 }),
  standard: 'auto',
});

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    searchPlaces: vi.fn(async () => [
      DELHI,
      { ...DELHI, name: 'Delhi', region: 'New York', country: 'United States', countryCode: 'US' },
    ]),
    fetchBrief: vi.fn(async () => brief),
    sendChat: vi.fn(async () => ({
      reply: 'Stay in today.',
      source: 'gemini',
      suggestions: ['Next?'],
    })),
    fetchHealth: vi.fn(async () => ({ status: 'ok', assistant: 'gemini' })),
    ...overrides,
  };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function boot(options: Parameters<typeof startApp>[0] = {}) {
  const storage = (options.storage as MemoryStorage | undefined) ?? new MemoryStorage();
  const api = (options.api as ReturnType<typeof makeApi> | undefined) ?? makeApi();
  const app = startApp({
    geolocation: null,
    speech: null,
    share: null,
    clipboard: null,
    ...options,
    storage,
    api,
  });
  return { app, api, storage };
}

beforeEach(() => {
  loadPage();
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = '';
      constructor(public text: string) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('start-up', () => {
  it('restores a saved place, renders the plan and labels the GenAI mode', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const { app } = boot({ storage });
    await app.ready;
    expect($('results').hidden).toBe(false);
    expect($('status').textContent).toMatch(/^Plan ready for Delhi/);
    expect($('current-place').textContent).toBe('Plan for Delhi');
    expect($('chat-mode').textContent).toMatch(/Google Gemini/);
    expect(document.querySelector('.policy h3')?.textContent).toMatch(/GRAP Stage/);
    expect(document.querySelector('.community-figure')?.textContent).toMatch(/avoided a year/);
    expect($('speak-button').hidden).toBe(true);
  });

  it('labels offline mode, tolerates a failed health check and waits for a place', async () => {
    const offline = boot({
      api: makeApi({ fetchHealth: vi.fn(async () => ({ assistant: 'rules' })) }),
    });
    await offline.app.ready;
    expect($('chat-mode').textContent).toMatch(/offline mode/);
    expect($('results').hidden).toBe(true);

    loadPage();
    const claude = boot({
      api: makeApi({ fetchHealth: vi.fn(async () => ({ assistant: 'claude' })) }),
    });
    await claude.app.ready;
    expect($('chat-mode').textContent).toMatch(/Claude/);

    loadPage();
    const failing = boot({
      api: makeApi({ fetchHealth: vi.fn(async () => Promise.reject(new Error('down'))) }),
    });
    await failing.app.ready;
    expect($('chat-mode').textContent).toMatch(/Ask anything about your air/);
  });

  it('announces a failed plan load assertively', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const { app } = boot({
      storage,
      api: makeApi({
        fetchBrief: vi.fn(async () =>
          Promise.reject(new ApiError('Service busy.', 502, 'UPSTREAM')),
        ),
      }),
    });
    await app.ready;
    expect($('status').textContent).toBe('Service busy.');
    expect($('status').getAttribute('aria-live')).toBe('assertive');
    expect($('results').getAttribute('aria-busy')).toBe('false');
  });
});

describe('place search', () => {
  it('validates, lists matches and loads the chosen place', async () => {
    const { api, storage } = boot();
    const input = $<HTMLInputElement>('place-input');
    input.value = 'D';
    $<HTMLFormElement>('place-form').requestSubmit();
    expect($('status').textContent).toMatch(/at least two letters/);
    expect(document.activeElement).toBe(input);

    input.value = 'Delhi';
    $<HTMLFormElement>('place-form').requestSubmit();
    await flush();
    const options = [...document.querySelectorAll<HTMLButtonElement>('#place-results button')];
    expect(options.map((b) => b.textContent)).toEqual([
      'Delhi, National Capital Territory of Delhi, India',
      'Delhi, New York, United States',
    ]);
    expect(document.activeElement).toBe(options[0]);
    expect($('status').textContent).toBe('2 places found. Choose one.');

    options[0]?.click();
    await vi.waitFor(() => expect($('results').hidden).toBe(false));
    expect(api.fetchBrief).toHaveBeenCalledWith(
      expect.objectContaining({ location: DELHI, standard: 'auto' }),
    );
    expect(JSON.parse(storage.getItem('airwise.place.v1') ?? '{}').name).toBe('Delhi');
    expect(document.activeElement?.id).toBe('panel-today');
    expect($('place-results').hidden).toBe(true);
  });

  it('explains empty results and API errors', async () => {
    const empty = boot({ api: makeApi({ searchPlaces: vi.fn(async () => []) }) });
    $<HTMLInputElement>('place-input').value = 'Atlantis';
    $<HTMLFormElement>('place-form').requestSubmit();
    await flush();
    expect($('status').textContent).toMatch(/No places found for "Atlantis"/);
    expect(empty.api.searchPlaces).toHaveBeenCalledWith('Atlantis');

    loadPage();
    boot({ api: makeApi({ searchPlaces: vi.fn(async () => Promise.reject(new Error('boom'))) }) });
    $<HTMLInputElement>('place-input').value = 'Delhi';
    $<HTMLFormElement>('place-form').requestSubmit();
    await flush();
    expect($('status').textContent).toBe('Something went wrong. Please try again.');
  });

  it('shows the singular form for one match', async () => {
    boot({ api: makeApi({ searchPlaces: vi.fn(async () => [DELHI]) }) });
    $<HTMLInputElement>('place-input').value = 'Delhi';
    $<HTMLFormElement>('place-form').requestSubmit();
    await flush();
    expect($('status').textContent).toBe('1 place found. Choose one.');
  });
});

describe('geolocation', () => {
  it('rounds coordinates to ~100 m before using them', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success({ coords: { latitude: 28.612345, longitude: 77.209876 } } as GeolocationPosition),
      ),
    } as unknown as Geolocation;
    const { api } = boot({ geolocation });
    $<HTMLButtonElement>('geo-button').click();
    await vi.waitFor(() => expect(api.fetchBrief).toHaveBeenCalled());
    expect(api.fetchBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { name: 'Your location', latitude: 28.612, longitude: 77.21 },
      }),
    );
  });

  it('handles refusal and missing support', () => {
    const geolocation = {
      getCurrentPosition: vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({} as GeolocationPositionError),
      ),
    } as unknown as Geolocation;
    boot({ geolocation });
    $<HTMLButtonElement>('geo-button').click();
    expect($('status').textContent).toMatch(/Could not get your location/);

    loadPage();
    boot({ geolocation: null });
    $<HTMLButtonElement>('geo-button').click();
    expect($('status').textContent).toMatch(/not available in this browser/);
  });
});

describe('profile form', () => {
  it('marks and focuses the invalid field, then clears it once fixed', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const { app, api } = boot({ storage });
    await app.ready;
    const form = $<HTMLFormElement>('profile-form');
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
    for (const name of ['adults', 'children', 'seniors']) field(name).value = '0';
    form.requestSubmit();
    expect($('profile-error').hidden).toBe(false);
    expect($('profile-error').textContent).toBe('Add at least one person to your household.');
    expect(field('adults').getAttribute('aria-invalid')).toBe('true');
    expect(field('adults').getAttribute('aria-describedby')).toBe('profile-error');
    expect(document.activeElement).toBe(field('adults'));

    field('roomAreaSqm').value = '2';
    field('adults').value = '2';
    form.requestSubmit();
    expect(field('adults').hasAttribute('aria-invalid')).toBe(false);
    expect(field('roomAreaSqm').getAttribute('aria-describedby')).toBe('room-hint profile-error');

    field('roomAreaSqm').value = '14';
    form.requestSubmit();
    expect(field('roomAreaSqm').getAttribute('aria-describedby')).toBe('room-hint');
    expect($('profile-error').hidden).toBe(true);
    await vi.waitFor(() => expect(api.fetchBrief).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse(storage.getItem('airwise.profile.v1') ?? '{}').household.home.roomAreaSqm,
    ).toBe(14);
  });

  it('asks for a city when the profile is saved first', () => {
    boot();
    $<HTMLFormElement>('profile-form').requestSubmit();
    expect($('status').textContent).toBe('Profile saved. Now choose your city above.');
    expect(document.activeElement?.id).toBe('place-input');
  });
});

describe('share and read aloud', () => {
  async function bootWithPlan(options: Parameters<typeof startApp>[0]) {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const booted = boot({ storage, ...options });
    await booted.app.ready;
    return booted;
  }

  it('uses the native share sheet when available', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    await bootWithPlan({ share });
    $<HTMLButtonElement>('share-button').click();
    await flush();
    expect(share).toHaveBeenCalledWith({
      title: 'AirWise plan',
      text: expect.stringMatching(/^AirWise plan for Delhi/),
    });
    expect(share.mock.calls[0]?.[0]?.text).toMatch(/Together our 20 households/);
  });

  it('falls back to the clipboard and ignores a cancelled share', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };
    await bootWithPlan({ clipboard });
    $<HTMLButtonElement>('share-button').click();
    await flush();
    expect(clipboard.writeText).toHaveBeenCalled();
    expect($('status').textContent).toMatch(/Plan copied/);

    loadPage();
    await bootWithPlan({ share: vi.fn(async () => Promise.reject(new Error('AbortError'))) });
    $<HTMLButtonElement>('share-button').click();
    await flush();
    expect($('status').textContent).toMatch(/^Plan ready/);
  });

  it('does nothing before a plan exists', async () => {
    const share = vi.fn(async () => undefined);
    const speech = { cancel: vi.fn(), speak: vi.fn() } as unknown as SpeechSynthesis;
    boot({ share, speech });
    $<HTMLButtonElement>('share-button').click();
    $<HTMLButtonElement>('speak-button').click();
    await flush();
    expect(share).not.toHaveBeenCalled();
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('reads the plan aloud in Indian English', async () => {
    const speech = { cancel: vi.fn(), speak: vi.fn() };
    await bootWithPlan({ speech: speech as unknown as SpeechSynthesis });
    expect($('speak-button').hidden).toBe(false);
    $<HTMLButtonElement>('speak-button').click();
    expect(speech.cancel).toHaveBeenCalled();
    expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-IN' }));
  });
});

describe('chat wiring', () => {
  it('blocks questions until a city is chosen, then sends the full context', async () => {
    const { app, api } = boot();
    await app.chat.ask('Can we go out?');
    expect($('status').textContent).toMatch(/Choose your city first/);
    expect(api.sendChat).not.toHaveBeenCalled();

    await app.choosePlace(DELHI);
    await app.chat.ask('Can we go out?');
    expect(api.sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        location: DELHI,
        message: 'Can we go out?',
        history: [],
        standard: 'auto',
      }),
    );
    expect(document.querySelector('#chat-log .msg-assistant')?.getAttribute('lang')).toBe('en');
  });
});

describe('main.js entry point', () => {
  it('starts the app with real browser capabilities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'ok', assistant: 'rules' }), { status: 200 }),
      ),
    );
    vi.resetModules();
    await import('../../public/js/main.js');
    expect(document.querySelectorAll('#chat-suggestions .chip')).toHaveLength(3);
  });
});

describe('defensive paths', () => {
  it('reports a generic error if the form markup is broken', () => {
    boot();
    document.querySelector('input[name="commuteKm"]')?.remove();
    $<HTMLFormElement>('profile-form').requestSubmit();
    expect($('profile-error').textContent).toBe('Please check the form.');
    expect($('profile-error').hidden).toBe(false);
  });

  it('does nothing when neither sharing nor the clipboard is available', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const { app } = boot({ storage, share: null, clipboard: null });
    await app.ready;
    $<HTMLButtonElement>('share-button').click();
    await flush();
    expect($('status').textContent).toMatch(/^Plan ready/);
  });
});
