// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../../public/js/app.js';
import { pledgeTotals, scaleCommunity } from '../../public/js/community.js';
import { loadPledges } from '../../public/js/controllers/impact.js';
import { setupVoice } from '../../public/js/controllers/voice.js';
import { readProfile, summariseHousehold } from '../../public/js/profileForm.js';
import { DEFAULT_PROFILE } from '../../public/js/storage.js';
import { buildBrief } from '../../src/domain/brief.js';
import { MemoryStorage, loadPage } from '../fixtures/browser.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const brief = buildBrief({
  location: DELHI,
  air: makeAir(),
  weather: makeWeather(),
  household: makeHousehold({ communityHouseholds: 10 }),
  standard: 'auto',
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function bootWithPlan(storage = new MemoryStorage()) {
  storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
  const api = {
    searchPlaces: vi.fn(async () => [DELHI]),
    fetchBrief: vi.fn(async () => brief),
    sendChat: vi.fn(async () => ({ reply: 'ok', source: 'rules', suggestions: [] })),
    fetchHealth: vi.fn(async () => ({ assistant: 'rules' })),
  };
  const app = startApp({
    storage,
    api,
    geolocation: null,
    speech: null,
    share: null,
    clipboard: null,
    Recognition: null,
  });
  return { app, api, storage };
}

beforeEach(() => loadPage());
afterEach(() => vi.unstubAllGlobals());

describe('community maths', () => {
  it('rescales totals, trees and every action to a new community size', () => {
    const scaled = scaleCommunity(brief, 100);
    expect(scaled.community.households).toBe(100);
    expect(scaled.communityHouseholds).toBe(100);
    expect(scaled.community.total.co2KgPerYear).toBe(
      Math.round(brief.community.perHousehold.co2KgPerYear * 100),
    );
    expect(scaled.community.treesEquivalent).toBe(
      Math.round(scaled.community.total.co2KgPerYear / 21),
    );
    const action = scaled.actions[0];
    expect(action?.community.co2KgPerYear).toBe(
      action?.perHousehold.co2KgPerYear === null
        ? null
        : Math.round((action?.perHousehold.co2KgPerYear ?? 0) * 100),
    );
    expect(scaleCommunity(brief, 0).community.households).toBe(1);
    expect(scaleCommunity(brief, 1e9).community.households).toBe(10_000);
  });

  it('totals pledged actions only', () => {
    const ids = new Set([brief.actions[0]?.id ?? '', 'not-an-action']);
    const totals = pledgeTotals(brief.actions, ids);
    expect(totals.count).toBe(1);
    expect(totals.co2KgPerYear).toBe(Math.round(brief.actions[0]?.perHousehold.co2KgPerYear ?? 0));
    expect(pledgeTotals(brief.actions, new Set())).toEqual({
      count: 0,
      co2KgPerYear: 0,
      pm25GPerYear: 0,
      trees: 0,
    });
  });

  it('loads pledges defensively from storage', () => {
    const storage = new MemoryStorage();
    expect(loadPledges(storage).size).toBe(0);
    storage.setItem('airwise.pledges.v1', '{broken');
    expect(loadPledges(storage).size).toBe(0);
    storage.setItem('airwise.pledges.v1', JSON.stringify(['a', 3, 'b']));
    expect([...loadPledges(storage)]).toEqual(['a', 'b']);
    storage.setItem('airwise.pledges.v1', JSON.stringify({ not: 'a list' }));
    expect(loadPledges(storage).size).toBe(0);
  });
});

describe('household summary', () => {
  it('describes the family in short pills', () => {
    const h = structuredClone(DEFAULT_PROFILE).household;
    h.conditions = ['asthma'];
    h.home.hasAirPurifier = true;
    h.communityHouseholds = 50;
    expect(summariseHousehold(h)).toEqual([
      '2 adults',
      '1 child',
      '1 older adult',
      'Asthma',
      'Scooter / bike · 10 km',
      'Has purifier',
      '50 households together',
    ]);
    h.members = { adults: 1, children: 2, seniors: 0 };
    h.lifestyle.commuteMode = 'none';
    expect(summariseHousehold(h).slice(0, 4)).toEqual([
      '1 adult',
      '2 children',
      'Asthma',
      'No commute',
    ]);
  });
});

describe('family editor', () => {
  it('starts collapsed with a sample-family hint, and the toggle opens it', async () => {
    const { app } = bootWithPlan();
    await app.ready;
    expect($('profile-panel').hidden).toBe(true);
    expect($('edit-family').getAttribute('aria-expanded')).toBe('false');
    expect($('family-hint').textContent).toMatch(/sample family/);
    expect($('family-summary').children.length).toBeGreaterThan(3);
    $<HTMLButtonElement>('edit-family').click();
    expect($('profile-panel').hidden).toBe(false);
    expect($('edit-family').textContent).toBe('Hide family details');
  });

  it('steppers move within the field limits', () => {
    bootWithPlan();
    const adults = $<HTMLInputElement>('adults-input');
    const more = document.querySelector<HTMLButtonElement>('[data-target="adults"][data-step="1"]');
    const fewer = document.querySelector<HTMLButtonElement>(
      '[data-target="adults"][data-step="-1"]',
    );
    adults.value = '19';
    more?.click();
    more?.click();
    expect(adults.value).toBe('20');
    adults.value = '1';
    fewer?.click();
    fewer?.click();
    expect(adults.value).toBe('0');
    document
      .querySelector<HTMLElement>('.stepper .icon')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(adults.value).toBe('0');
  });

  it('requires a commute, cooking and heating choice', () => {
    bootWithPlan();
    const form = $<HTMLFormElement>('profile-form');
    form.querySelectorAll<HTMLInputElement>('input[name="cookingFuel"]').forEach((r) => {
      r.checked = false;
    });
    expect(() => readProfile(form)).toThrow('Choose your cooking fuel.');
    form.requestSubmit();
    expect($('profile-panel').hidden).toBe(false);
    expect(document.activeElement?.getAttribute('name')).toBe('cookingFuel');
  });

  it('confirms a saved family', async () => {
    const { app, api } = bootWithPlan();
    await app.ready;
    $<HTMLFormElement>('profile-form').requestSubmit();
    expect($('family-hint').textContent).toMatch(/Saved in this browser/);
    expect($('profile-panel').hidden).toBe(true);
    await vi.waitFor(() => expect(api.fetchBrief).toHaveBeenCalledTimes(2));
  });
});

describe('popular cities and theming', () => {
  it('loads a city in one tap and tints the page by AQI level', async () => {
    const { app, api } = bootWithPlan(new MemoryStorage());
    await app.ready;
    document.querySelector<HTMLButtonElement>('.chip-city[data-city="Mumbai"]')?.click();
    await vi.waitFor(() =>
      expect(api.fetchBrief).toHaveBeenLastCalledWith(
        expect.objectContaining({
          location: expect.objectContaining({ name: 'Mumbai', countryCode: 'IN' }),
        }),
      ),
    );
    expect(document.body.dataset.aqiLevel).toBe(String(brief.current.category.level));
  });
});

describe('impact controls', () => {
  it('moves the community slider without losing it, and persists the size', async () => {
    const { app, storage } = bootWithPlan();
    await app.ready;
    const range = $<HTMLInputElement>('community-range');
    range.focus();
    range.value = '200';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect($('community-range')).toBe(range);
    expect(document.activeElement).toBe(range);
    expect(document.querySelector('.slider-value')?.textContent).toBe('200');
    expect(document.querySelector('.community-figure')?.textContent).toMatch(/all 200 households/);
    expect(document.querySelector('.figures')?.textContent).toMatch(/All 200 households/);
    range.dispatchEvent(new Event('change', { bubbles: true }));
    expect(
      JSON.parse(storage.getItem('airwise.profile.v1') ?? '{}').household.communityHouseholds,
    ).toBe(200);
    expect($('family-summary').textContent).toMatch(/200 households together/);
  });

  it('toggles pledges, keeps focus and remembers them', async () => {
    const storage = new MemoryStorage();
    const { app } = bootWithPlan(storage);
    await app.ready;
    const first = document.querySelector<HTMLButtonElement>('[data-pledge]');
    const id = first?.dataset.pledge ?? '';
    first?.click();
    const pressed = document.querySelector<HTMLButtonElement>(`[data-pledge="${id}"]`);
    expect(pressed?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(pressed);
    expect($('pledge-summary').textContent).toMatch(/Your 1 pledge:/);
    expect(JSON.parse(storage.getItem('airwise.pledges.v1') ?? '[]')).toEqual([id]);
    pressed?.click();
    expect($('pledge-summary').textContent).toMatch(/Tap “I’ll do this”/);
  });

  it('ignores unrelated input and clicks', async () => {
    const { app } = bootWithPlan();
    await app.ready;
    const container = $('impact-body');
    const stray = document.createElement('input');
    container.append(stray);
    stray.dispatchEvent(new Event('input', { bubbles: true }));
    stray.dispatchEvent(new Event('change', { bubbles: true }));
    container.querySelector('h3')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect($('pledge-summary').textContent).toMatch(/Tap/);
  });
});

describe('voice input', () => {
  class FakeRecogniser {
    static last: FakeRecogniser | null = null;
    lang = '';
    interimResults = true;
    maxAlternatives = 5;
    onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn(() => this.onend?.());
    constructor() {
      FakeRecogniser.last = this;
    }
  }

  it('stays hidden without browser support', () => {
    const button = $<HTMLButtonElement>('voice-button');
    expect(
      setupVoice({
        button,
        input: $('chat-input'),
        onTranscript: vi.fn(),
        setStatus: vi.fn(),
        Recognition: null,
      }),
    ).toBeNull();
    expect(button.hidden).toBe(true);
  });

  it('turns speech into a question and handles stop and errors', () => {
    const onTranscript = vi.fn();
    const setStatus = vi.fn();
    const button = $<HTMLButtonElement>('voice-button');
    const input = $<HTMLTextAreaElement>('chat-input');
    setupVoice({ button, input, onTranscript, setStatus, Recognition: FakeRecogniser as never });
    const rec = FakeRecogniser.last as FakeRecogniser;
    expect(button.hidden).toBe(false);
    expect(rec.lang).toBe('en-IN');
    button.click();
    expect(rec.start).toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    rec.onresult?.({ results: [[{ transcript: '  kya aaj bahar khel sakte hain  ' }]] });
    expect(input.value).toBe('kya aaj bahar khel sakte hain');
    expect(onTranscript).toHaveBeenCalledWith('kya aaj bahar khel sakte hain');
    rec.onresult?.({ results: [[{ transcript: '   ' }]] });
    expect(onTranscript).toHaveBeenCalledTimes(1);
    button.click();
    expect(rec.stop).toHaveBeenCalled();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    rec.onerror?.();
    expect(setStatus).toHaveBeenLastCalledWith(expect.stringMatching(/Could not hear/), 'error');
  });

  it('sends a spoken question through the chat', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const sendChat = vi.fn(async () => ({ reply: 'Yes', source: 'rules', suggestions: [] }));
    const app = startApp({
      storage,
      api: {
        searchPlaces: vi.fn(),
        fetchBrief: vi.fn(async () => brief),
        sendChat,
        fetchHealth: vi.fn(async () => ({})),
      },
      geolocation: null,
      speech: null,
      share: null,
      clipboard: null,
      Recognition: FakeRecogniser as never,
    });
    await app.ready;
    FakeRecogniser.last?.onresult?.({ results: [[{ transcript: 'Can we go out?' }]] });
    await vi.waitFor(() =>
      expect(sendChat).toHaveBeenCalledWith(expect.objectContaining({ message: 'Can we go out?' })),
    );
  });
});
