// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/**
 * A figure tile: icon, big value, short label (used on "Now" and "Impact").
 * @param {string} name  icon name
 * @param {string} value
 * @param {string} label
 */
export const stat = (name, value, label) =>
  el(
    'div',
    { className: 'stat' },
    icon(name),
    el('span', { className: 'stat-value', text: value }),
    el('span', { className: 'stat-label', text: label }),
  );
