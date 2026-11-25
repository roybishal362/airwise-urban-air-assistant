// @ts-check
import { el, svg } from '../dom.js';
import { clock, formatNumber, timeRange, trapRiskLabel } from '../format.js';

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {import('../../../src/domain/types.js').TimeWindow} TimeWindow
 * @typedef {import('../../../src/domain/types.js').HourlyIndex} HourlyIndex
 */

/**
 * ' tomorrow' when a window starts on the day after the reading.
 * @param {string} time
 * @param {string} reference
 */
export function dayWord(time, reference) {
  return time.slice(0, 10) === reference.slice(0, 10) ? '' : ' tomorrow';
}

const W = 720;
const H = 230;
const LEFT = 34;
const RIGHT = 6;
const TOP = 24;
const BOTTOM = 26;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = H - TOP - BOTTOM;

/**
 * Horizontal layout of the plot: the width of one hour, the AQI at the top
 * of the plot, and the AQI → SVG y mapping.
 * @typedef {{ step: number, top: number, y: (value: number) => number }} Scale
 */

/**
 * Bars fill the width; the top is the worst hour rounded up to 50 (at least 150).
 * @param {readonly HourlyIndex[]} hours
 * @returns {Scale}
 */
function chartScale(hours) {
  const top = Math.ceil(Math.max(150, ...hours.map((h) => h.aqi)) / 50) * 50;
  return {
    step: PLOT_W / Math.max(hours.length, 1),
    top,
    y: (value) => TOP + PLOT_H - (value / top) * PLOT_H,
  };
}

/**
 * Highlight band for a time window, with a short label above it.
 * @param {readonly HourlyIndex[]} hours
 * @param {Scale} scale
 * @param {TimeWindow | null} window
 * @param {{ className: string, label: string }} look
 */
function band(hours, { step }, window, { className, label }) {
  if (!window) return null;
  const start = hours.findIndex((h) => h.time === window.start);
  if (start < 0) return null;
  const endIndex = hours.findIndex((h) => h.time === window.end);
  const end = endIndex < 0 ? hours.length : endIndex;
  const x = LEFT + start * step;
  return svg(
    'g',
    {},
    svg('rect', {
      class: className,
      x: x.toFixed(1),
      y: TOP,
      width: ((end - start) * step).toFixed(1),
      height: PLOT_H,
    }),
    svg('text', { class: 'band-label', x: (x + 2).toFixed(1), y: TOP - 6 }, label),
  );
}

/**
 * A horizontal grid line and label every 100 AQI.
 * @param {Scale} scale
 */
function gridLines({ top, y }) {
  const grid = [];
  for (let v = 100; v < top; v += 100) {
    const at = y(v).toFixed(1);
    grid.push(
      svg('line', { class: 'chart-grid', x1: LEFT, x2: W - RIGHT, y1: at, y2: at }),
      svg('text', { class: 'chart-label', x: 2, y: (y(v) + 4).toFixed(1) }, String(v)),
    );
  }
  return grid;
}

/**
 * One bar per hour, coloured by its category.
 * @param {readonly HourlyIndex[]} hours
 * @param {Scale} scale
 */
function hourBars(hours, { step, top, y }) {
  return hours.map((h, i) =>
    svg('rect', {
      class: `chart-bar lvl-${h.level}`,
      x: (LEFT + i * step + 1.5).toFixed(1),
      y: y(h.aqi).toFixed(1),
      width: Math.max(step - 3, 1).toFixed(1),
      height: ((h.aqi / top) * PLOT_H).toFixed(1),
      rx: 2,
    }),
  );
}

/**
 * Hour labels under every third bar (the first bar is labelled "Now").
 * @param {readonly HourlyIndex[]} hours
 * @param {Scale} scale
 */
function hourLabels(hours, { step }) {
  return hours.flatMap((h, i) =>
    i % 3 === 0 && i > 0
      ? [
          svg(
            'text',
            { class: 'chart-label', x: (LEFT + i * step + step / 2 - 7).toFixed(1), y: H - 8 },
            clock(h.time).slice(0, 2),
          ),
        ]
      : [],
  );
}

/**
 * The chart's text alternative: when the air is cleanest and worst.
 * @param {readonly HourlyIndex[]} hours
 * @param {string} observedAt
 */
function chartSummary(hours, observedAt) {
  const first = hours[0] ?? { time: '', aqi: 0 };
  const lowest = hours.reduce((a, b) => (b.aqi < a.aqi ? b : a), first);
  const highest = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a), first);
  /** @param {{ time: string, aqi: number }} h */
  const at = (h) => `${h.aqi} at ${clock(h.time)}${dayWord(h.time, observedAt)}`;
  return `Lowest AQI ${at(lowest)}; highest ${at(highest)}.`;
}

/**
 * Accessible SVG bar chart of the next 24 hours.
 * @param {Brief} brief
 */
export function renderChart(brief) {
  const { hours, windows } = brief.forecast;
  const scale = chartScale(hours);
  return svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-labelledby': 'chart-title chart-desc',
    },
    svg('title', { id: 'chart-title' }, 'Hourly air quality for the next 24 hours'),
    svg('desc', { id: 'chart-desc' }, chartSummary(hours, brief.observedAt)),
    gridLines(scale),
    band(hours, scale, windows.outdoor, { className: 'band-best', label: 'Cleanest' }),
    band(hours, scale, windows.worst, { className: 'band-worst', label: 'Worst' }),
    hourBars(hours, scale),
    svg('line', {
      class: 'now-line',
      x1: LEFT + 0.5,
      x2: LEFT + 0.5,
      y1: TOP - 2,
      y2: TOP + PLOT_H,
    }),
    svg('text', { class: 'band-label', x: LEFT + 3, y: H - BOTTOM + 14 }, 'Now'),
    hourLabels(hours, scale),
  );
}

/**
 * Chart, key windows (with screen-reader data list) and the smog-trap explainer.
 * @param {Brief} brief
 */
export function renderForecast(brief) {
  const { hours, windows } = brief.forecast;

  /** @param {string} dot @param {string} label @param {TimeWindow | null} w @param {string} none */
  const windowItem = (dot, label, w, none) =>
    el(
      'li',
      {},
      el('span', { className: `dot ${dot}`, 'aria-hidden': 'true' }),
      el('strong', { text: `${label}: ` }),
      w
        ? `${timeRange(w.start, w.end)}${dayWord(w.start, brief.observedAt)} (AQI ~${w.averageAqi})`
        : none,
    );

  const smog = brief.smog;
  return [
    renderChart(brief),
    el(
      'ol',
      { className: 'visually-hidden', 'aria-label': 'Hourly air quality values' },
      hours.map((h) =>
        el('li', {
          text: `${clock(h.time)}${dayWord(h.time, brief.observedAt)}: AQI ${h.aqi}, ${h.label}`,
        }),
      ),
    ),
    el(
      'ul',
      { className: 'windows' },
      windowItem('dot-best', 'Cleanest hour', windows.outdoor, 'none clean enough'),
      windowItem('dot-air', 'Best time to air the home', windows.ventilation, 'keep windows shut'),
      windowItem('dot-worst', 'Most polluted', windows.worst, 'no major peak'),
    ),
    el(
      'div',
      { className: `smog-box smog-${smog.trapRisk}` },
      el('h3', { text: `Smog-trap risk: ${trapRiskLabel(smog.trapRisk)}` }),
      smog.ventilationNowM2s !== null
        ? el('p', {
            className: 'hint',
            text: `Ventilation coefficient now: ${formatNumber(smog.ventilationNowM2s)} m²/s (${smog.dispersionNow} dispersion)`,
          })
        : null,
      el(
        'ul',
        {},
        smog.explanation.map((line) => el('li', { text: line })),
      ),
    ),
  ];
}
