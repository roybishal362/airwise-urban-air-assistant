// @ts-check
import { TREE_CO2_KG, pledgeTotals } from '../community.js';
import { el } from '../dom.js';
import { formatCo2, formatMass, formatNumber, signedPct } from '../format.js';
import { icon } from './icons.js';
import { stat } from './stat.js';

/**
 * Whether another commute mode suits today's air (the current mode needs no verdict).
 * @param {{ current: boolean, suitableToday: boolean }} row
 */
function suitability(row) {
  if (row.current) return '—';
  return row.suitableToday ? 'Yes' : 'Better on cleaner days';
}

/** @param {number} count */
const pledgeCount = (count) => (count === 1 ? '1 pledge' : `${count} pledges`);

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {import('../../../src/domain/impact/index.js').ModeImpact} ModeImpact
 * @typedef {import('../../../src/domain/impact/index.js').CommuteComparison} CommuteComparison
 */

/**
 * The slider for "households acting together" (updated in place while it moves).
 * @param {number} households
 */
function communitySlider(households) {
  const range = el('input', {
    type: 'range',
    id: 'community-range',
    min: 1,
    max: Math.max(1000, households),
    step: 1,
    value: households,
    'aria-describedby': 'community-range-help',
  });
  return el(
    'div',
    { className: 'slider-row' },
    el(
      'label',
      { for: 'community-range' },
      'Households acting together: ',
      el('output', {
        className: 'slider-value',
        for: 'community-range',
        text: formatNumber(households),
      }),
    ),
    range,
    el('p', {
      id: 'community-range-help',
      className: 'hint',
      text: 'Drag to see what your street, society or school could achieve together.',
    }),
  );
}

/**
 * What the plan avoids, for one household or for everyone acting together.
 * @param {{ co2KgPerYear: number, pm25GPerYear: number }} figures @param {number} households
 */
function communitySentence(figures, households) {
  const avoided = `${formatCo2(figures.co2KgPerYear)} and ${formatMass(figures.pm25GPerYear)} of PM2.5 avoided a year`;
  return households > 1
    ? `${avoided} if all ${formatNumber(households)} households adopt this plan. Overlapping transport options are counted once.`
    : `${avoided} if your household adopts this plan.`;
}

/**
 * Headline: what the whole plan avoids per year, with a live community slider.
 * @param {Brief} brief
 */
export function renderCommunityHeadline(brief) {
  const c = brief.community;
  const together = c.households > 1;
  const figures = together ? c.total : c.perHousehold;
  const trees = together
    ? c.treesEquivalent
    : Math.round(c.perHousehold.co2KgPerYear / TREE_CO2_KG);
  return el(
    'div',
    { className: 'community-headline' },
    el(
      'div',
      { className: 'impact-stats' },
      stat('leaf', formatCo2(figures.co2KgPerYear), 'CO₂ avoided a year'),
      stat('wind', formatMass(figures.pm25GPerYear), 'PM2.5 kept out of the air a year'),
      stat('tree', formatNumber(trees), 'trees’ worth of CO₂ uptake'),
    ),
    el('p', { className: 'community-figure', text: communitySentence(figures, c.households) }),
    communitySlider(c.households),
  );
}

/** Column headings of the commute table. */
const COMMUTE_COLUMNS = [
  'Option',
  'Minutes a day',
  'CO₂ a week',
  'PM2.5 you inhale a day',
  'Safe choice today?',
];

/**
 * One commute option as a table row; the current mode is marked "(now)".
 * @param {ModeImpact & { current: boolean, inhaledChangePct: number, suitableToday: boolean }} r
 */
function commuteRow(r) {
  return el(
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
    el('td', { text: suitability(r) }),
  );
}

/**
 * Commute comparison on CO₂, time and the PM2.5 you breathe.
 * @param {CommuteComparison} commute
 */
function commuteTable(commute) {
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
        COMMUTE_COLUMNS.map((t) => el('th', { scope: 'col', text: t })),
      ),
    ),
    el('tbody', {}, rows.map(commuteRow)),
  );
}

/**
 * Running total of the actions this household has pledged.
 * @param {Brief} brief
 * @param {ReadonlySet<string>} pledged
 */
export function renderPledgeSummary(brief, pledged) {
  const totals = pledgeTotals(brief.actions, pledged);
  return el(
    'p',
    { className: 'pledge-summary', id: 'pledge-summary', role: 'status' },
    totals.count === 0
      ? 'Tap “I’ll do this” on any action below to build your family’s pledge.'
      : `Your ${pledgeCount(totals.count)}: ${formatCo2(totals.co2KgPerYear)} and ${formatMass(totals.pm25GPerYear)} of PM2.5 avoided a year (≈ ${formatNumber(totals.trees)} trees).`,
  );
}

/**
 * An action's yearly figures (CO₂, PM2.5, NOx), leaving out the ones that do not apply.
 * @param {Brief['actions'][number]['perHousehold']} q
 */
function actionFigures(q) {
  return [
    q.co2KgPerYear !== null ? `${formatCo2(q.co2KgPerYear)} / year` : null,
    q.pm25GPerYear !== null ? `${formatMass(q.pm25GPerYear)} PM2.5 / year` : null,
    q.noxGPerYear !== null && q.noxGPerYear > 0 ? `${formatMass(q.noxGPerYear)} NOx / year` : null,
  ].filter(Boolean);
}

/**
 * The "I'll do this" toggle; `aria-pressed` tells screen readers whether it is pledged.
 * @param {string} id @param {boolean} on
 */
function pledgeButton(id, on) {
  return el(
    'button',
    {
      type: 'button',
      className: 'btn-ghost pledge',
      'data-pledge': id,
      'aria-pressed': String(on),
    },
    icon(on ? 'check' : 'leaf'),
    on ? 'Pledged' : 'I’ll do this',
  );
}

/**
 * One quantified action with its impact, figures and pledge button.
 * @param {Brief['actions'][number]} a
 * @param {{ households: number, pledged: ReadonlySet<string> }} context
 */
function actionItem(a, { households, pledged }) {
  const community = households > 1;
  const figures = actionFigures(community ? a.community : a.perHousehold);
  const who = community ? `All ${formatNumber(households)} households: ` : 'Your household: ';
  return el(
    'li',
    { className: `action cat-${a.category}` },
    el('h3', { text: a.title }),
    el('p', { text: a.detail }),
    el('p', { className: 'why' }, el('strong', { text: 'Impact: ' }), a.impactStatement),
    figures.length
      ? el('p', { className: 'figures' }, el('strong', { text: who }), figures.join(' · '))
      : null,
    pledgeButton(a.id, pledged.has(a.id)),
  );
}

/**
 * Community headline, commute comparison, quantified actions and pledges.
 * @param {Brief} brief
 * @param {ReadonlySet<string>} [pledged]
 */
export function renderImpact(brief, pledged = new Set()) {
  const { commute, actions, communityHouseholds } = brief;
  const context = { households: communityHouseholds, pledged };
  const list = el(
    'ul',
    { className: 'actions' },
    actions.map((a) => actionItem(a, context)),
  );

  return [
    renderCommunityHeadline(brief),
    renderPledgeSummary(brief, pledged),
    commute ? commuteTable(commute) : null,
    list,
  ];
}
