// @ts-check
import { el, svg } from '../dom.js';
import { clock, formatNumber } from '../format.js';
import { icon } from './icons.js';
import { stat } from './stat.js';

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
 * The dial with today's value, category badge and scale name.
 * @param {Brief} brief
 */
function gaugeBlock(brief) {
  const { current, standard } = brief;
  const badge = el('span', { className: 'aqi-badge', text: current.category.label });
  // CSSOM assignment is CSP-safe (no inline style attribute is parsed).
  badge.style.backgroundColor = current.category.color;
  badge.style.color = current.category.textColor;
  return el(
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
}

/**
 * One bar per pollutant, scaled to the worst sub-index (at least 100).
 * @param {Brief['current']} current
 */
function pollutantMeters(current) {
  const maxSub = Math.max(100, ...current.pollutants.map((p) => p.subIndex ?? 0));
  return el(
    'ul',
    { className: 'pollutant-meters', 'aria-label': 'Pollutants right now' },
    current.pollutants.map((p) => {
      const fill = el('span');
      fill.style.setProperty('--w', `${Math.round(((p.subIndex ?? 0) / maxSub) * 100)}%`);
      const main = p.id === current.dominantPollutant;
      const amount = formatNumber(p.concentration, 1);
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
          text: `${amount} µg/m³`,
          'aria-label': `${amount} micrograms per cubic metre, sub-index ${p.subIndex ?? 'not available'}`,
        }),
      );
    }),
  );
}

/**
 * Relatable figures: cigarettes, multiple of the WHO limit, main pollutant.
 * @param {Brief} brief
 */
function statTiles({ current, exposure }) {
  return el(
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
  );
}

/**
 * Where and when, the data source, what the level means, and the trend.
 * @param {Brief} brief
 */
function summary(brief) {
  const { current, location, observedAt, forecast, dataSource } = brief;
  const { trend } = forecast;
  return el(
    'div',
    {},
    el('p', {
      className: 'place-line',
      text: `${location.name} · updated ${clock(observedAt)} local time`,
    }),
    el(
      'p',
      { className: `source-line source-${dataSource.kind}` },
      icon(dataSource.kind === 'station' ? 'check' : 'alert'),
      el('span', { text: dataSource.label }),
    ),
    el('p', { className: 'now-meaning', text: current.category.meaning }),
    statTiles(brief),
    trend
      ? el('p', {
          className: 'trend',
          text: `Next ${trend.lookaheadHours} hours: ${trend.direction} (AQI ${trend.now} → ~${trend.next}).`,
        })
      : null,
  );
}

/**
 * "Air right now": dial, relatable exposure figures and pollutant meters.
 * @param {Brief} brief
 */
export function renderNow(brief) {
  return [
    el('div', { className: 'now-grid' }, gaugeBlock(brief), summary(brief)),
    pollutantMeters(brief.current),
  ];
}
