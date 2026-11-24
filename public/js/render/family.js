// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** @typedef {import('../../../src/domain/brief.js').AirBrief} Brief */

/** @param {string} who */
const memberIcon = (who) => {
  if (who.startsWith('Children')) return 'child';
  if (who.startsWith('Older')) return 'senior';
  if (who.startsWith('Family member')) return 'heart';
  return 'adult';
};

/**
 * Local anti-smog rules (Delhi-NCR GRAP) and what they mean for this family.
 * @param {Brief} brief
 */
export function renderPolicy(brief) {
  const { policy } = brief;
  if (!policy) return null;
  return el(
    'div',
    { className: 'policy' },
    el('h3', {}, icon('alert'), ` Local smog rules: GRAP ${policy.stageLabel}`),
    el('p', { className: 'policy-for-you', text: 'What this means for your family:' }),
    el(
      'ul',
      {},
      policy.forYou.map((line) => el('li', { text: line })),
    ),
    el(
      'details',
      {},
      el('summary', { text: 'All city-wide measures at this stage' }),
      el(
        'ul',
        {},
        policy.measures.map((line) => el('li', { text: line })),
      ),
    ),
    el('p', { className: 'hint', text: policy.note }),
  );
}

/**
 * Family verdict, the reasons behind it, per-member advice and local rules.
 * @param {Brief} brief
 */
export function renderFamily(brief) {
  const { risk } = brief;
  return [
    el(
      'div',
      { className: `verdict verdict-${risk.verdict}` },
      el('p', { className: 'verdict-headline', text: risk.headline }),
      el(
        'details',
        {},
        el('summary', { text: 'Why this advice?' }),
        el(
          'ul',
          {},
          risk.reasons.map((r) => el('li', { text: r })),
        ),
      ),
    ),
    el(
      'ul',
      { className: 'member-advice' },
      risk.memberAdvice.map((m) =>
        el(
          'li',
          {},
          el('span', { className: 'member-icon' }, icon(memberIcon(m.who))),
          el('p', {}, el('strong', { text: `${m.who}: ` }), m.advice),
        ),
      ),
    ),
    renderPolicy(brief),
  ];
}
