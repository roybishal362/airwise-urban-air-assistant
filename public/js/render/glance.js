// @ts-check
import { el } from '../dom.js';
import { STEP_ICONS, icon } from './icons.js';

/** @typedef {import('../../../src/domain/brief.js').AirBrief} Brief */

const TONE_TEXT = /** @type {const} */ ({ good: 'Good', caution: 'Caution', bad: 'Avoid' });

/**
 * Five one-glance decisions; the tone is conveyed by colour AND by text.
 * @param {Brief} brief
 */
export function renderGlance(brief) {
  return el(
    'ul',
    { className: 'glance-grid' },
    brief.glance.map((tile) =>
      el(
        'li',
        { className: `glance-tile tone-${tile.tone}` },
        el('span', { className: 'glance-icon' }, icon(STEP_ICONS[tile.id] ?? 'train')),
        el('span', { className: 'glance-label', text: `${tile.label} · ${TONE_TEXT[tile.tone]}` }),
        el('span', { className: 'glance-value', text: tile.value }),
        el('p', { className: 'glance-detail', text: tile.detail }),
      ),
    ),
  );
}
