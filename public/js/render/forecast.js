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
 * Highlight band for a time window, with a short label above it.
 * @param {readonly HourlyIndex[]} hours
 * @param {TimeWindow | null} window
 * @param {number} step
 * @param {string} className
 * @param {string} label
 */
function band(hours, window, step, className, label) {
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
 * Accessible SVG bar chart of the next 24 hours.
 * @param {Brief} brief
 */
export function renderChart(brief) {
  const { hours, windows } = brief.forecast;
  const step = PLOT_W / Math.max(hours.length, 1);
  const top = Math.ceil(Math.max(150, ...hours.map((h) => h.aqi)) / 50) * 50;
  /** @param {number} v */
  const y = (v) => TOP + PLOT_H - (v / top) * PLOT_H;

  const grid = [];
  for (let v = 100; v < top; v += 100) {
    grid.push(
      svg('line', {
        class: 'chart-grid',
        x1: LEFT,
        x2: W - RIGHT,
        y1: y(v).toFixed(1),
        y2: y(v).toFixed(1),
      }),
      svg('text', { class: 'chart-label', x: 2, y: (y(v) + 4).toFixed(1) }, String(v)),
    );
  }
  const bars = hours.map((h, i) =>
    svg('rect', {
      class: `chart-bar lvl-${h.level}`,
      x: (LEFT + i * step + 1.5).toFixed(1),
      y: y(h.aqi).toFixed(1),
      width: Math.max(step - 3, 1).toFixed(1),
      height: ((h.aqi / top) * PLOT_H).toFixed(1),
      rx: 2,
    }),
  );
  const labels = hours.flatMap((h, i) =>
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
  const lowest = hours.reduce((a, b) => (b.aqi < a.aqi ? b : a), hours[0] ?? { time: '', aqi: 0 });
  const highest = hours.reduce((a, b) => (b.aqi > a.aqi ? b : a), hours[0] ?? { time: '', aqi: 0 });
  return svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-labelledby': 'chart-title chart-desc',
    },
    svg('title', { id: 'chart-title' }, 'Hourly air quality for the next 24 hours'),
    svg(
      'desc',
      { id: 'chart-desc' },
      `Lowest AQI ${lowest.aqi} at ${clock(lowest.time)}${dayWord(lowest.time, brief.observedAt)}; highest ${highest.aqi} at ${clock(highest.time)}${dayWord(highest.time, brief.observedAt)}.`,
    ),
    grid,
    band(hours, windows.outdoor, step, 'band-best', 'Cleanest'),
    band(hours, windows.worst, step, 'band-worst', 'Worst'),
    bars,
    svg('line', {
      class: 'now-line',
      x1: LEFT + 0.5,
      x2: LEFT + 0.5,
      y1: TOP - 2,
      y2: TOP + PLOT_H,
    }),
    svg('text', { class: 'band-label', x: LEFT + 3, y: H - BOTTOM + 14 }, 'Now'),
    labels,
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
