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
 * One row of the before/after visual: label, proportional bar, value.
 * @param {string} label
 * @param {number} value
 * @param {number} max
 * @param {string} note
 * @param {boolean} clean
 */
function vizRow(label, value, max, note, clean) {
  const fill = el('span');
  fill.style.setProperty('--w', `${Math.max(2, Math.round((value / Math.max(max, 1)) * 100))}%`);
  return el(
    'li',
    { className: clean ? 'viz-clean' : undefined },
    el('span', { text: label }),
    el('span', { className: 'viz-bar', 'aria-hidden': 'true' }, fill),
    el('span', { className: 'viz-value', text: `${value} µg/m³${note}` }),
  );
}

/**
 * Before/after visual from the indoor mass-balance model plus prioritised hacks.
 * @param {Brief} brief
 */
export function renderIndoor(brief) {
  const { indoor } = brief;
  const max = indoor.outdoorPm25;
  const viz = el(
    'ul',
    {
      className: 'viz',
      'aria-label': `Estimated PM2.5 in a ${indoor.roomVolumeM3} m³ room with windows shut`,
    },
    vizRow('Outdoors', indoor.outdoorPm25, max, '', false),
    vizRow('Indoors, no filter', indoor.baselineIndoorPm25, max, '', false),
    indoor.options.map((o) =>
      vizRow(
        `${o.label} (${o.cadrM3h} m³/h)`,
        o.indoorPm25,
        max,
        ` (${signedPct(-o.reductionPct)})`,
        true,
      ),
    ),
  );
  return [
    el('p', {
      className: 'hint',
      text: `Estimated PM2.5 in your ${indoor.roomVolumeM3} m³ room with windows shut`,
    }),
    viz,
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
