// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp } from '../../public/js/app.js';
import { setupTabs } from '../../public/js/controllers/tabs.js';
import { buildBrief } from '../../src/domain/brief.js';
import { MemoryStorage, loadPage } from '../fixtures/browser.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tablist = () => document.querySelector('[role="tablist"]') as HTMLElement;
const selected = () =>
  [...document.querySelectorAll('[role="tab"]')]
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => (t as HTMLElement).dataset.tab);
const visiblePanels = () =>
  [...document.querySelectorAll('[role="tabpanel"]')]
    .filter((p) => !(p as HTMLElement).hidden)
    .map((p) => p.id);
const key = (k: string) =>
  tablist().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

beforeEach(() => {
  loadPage();
  window.history.replaceState(null, '', '/');
});

describe('accessible tabs', () => {
  it('shows exactly one panel and keeps only the active tab focusable', () => {
    setupTabs({ tablist: tablist() });
    expect(selected()).toEqual(['today']);
    expect(visiblePanels()).toEqual(['panel-today']);
    const tabbable = [...document.querySelectorAll('[role="tab"]')].filter(
      (t) => (t as HTMLElement).tabIndex === 0,
    );
    expect(tabbable).toHaveLength(1);
  });

  it('switches by click and records the tab in the URL', () => {
    const onChange = vi.fn();
    setupTabs({ tablist: tablist(), onChange });
    $<HTMLButtonElement>('tab-impact').click();
    expect(visiblePanels()).toEqual(['panel-impact']);
    expect(window.location.hash).toBe('#/impact');
    expect(onChange).toHaveBeenLastCalledWith('impact');
  });

  it('supports arrow, Home and End keys with wrap-around', () => {
    setupTabs({ tablist: tablist() });
    key('ArrowRight');
    expect(selected()).toEqual(['forecast']);
    expect(document.activeElement).toBe($('tab-forecast'));
    key('ArrowLeft');
    key('ArrowLeft');
    expect(selected()).toEqual(['ask']);
    key('Home');
    expect(selected()).toEqual(['today']);
    key('End');
    expect(selected()).toEqual(['ask']);
    key('a');
    expect(selected()).toEqual(['ask']);
  });

  it('opens the tab named in the URL and follows the back button', () => {
    window.history.replaceState(null, '', '/#/routine');
    const tabs = setupTabs({ tablist: tablist() });
    expect(tabs.current()).toBe('routine');
    window.history.replaceState(null, '', '/#/home');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(selected()).toEqual(['home']);
    window.history.replaceState(null, '', '/#/not-a-tab');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(selected()).toEqual(['today']);
  });

  it('lets any data-goto button switch tabs and focus the panel', () => {
    setupTabs({ tablist: tablist() });
    document.querySelector<HTMLButtonElement>('[data-goto="ask"]')?.click();
    expect(selected()).toEqual(['ask']);
    expect(document.activeElement).toBe($('panel-ask'));
    expect(setupTabs({ tablist: tablist() }).select('nope')).toBe('today');
  });

  it('ignores clicks and keys that are not tab actions', () => {
    const onChange = vi.fn();
    setupTabs({ tablist: tablist(), onChange });
    onChange.mockClear();
    tablist().click(); // the bar itself, not a tab
    key('constructor'); // a prototype key must not count as a move
    key('Enter');
    const stray = document.createElement('button');
    stray.dataset.goto = 'not-a-tab';
    document.body.append(stray);
    stray.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(selected()).toEqual(['today']);
  });

  it('brings the new panel into view when the page was scrolled past it, but not on load', () => {
    const scrollIntoView = vi.fn();
    for (const panel of document.querySelectorAll<HTMLElement>('[role="tabpanel"]')) {
      panel.scrollIntoView = scrollIntoView;
      panel.getBoundingClientRect = () => ({ top: -400 }) as DOMRect;
    }
    setupTabs({ tablist: tablist() });
    expect(scrollIntoView).not.toHaveBeenCalled(); // initial selection never scrolls
    $<HTMLButtonElement>('tab-forecast').click();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('tolerates a tab without a panel and an empty tab list', () => {
    document.body.innerHTML = `<div role="tablist"><button role="tab" data-tab="solo">Solo</button></div>`;
    const solo = setupTabs({ tablist: tablist() });
    expect(solo.select('solo', { focus: 'panel' })).toBe('solo');
    document.body.innerHTML = `<div role="tablist"></div>`;
    const empty = setupTabs({ tablist: tablist() });
    expect(empty.current()).toBe('');
    key('ArrowRight');
    expect(empty.current()).toBe('');
  });
});

describe('landing versus app view', () => {
  const brief = buildBrief({
    location: DELHI,
    air: makeAir(),
    weather: makeWeather(),
    household: makeHousehold(),
    standard: 'auto',
  });
  const api = () => ({
    searchPlaces: vi.fn(async () => []),
    fetchBrief: vi.fn(async () => brief),
    sendChat: vi.fn(),
    fetchHealth: vi.fn(async () => ({ assistant: 'rules' })),
  });

  it('shows the landing page until a plan exists', async () => {
    const app = startApp({
      storage: new MemoryStorage(),
      api: api(),
      geolocation: null,
      speech: null,
      share: null,
      clipboard: null,
      Recognition: null,
    });
    await app.ready;
    expect(document.body.dataset.view).toBe('landing');
    expect($('landing').hidden).toBe(false);
    expect($('results').hidden).toBe(true);
  });

  it('switches to the tabbed app with a live location bar, and "Change city" reopens search', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const app = startApp({
      storage,
      api: api(),
      geolocation: null,
      speech: null,
      share: null,
      clipboard: null,
      Recognition: null,
    });
    await app.ready;
    expect(document.body.dataset.view).toBe('app');
    expect($('landing').hidden).toBe(true);
    expect($('how-it-works').hidden).toBe(true);
    expect($('location-aqi').textContent).toBe(
      `NAQI ${brief.current.aqi} · ${brief.current.category.label}`,
    );
    expect($('location-source').textContent).toBe('Model estimate');
    expect(document.querySelector('.source-line')?.textContent).toMatch(/Modelled estimate/);
    $<HTMLButtonElement>('change-city').click();
    expect($('landing').hidden).toBe(false);
    expect($('change-city').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe($('place-input'));
    $<HTMLButtonElement>('change-city').click();
    expect($('landing').hidden).toBe(true);
  });

  it('labels live station data in the location bar', async () => {
    const storage = new MemoryStorage();
    storage.setItem('airwise.place.v1', JSON.stringify(DELHI));
    const measured = {
      ...brief,
      dataSource: {
        ...brief.dataSource,
        kind: 'station' as const,
        label: 'Measured at 06:00 by 1 monitoring station via OpenAQ: X (1.0 km).',
      },
    };
    const app = startApp({
      storage,
      api: { ...api(), fetchBrief: vi.fn(async () => measured) },
      geolocation: null,
      speech: null,
      share: null,
      clipboard: null,
      Recognition: null,
    });
    await app.ready;
    expect($('location-source').textContent).toBe('● Live station data');
    expect(document.querySelector('.source-station')?.textContent).toMatch(/Measured at 06:00/);
  });
});
