// @ts-check
import { el } from '../dom.js';
import { STEP_ICONS, icon } from './icons.js';

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {import('../../../src/domain/routine.js').RoutineTag} RoutineTag
 */

/** @type {Readonly<Record<RoutineTag, string>>} */
const TAG_LABEL = {
  exposure: 'Less exposure',
  emissions: 'Fewer emissions',
  indoor: 'Cleaner indoors',
};

/**
 * Time-ordered routine with an icon per step; every step states its impact.
 * @param {Brief} brief
 */
export function renderRoutine(brief) {
  return [
    el(
      'ol',
      { className: 'timeline' },
      brief.routine.map((step) =>
        el(
          'li',
          {},
          el('span', { className: 'step-icon' }, icon(STEP_ICONS[step.id] ?? 'leaf')),
          el(
            'div',
            {},
            el('p', { className: 'when', text: step.when }),
            el('h3', { text: step.title }),
            el('p', { text: step.detail }),
            el('p', { className: 'why' }, el('strong', { text: 'Impact: ' }), step.why),
            el(
              'p',
              { className: 'tags' },
              step.tags.map((t) => el('span', { className: `tag tag-${t}`, text: TAG_LABEL[t] })),
            ),
          ),
        ),
      ),
    ),
  ];
}
