// @ts-check

/** Pure formatting helpers (unit-tested in tests/frontend/format.test.ts). */

/**
 * `2026-11-24T16:00` → `16:00`
 * @param {string} time
 */
export function clock(time) {
  return time.slice(11, 16);
}

/**
 * @param {string} start
 * @param {string} end
 */
export function timeRange(start, end) {
  return `${clock(start)}–${clock(end)}`;
}

/**
 * Locale-aware thousands separators (Indian grouping in en-IN).
 * @param {number} value
 * @param {number} [digits]
 */
export function formatNumber(value, digits = 0) {
  return value.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/**
 * Grams → readable mass.
 * @param {number | null} grams
 */
export function formatMass(grams) {
  if (grams === null) return '—';
  if (Math.abs(grams) >= 1_000_000) return `${formatNumber(grams / 1_000_000, 1)} t`;
  if (Math.abs(grams) >= 1000) return `${formatNumber(grams / 1000, 1)} kg`;
  return `${formatNumber(grams)} g`;
}

/**
 * Kilograms of CO₂ → readable mass.
 * @param {number | null} kg
 */
export function formatCo2(kg) {
  if (kg === null) return '—';
  return kg >= 1000 ? `${formatNumber(kg / 1000, 1)} t CO₂` : `${formatNumber(kg)} kg CO₂`;
}

/**
 * Signed percentage, e.g. +12% / −39%.
 * @param {number} pct
 */
export function signedPct(pct) {
  if (pct === 0) return '0%';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

const TRAP_TEXT = /** @type {const} */ ({
  unknown: 'Unknown',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
});

/** @param {keyof typeof TRAP_TEXT} risk */
export function trapRiskLabel(risk) {
  return TRAP_TEXT[risk] ?? 'Unknown';
}

/**
 * BCP 47 language of a reply: 'hi' when it is mostly Devanagari, else 'en'.
 * Tagging Hindi answers lets screen readers switch to a Hindi voice.
 * @param {string} text
 */
export function detectLanguage(text) {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 'en';
  const devanagari = letters.filter((ch) => /\p{Script=Devanagari}/u.test(ch)).length;
  return devanagari / letters.length > 0.3 ? 'hi' : 'en';
}

/**
 * Split an assistant reply into paragraphs and bullet lists, so it can be
 * rendered with real list semantics without parsing any HTML.
 * @param {string} text
 * @returns {({ type: 'p', text: string } | { type: 'ul', items: string[] })[]}
 */
export function textToBlocks(text) {
  /** @type {({ type: 'p', text: string } | { type: 'ul', items: string[] })[]} */
  const blocks = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, '$1');
    if (!line) continue;
    const bullet = /^(?:[-•*]|\d+[.)])\s+(\S.*)$/.exec(line);
    if (bullet) {
      const last = blocks[blocks.length - 1];
      const item = bullet[1] ?? '';
      if (last && last.type === 'ul') last.items.push(item);
      else blocks.push({ type: 'ul', items: [item] });
    } else {
      blocks.push({ type: 'p', text: line });
    }
  }
  return blocks;
}
