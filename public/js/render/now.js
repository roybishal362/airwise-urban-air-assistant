// @ts-check
import { el } from '../dom.js';
import { clock, formatNumber } from '../format.js';

/** @typedef {import('../../../src/domain/brief.js').AirBrief} Brief */

/**
 * "Air right now": colour badge (category colours meet WCAG AA with their
 * paired text colour), plain-language meaning and a pollutant table.
 * @param {Brief} brief
 */
export function renderNow(brief) {
  const { current, standard, location, observedAt, forecast } = brief;
  const badge = el(
    'div',
    { className: 'aqi-badge' },
    el('span', { className: 'aqi-value', text: current.aqi }),
    el('span', { className: 'aqi-label', text: current.category.label }),
    el('span', { className: 'aqi-scale', text: standard.shortName }),
  );
  // CSSOM assignment is CSP-safe (no inline style attribute is parsed).
  badge.style.backgroundColor = current.category.color;
  badge.style.color = current.category.textColor;

  const trend = forecast.trend
    ? el('p', {
        className: 'trend',
        text: `Next ${forecast.trend.lookaheadHours} hours: ${forecast.trend.direction} (AQI ${forecast.trend.now} → ~${forecast.trend.next}).`,
      })
    : null;

  const table = el(
    'table',
    { className: 'pollutants' },
    el('caption', { text: 'Pollutant concentrations right now' }),
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col', text: 'Pollutant' }),
        el('th', { scope: 'col', text: 'µg/m³' }),
        el('th', { scope: 'col', text: 'Sub-index' }),
      ),
    ),
    el(
      'tbody',
      {},
      current.pollutants.map((p) =>
        el(
          'tr',
          { className: p.id === current.dominantPollutant ? 'dominant' : undefined },
          el('th', {
            scope: 'row',
            text: p.id === current.dominantPollutant ? `${p.label} (main)` : p.label,
          }),
          el('td', { text: formatNumber(p.concentration, 1) }),
          el('td', { text: p.subIndex ?? '—' }),
        ),
      ),
    ),
  );

  return [
    el(
      'div',
      { className: 'now-grid' },
      badge,
      el(
        'div',
        {},
        el('p', {
          className: 'place-line',
          text: `${location.name} · measured ${clock(observedAt)} local time`,
        }),
        el('p', { text: current.category.meaning }),
        el('p', {}, 'Main pollutant: ', el('strong', { text: current.dominantLabel })),
        trend,
      ),
    ),
    table,
  ];
}
