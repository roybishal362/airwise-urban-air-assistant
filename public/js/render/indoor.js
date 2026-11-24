// @ts-check
import { el } from '../dom.js';
import { signedPct } from '../format.js';

/** @typedef {import('../../../src/domain/brief.js').AirBrief} Brief */

/** @type {Readonly<Record<1 | 2 | 3, string>>} */
const PRIORITY_LABEL = {
  1: 'Do first',
  2: 'Recommended',
  3: 'Good to know',
};

/**
 * Before/after table from the indoor mass-balance model plus prioritised hacks.
 * @param {Brief} brief
 */
export function renderIndoor(brief) {
  const { indoor } = brief;
  /** @param {string} label @param {number} value @param {string} change */
  const row = (label, value, change) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row', text: label }),
      el('td', { text: value }),
      el('td', { text: change }),
    );
  const comparison = el(
    'table',
    { className: 'compare' },
    el('caption', {
      text: `Estimated PM2.5 in a ${indoor.roomVolumeM3} m³ room with windows shut`,
    }),
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col', text: 'Setup' }),
        el('th', { scope: 'col', text: 'PM2.5 µg/m³' }),
        el('th', { scope: 'col', text: 'Change' }),
      ),
    ),
    el(
      'tbody',
      {},
      row('Outdoors', indoor.outdoorPm25, '—'),
      row('Indoors, no filter', indoor.baselineIndoorPm25, '—'),
      indoor.options.map((o) =>
        row(`${o.label} (${o.cadrM3h} m³/h)`, o.indoorPm25, signedPct(-o.reductionPct)),
      ),
    ),
  );
  return [
    comparison,
    el(
      'ul',
      { className: 'hacks' },
      indoor.hacks.map((h) =>
        el(
          'li',
          { className: `hack p${h.priority}` },
          el('span', { className: 'priority', text: PRIORITY_LABEL[h.priority] }),
          el('h3', { text: h.title }),
          el('p', { text: h.detail }),
          el('p', { className: 'why' }, el('strong', { text: 'Impact: ' }), h.impact),
        ),
      ),
    ),
  ];
}
