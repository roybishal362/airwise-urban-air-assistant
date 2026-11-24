// @ts-check
import { el } from '../dom.js';
import { formatCo2, formatMass, formatNumber, signedPct } from '../format.js';

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {import('../../../src/domain/impact/index.js').ModeImpact} ModeImpact
 * @typedef {import('../../../src/domain/impact/index.js').CommuteComparison} CommuteComparison
 */

/**
 * Headline: what the whole plan avoids per year, for one home or the community.
 * @param {Brief} brief
 */
export function renderCommunityHeadline(brief) {
  const c = brief.community;
  const together = c.households > 1;
  const figures = together ? c.total : c.perHousehold;
  return el(
    'div',
    { className: 'community-headline' },
    el('p', {
      className: 'community-figure',
      text: `${formatCo2(figures.co2KgPerYear)} and ${formatMass(figures.pm25GPerYear)} of PM2.5 avoided a year`,
    }),
    el('p', {
      text: together
        ? `If all ${formatNumber(c.households)} households adopt this plan: what ~${formatNumber(c.treesEquivalent)} trees absorb in a year. Overlapping transport options are counted once.`
        : 'If your household adopts this plan. Set "Households acting together" to see what your society or street could achieve.',
    }),
  );
}

/**
 * Commute comparison on CO₂, time and the PM2.5 you breathe.
 * @param {CommuteComparison} commute
 */
function commuteTable(commute) {
  /** @type {(ModeImpact & { current: boolean, inhaledChangePct: number, suitableToday: boolean })[]} */
  const rows = [
    { ...commute.current, current: true, inhaledChangePct: 0, suitableToday: true },
    ...commute.alternatives.map((alt) => ({ ...alt, current: false })),
  ];
  return el(
    'table',
    { className: 'compare commute' },
    el('caption', { text: 'Your commute compared (round trip, 5 days a week)' }),
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        [
          'Option',
          'Minutes a day',
          'CO₂ a week',
          'PM2.5 you inhale a day',
          'Safe choice today?',
        ].map((t) => el('th', { scope: 'col', text: t })),
      ),
    ),
    el(
      'tbody',
      {},
      rows.map((r) =>
        el(
          'tr',
          { className: r.current ? 'current' : undefined },
          el('th', { scope: 'row', text: r.current ? `${r.label} (now)` : r.label }),
          el('td', { text: r.minutesPerDay }),
          el('td', { text: `${formatNumber(r.co2KgPerWeek, 1)} kg` }),
          el('td', {
            text: r.current
              ? `${r.inhaledPm25UgPerDay} µg`
              : `${r.inhaledPm25UgPerDay} µg (${signedPct(r.inhaledChangePct)})`,
          }),
          el('td', { text: r.current ? '—' : r.suitableToday ? 'Yes' : 'Better on cleaner days' }),
        ),
      ),
    ),
  );
}

/**
 * Community headline, commute comparison and quantified sustainable actions.
 * @param {Brief} brief
 */
export function renderImpact(brief) {
  const { commute, actions, communityHouseholds } = brief;
  const community = communityHouseholds > 1;
  const list = el(
    'ul',
    { className: 'actions' },
    actions.map((a) => {
      const q = community ? a.community : a.perHousehold;
      const figures = [
        q.co2KgPerYear !== null ? `${formatCo2(q.co2KgPerYear)} / year` : null,
        q.pm25GPerYear !== null ? `${formatMass(q.pm25GPerYear)} PM2.5 / year` : null,
        q.noxGPerYear !== null && q.noxGPerYear > 0
          ? `${formatMass(q.noxGPerYear)} NOx / year`
          : null,
      ].filter(Boolean);
      return el(
        'li',
        { className: `action cat-${a.category}` },
        el('h3', { text: a.title }),
        el('p', { text: a.detail }),
        el('p', { className: 'why' }, el('strong', { text: 'Impact: ' }), a.impactStatement),
        figures.length
          ? el(
              'p',
              { className: 'figures' },
              el('strong', {
                text: community
                  ? `All ${formatNumber(communityHouseholds)} households: `
                  : 'Your household: ',
              }),
              figures.join(' · '),
            )
          : null,
      );
    }),
  );
  return [renderCommunityHeadline(brief), commute ? commuteTable(commute) : null, list];
}
