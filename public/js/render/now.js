// @ts-check
import { el, svg } from '../dom.js';
import { clock, formatNumber } from '../format.js';
import { icon } from './icons.js';

/** @typedef {import('../../../src/domain/brief.js').AirBrief} Brief */

const CX = 120;
const CY = 120;
const R = 95;
const MAX = 500;

/**
 * Point on the gauge arc for an index value (0 = left, 500 = right).
 * @param {number} value
 * @param {number} [radius]
 */
function point(value, radius = R) {
  const angle = Math.PI - (Math.min(value, MAX) / MAX) * Math.PI;
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) };
}

/**
 * Semicircular AQI dial: one coloured arc per category of the active
 * standard, and a needle that sweeps to today's value.
 * @param {Brief} brief
 */
export function renderGauge(brief) {
  const { bands } = brief.standard;
  const arcs = bands.map((band, i) => {
    const from = point(band.min);
    const to = point(bands[i + 1]?.min ?? MAX);
    return svg('path', {
      class: 'gauge-band',
      d: `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} A ${R} ${R} 0 0 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)}`,
      stroke: band.color,
    });
  });
  const needle = svg(
    'g',
    { class: 'gauge-needle' },
    svg('line', { x1: CX, y1: CY, x2: CX - R + 22, y2: CY }),
    svg('circle', { cx: CX, cy: CY, r: 9 }),
  );
  // CSSOM custom property (CSP-safe): the needle rotates clockwise from the left end.
  /** @type {SVGElement} */ (needle).style.setProperty(
    '--angle',
    `${((Math.min(brief.current.aqi, MAX) / MAX) * 180).toFixed(1)}deg`,
  );
  return svg(
    'svg',
    {
      class: 'gauge',
      viewBox: '0 0 240 135',
      role: 'img',
      'aria-label': `AQI gauge: ${brief.current.aqi}, ${brief.current.category.label}`,
    },
    arcs,
    needle,
  );
}

/**
 * @param {string} name
 * @param {string} value
 * @param {string} label
 */
const stat = (name, value, label) =>
  el(
    'div',
    { className: 'stat' },
    icon(name),
    el('span', { className: 'stat-value', text: value }),
    el('span', { className: 'stat-label', text: label }),
  );

/**
 * "Air right now": dial, relatable exposure figures and pollutant meters.
 * @param {Brief} brief
 */
export function renderNow(brief) {
  const { current, standard, location, observedAt, forecast, exposure } = brief;
  const badge = el('span', { className: 'aqi-badge', text: current.category.label });
  // CSSOM assignment is CSP-safe (no inline style attribute is parsed).
  badge.style.backgroundColor = current.category.color;
  badge.style.color = current.category.textColor;

  const gauge = el(
    'div',
    { className: 'gauge-wrap' },
    renderGauge(brief),
    el(
      'div',
      { className: 'gauge-readout' },
      el('span', { className: 'aqi-value', text: current.aqi }),
      badge,
      el('span', { className: 'aqi-scale', text: standard.shortName }),
    ),
  );

  const maxSub = Math.max(100, ...current.pollutants.map((p) => p.subIndex ?? 0));
  const meters = el(
    'ul',
    { className: 'pollutant-meters', 'aria-label': 'Pollutants right now' },
    current.pollutants.map((p) => {
      const fill = el('span');
      fill.style.setProperty('--w', `${Math.round(((p.subIndex ?? 0) / maxSub) * 100)}%`);
      const main = p.id === current.dominantPollutant;
      return el(
        'li',
        {},
        el('span', {
          className: main ? 'dominant' : undefined,
          text: main ? `${p.label} · main` : p.label,
        }),
        el('span', { className: 'meter', 'aria-hidden': 'true' }, fill),
        el('span', {
          className: 'meter-value',
          text: `${formatNumber(p.concentration, 1)} µg/m³`,
          'aria-label': `${formatNumber(p.concentration, 1)} micrograms per cubic metre, sub-index ${p.subIndex ?? 'not available'}`,
        }),
      );
    }),
  );

  return [
    el(
      'div',
      { className: 'now-grid' },
      gauge,
      el(
        'div',
        {},
        el('p', {
          className: 'place-line',
          text: `${location.name} · updated ${clock(observedAt)} local time`,
        }),
        el(
          'p',
          { className: `source-line source-${brief.dataSource.kind}` },
          icon(brief.dataSource.kind === 'station' ? 'check' : 'alert'),
          el('span', { text: brief.dataSource.label }),
        ),
        el('p', { className: 'now-meaning', text: current.category.meaning }),
        el(
          'div',
          { className: 'stat-tiles' },
          stat(
            'cigarette',
            `≈ ${formatNumber(exposure.cigarettesPerDay, 1)}`,
            'cigarettes a day, breathing this air',
          ),
          stat('globe', `${formatNumber(exposure.whoMultiple, 1)}×`, 'the WHO daily PM2.5 limit'),
          stat(
            'wind',
            current.dominantLabel.split(' (')[0] ?? current.dominantLabel,
            'main pollutant now',
          ),
        ),
        forecast.trend
          ? el('p', {
              className: 'trend',
              text: `Next ${forecast.trend.lookaheadHours} hours: ${forecast.trend.direction} (AQI ${forecast.trend.now} → ~${forecast.trend.next}).`,
            })
          : null,
      ),
    ),
    meters,
  ];
}
