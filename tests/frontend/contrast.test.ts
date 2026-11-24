import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * jsdom cannot compute colour contrast, so this test reads the theme tokens
 * straight from styles.css and checks every text/background pair the UI uses
 * against WCAG 2.2 (4.5:1 for text, 3:1 for non-text UI such as chart edges
 * and focus rings) in BOTH light and dark themes.
 */
const css = readFileSync(path.resolve(process.cwd(), 'public/css/styles.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name as string] = value as string;
  }
  return out;
}

const light = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('}\n}', darkStart))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['muted', 'surface'],
  ['muted', 'bg'],
  ['brand', 'surface'],
  ['accent', 'surface'],
  ['accent', 'bg'],
  ['brand-contrast', 'brand'],
  ['text', 'ok-bg'],
  ['text', 'warn-bg'],
  ['text', 'bad-bg'],
  ['text', 'severe-bg'],
  ['muted', 'warn-bg'],
  ['muted', 'bad-bg'],
];

const NON_TEXT_PAIRS: [string, string][] = [
  ['focus', 'surface'],
  ['focus', 'bg'],
  ['text', 'surface'], // chart-bar edges
  ['brand', 'surface'], // timeline and borders
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, theme) => {
  it('defines every token the checks rely on', () => {
    for (const [fg, bg] of [...TEXT_PAIRS, ...NON_TEXT_PAIRS]) {
      expect(theme[fg], fg).toMatch(/^#/);
      expect(theme[bg], bg).toMatch(/^#/);
    }
  });

  it.each(TEXT_PAIRS)('text "%s" on "%s" meets 4.5:1', (fg, bg) => {
    expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('UI element "%s" on "%s" meets 3:1', (fg, bg) => {
    expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(3);
  });
});

describe('stylesheet accessibility features', () => {
  it('supports reduced motion, high contrast and forced colours', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-contrast: more)');
    expect(css).toContain('@media (forced-colors: active)');
  });

  it('keeps touch targets at least 44 px (2.75rem) and focus always visible', () => {
    expect(css).toMatch(/button \{[^}]*min-height: 2\.75rem/);
    expect(css).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--focus\)/);
  });

  it('outlines chart bars for non-text contrast', () => {
    expect(css).toMatch(/\.chart-bar \{\s*stroke: var\(--text\);/);
  });

  it('keeps white hero text readable on every AQI-tinted hero gradient', () => {
    const stops = [...css.matchAll(/--hero-[ab]: (#[0-9a-fA-F]{6})/g)].map((m) => m[1] as string);
    expect(stops.length).toBeGreaterThanOrEqual(14);
    for (const stop of stops) expect(ratio('#ffffff', stop), stop).toBeGreaterThanOrEqual(4.5);
  });
});
