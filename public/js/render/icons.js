// @ts-check
import { svg } from '../dom.js';

/**
 * Decorative icon from the sprite in index.html. Always aria-hidden: every
 * icon sits next to visible text that carries the meaning.
 * @param {string} name sprite id without the `i-` prefix
 * @param {string} [className]
 */
export function icon(name, className = 'icon') {
  return svg(
    'svg',
    { class: className, 'aria-hidden': 'true', focusable: 'false' },
    svg('use', { href: `#i-${name}` }),
  );
}

/** Icons for routine steps, glance tiles and family members. */
export const STEP_ICONS = /** @type {Readonly<Record<string, string>>} */ ({
  exercise: 'run',
  commute: 'train',
  ventilate: 'window',
  play: 'child',
  evening: 'home',
  cooking: 'cook',
  bedtime: 'bed',
  mask: 'mask',
  windows: 'window',
  kids: 'child',
});
