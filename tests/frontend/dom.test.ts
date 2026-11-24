// @vitest-environment jsdom
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChat, messageNode } from '../../public/js/chat.js';
import { byId, clear, el, replaceChildren } from '../../public/js/dom.js';
import { readProfile, writeProfile } from '../../public/js/profileForm.js';
import {
  dayWord,
  planToText,
  renderBrief,
  renderForecast,
  renderImpact,
} from '../../public/js/render/index.js';
import { DEFAULT_PROFILE } from '../../public/js/storage.js';
import { buildBrief, type AirBrief } from '../../src/domain/brief.js';
import { loadPage } from '../fixtures/browser.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const targets = () => ({
  now: byId('now-body', HTMLDivElement),
  glance: byId('glance-body', HTMLDivElement),
  family: byId('family-body', HTMLDivElement),
  forecast: byId('forecast-body', HTMLDivElement),
  routine: byId('routine-body', HTMLDivElement),
  indoor: byId('indoor-body', HTMLDivElement),
  impact: byId('impact-body', HTMLDivElement),
});

const makeBrief = (overrides: Parameters<typeof makeHousehold>[0] = {}): AirBrief =>
  buildBrief({
    location: DELHI,
    air: makeAir(),
    weather: makeWeather(),
    household: makeHousehold(overrides),
    standard: 'auto',
  });

async function axeViolations() {
  const results = await axe.run(document, {
    // jsdom has no layout engine, so contrast is verified separately (tests/unit/aqi.test.ts).
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

beforeEach(() => loadPage());

describe('safe DOM builder', () => {
  it('assigns text, classes and attributes without parsing markup', () => {
    const node = el(
      'p',
      {
        className: 'x',
        text: '<b>bold</b>',
        'aria-label': 'label',
        hidden: true,
        skipped: undefined,
      },
      ' tail',
      3,
      null,
      false,
    );
    expect(node.textContent).toBe('<b>bold</b> tail3');
    expect(node.querySelector('b')).toBeNull();
    expect(node.className).toBe('x');
    expect(node.hasAttribute('hidden')).toBe(true);
    expect(node.hasAttribute('skipped')).toBe(false);
  });

  it('clears and replaces children, and fails loudly on missing elements', () => {
    const box = el('div', {}, el('span'), el('span'));
    replaceChildren(box, 'new');
    expect(box.textContent).toBe('new');
    clear(box);
    expect(box.childNodes).toHaveLength(0);
    expect(() => byId('does-not-exist', HTMLDivElement)).toThrow('Missing #does-not-exist');
  });
});

describe('rendering a real brief', () => {
  it('fills every section from server data', () => {
    renderBrief(makeBrief({ communityHouseholds: 25 }), targets());
    expect(document.querySelector('.aqi-value')?.textContent).toBe('108');
    expect(document.querySelector('.gauge')?.getAttribute('aria-label')).toBe(
      'AQI gauge: 108, Moderate',
    );
    expect(document.querySelectorAll('.gauge-band')).toHaveLength(6);
    expect(document.querySelector('.stat-value')?.textContent).toMatch(/^≈ \d/);
    expect(document.querySelectorAll('.glance-tile')).toHaveLength(5);
    expect(document.querySelectorAll('.chart-bar')).toHaveLength(24);
    expect(document.querySelector('.band-best')).not.toBeNull();
    expect(document.querySelector('#chart-desc')?.textContent).toMatch(/^Lowest AQI \d+/);
    expect(document.querySelectorAll('.timeline li').length).toBeGreaterThan(4);
    expect(document.querySelectorAll('.step-icon use').length).toBeGreaterThan(4);
    expect(document.querySelectorAll('.viz li')).toHaveLength(4);
    expect(document.querySelectorAll('.hack').length).toBeGreaterThan(3);
    expect(document.querySelector('.commute caption')?.textContent).toMatch(/commute/);
    expect(document.querySelector('.figures')?.textContent).toMatch(/All 25 households/);
    expect(document.querySelectorAll('[data-pledge]').length).toBe(
      document.querySelectorAll('.action').length,
    );
    expect(document.querySelector('#community-range')?.getAttribute('value')).toBe('25');
    expect(
      document.querySelector('[aria-label="Hourly air quality values"] li')?.textContent,
    ).toMatch(/^06:00: AQI \d+/);
  });

  it('renders hostile text as inert text (XSS)', () => {
    const brief = makeBrief();
    brief.location = { ...brief.location, name: '<img src=x onerror="alert(1)">' };
    brief.risk = { ...brief.risk, headline: '<script>alert(2)</script>' };
    renderBrief(brief, targets());
    expect(document.querySelector('#now-body img')).toBeNull();
    expect(document.querySelector('#family-body script')).toBeNull();
    expect(byId('now-body', HTMLDivElement).textContent).toContain(
      '<img src=x onerror="alert(1)">',
    );
  });

  it('handles households without a commute and unknown weather', () => {
    const brief = makeBrief({ lifestyle: { ...makeHousehold().lifestyle, commuteMode: 'none' } });
    const impact = el('div', {}, renderImpact(brief));
    expect(impact.querySelector('.commute')).toBeNull();
    expect(impact.textContent).toMatch(/Households acting together/);
    const noWeather = buildBrief({
      location: DELHI,
      air: makeAir(),
      weather: null,
      household: makeHousehold(),
      standard: 'us',
    });
    const forecast = el('div', {}, renderForecast(noWeather));
    expect(forecast.textContent).toMatch(/Smog-trap risk: Unknown/);
  });

  it('marks next-day windows as tomorrow', () => {
    expect(dayWord('2026-11-25T07:00', '2026-11-24T21:00')).toBe(' tomorrow');
    expect(dayWord('2026-11-24T22:00', '2026-11-24T21:00')).toBe('');
  });

  it('produces a shareable plain-text plan', () => {
    const text = planToText(makeBrief());
    expect(text.split('\n')[0]).toBe('AirWise plan for Delhi');
    expect(text).toMatch(/• Bedtime: /);
  });
});

describe('profile form', () => {
  const form = () => byId('profile-form', HTMLFormElement);

  it('round-trips a profile through the form', () => {
    const profile = structuredClone(DEFAULT_PROFILE);
    profile.household.conditions = ['asthma', 'pregnancy'];
    profile.household.home = { roomAreaSqm: 15, hasAirPurifier: true, purifierCadrM3h: 250 };
    profile.standard = 'us';
    writeProfile(form(), profile);
    expect(readProfile(form())).toEqual(profile);
  });

  it('ignores the CADR when there is no purifier', () => {
    const profile = structuredClone(DEFAULT_PROFILE);
    profile.household.home.purifierCadrM3h = 400;
    writeProfile(form(), profile);
    expect(readProfile(form()).household.home.purifierCadrM3h).toBe(0);
  });

  it('explains invalid input in plain language', () => {
    writeProfile(form(), DEFAULT_PROFILE);
    const input = (name: string) => form().elements.namedItem(name) as HTMLInputElement;
    input('adults').value = '0';
    input('children').value = '0';
    input('seniors').value = '0';
    expect(() => readProfile(form())).toThrow('Add at least one person to your household.');
    input('adults').value = '';
    expect(() => readProfile(form())).toThrow('Adults must be between 0 and 20.');
  });
});

describe('chat', () => {
  const setup = (
    send = vi.fn(async () => ({
      reply: 'Hello\n- tip one',
      source: 'gemini',
      suggestions: ['Next?'],
    })),
    canSend = () => true,
  ) => {
    const onBlocked = vi.fn();
    const chat = createChat({
      log: byId('chat-log', HTMLDivElement),
      form: byId('chat-form', HTMLFormElement),
      input: byId('chat-input', HTMLTextAreaElement),
      suggestions: byId('chat-suggestions', HTMLDivElement),
      send,
      canSend,
      onBlocked,
    });
    return { chat, send, onBlocked };
  };

  it('sends a question and renders the answer as accessible text', async () => {
    const { chat, send } = setup();
    await chat.ask('  Can we go out?  ');
    expect(send).toHaveBeenCalledWith('Can we go out?', []);
    const log = byId('chat-log', HTMLDivElement);
    expect(log.querySelectorAll('.msg-user, .msg-assistant')).toHaveLength(2);
    expect(log.querySelector('.msg-assistant li')?.textContent).toBe('tip one');
    expect(log.querySelector('.msg-source')?.textContent).toMatch(/Gemini/);
    expect(log.getAttribute('aria-busy')).toBe('false');
    expect(chat.history).toHaveLength(2);
    expect(byId('chat-suggestions', HTMLDivElement).textContent).toBe('Next?');
  });

  it('supports suggestion chips, the form and the Enter key', async () => {
    const { chat, send } = setup();
    chat.showSuggestions(['Chip question']);
    byId('chat-suggestions', HTMLDivElement).querySelector('button')?.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const input = byId('chat-input', HTMLTextAreaElement);
    input.value = 'Typed question';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    input.value = 'Submitted';
    byId('chat-form', HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    input.value = 'new line';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('blocks sending until a place is chosen and ignores empty input', async () => {
    const { chat, send, onBlocked } = setup(undefined, () => false);
    await chat.ask('   ');
    await chat.ask('hello');
    expect(onBlocked).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('shows errors in the conversation', async () => {
    const { chat } = setup(vi.fn(async () => Promise.reject(new Error('Too many requests.'))));
    await chat.ask('hi');
    expect(byId('chat-log', HTMLDivElement).textContent).toContain('Too many requests.');
    const { chat: other } = setup(vi.fn(async () => Promise.reject('weird')));
    await other.ask('hi');
    expect(byId('chat-log', HTMLDivElement).textContent).toContain('Sorry, something went wrong.');
  });

  it('labels speakers for screen readers', () => {
    expect(
      messageNode({ role: 'user', content: 'x' }).querySelector('.visually-hidden')?.textContent,
    ).toBe('You said:');
  });
});

describe('accessibility (axe-core)', () => {
  it('the empty page has no detectable violations', async () => {
    expect(await axeViolations()).toEqual([]);
  });

  it('the fully rendered plan and chat have no detectable violations', async () => {
    renderBrief(makeBrief({ conditions: ['asthma'], communityHouseholds: 10 }), targets());
    byId('results', HTMLDivElement).hidden = false;
    byId('chat-log', HTMLDivElement).append(
      messageNode({ role: 'user', content: 'Can we go out?' }),
      messageNode({ role: 'assistant', content: 'Yes:\n- at 14:00' }, 'rules'),
    );
    expect(await axeViolations()).toEqual([]);
  });

  it('self-test: the audit really detects violations', async () => {
    document.body.append(el('img', { src: 'x.png' }));
    expect((await axeViolations()).some((v) => v.startsWith('image-alt'))).toBe(true);
  });

  it('declares the page language and a skip link', () => {
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
  });
});

describe('edge cases in rendering and chat', () => {
  it('detects Hindi replies so screen readers switch voice', async () => {
    const { detectLanguage } = await import('../../public/js/format.js');
    expect(detectLanguage('खिड़कियाँ केवल 16:00 से 18:00 के बीच खोलें')).toBe('hi');
    expect(detectLanguage('Open windows 16:00–18:00 (खिड़की)')).toBe('en');
    expect(detectLanguage('123 — !!')).toBe('en');
    expect(
      messageNode({ role: 'assistant', content: 'नमस्ते, हवा खराब है' }).getAttribute('lang'),
    ).toBe('hi');
  });

  it('renders missing trend, sub-index and windows gracefully', async () => {
    const { renderNow } = await import('../../public/js/render/now.js');
    const brief = makeBrief();
    const sparse: AirBrief = {
      ...brief,
      forecast: {
        ...brief.forecast,
        trend: null,
        windows: { outdoor: null, ventilation: null, play: null, worst: null },
      },
      current: {
        ...brief.current,
        pollutants: [
          { id: 'co', label: 'Carbon monoxide (CO)', concentration: 500, subIndex: null },
        ],
      },
    };
    const now = el('div', {}, renderNow(sparse));
    expect(now.querySelector('.trend')).toBeNull();
    expect(now.querySelector('.meter-value')?.getAttribute('aria-label')).toMatch(
      /sub-index not available/,
    );
    const forecast = el('div', {}, renderForecast(sparse));
    expect(forecast.querySelector('.windows')?.textContent).toMatch(/none clean enough/);
  });

  it('ignores a second question while one is in flight and handles odd answers', async () => {
    let release: (value: { reply: string; source: string; suggestions?: string[] }) => void = () =>
      undefined;
    const send = vi.fn(
      () =>
        new Promise<{ reply: string; source: string; suggestions?: string[] }>((resolve) => {
          release = resolve;
        }),
    );
    const chat = createChat({
      log: byId('chat-log', HTMLDivElement),
      form: byId('chat-form', HTMLFormElement),
      input: byId('chat-input', HTMLTextAreaElement),
      suggestions: byId('chat-suggestions', HTMLDivElement),
      send: send as never,
      canSend: () => true,
      onBlocked: () => undefined,
    });
    const first = chat.ask('one');
    await chat.ask('two');
    expect(send).toHaveBeenCalledTimes(1);
    release({ reply: 'ok', source: 'mystery-engine' });
    await first;
    expect(byId('chat-log', HTMLDivElement).querySelector('.msg-source')?.textContent).toBe('');
    expect(byId('chat-suggestions', HTMLDivElement).children).toHaveLength(0);
  });
});
