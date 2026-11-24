// @ts-check
import { el } from '../dom.js';
import { clock, formatNumber, timeRange, trapRiskLabel } from '../format.js';

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {import('../../../src/domain/types.js').TimeWindow} TimeWindow
 */

/**
 * ' tomorrow' when a window starts on the day after the reading.
 * @param {string} time
 * @param {string} reference
 */
export function dayWord(time, reference) {
  return time.slice(0, 10) === reference.slice(0, 10) ? '' : ' tomorrow';
}

/**
 * 24-hour bar chart (every bar has screen-reader text), key windows and the
 * smog-trap explanation.
 * @param {Brief} brief
 */
export function renderForecast(brief) {
  const { hours, windows } = brief.forecast;
  const peak = Math.max(100, ...hours.map((h) => h.aqi));
  const bars = el(
    'ol',
    { className: 'bars', 'aria-label': 'Hourly air quality for the next 24 hours' },
    hours.map((h, i) => {
      const bar = el('span', { className: `bar lvl-${h.level}`, 'aria-hidden': 'true' });
      bar.style.setProperty('--h', `${Math.max(4, Math.round((h.aqi / peak) * 100))}%`);
      return el(
        'li',
        {},
        bar,
        el('span', {
          className: 'visually-hidden',
          text: `${clock(h.time)}${dayWord(h.time, brief.observedAt)}: AQI ${h.aqi}, ${h.label}`,
        }),
        i % 3 === 0
          ? el('span', {
              className: 'bar-hour',
              'aria-hidden': 'true',
              text: clock(h.time).slice(0, 2),
            })
          : null,
      );
    }),
  );

  /** @param {string} label @param {TimeWindow | null} w @param {string} none */
  const windowItem = (label, w, none) =>
    el(
      'li',
      {},
      el('strong', { text: `${label}: ` }),
      w
        ? `${timeRange(w.start, w.end)}${dayWord(w.start, brief.observedAt)} (AQI ~${w.averageAqi})`
        : none,
    );

  const smog = brief.smog;
  return [
    bars,
    el(
      'ul',
      { className: 'windows' },
      windowItem('Cleanest hour', windows.outdoor, 'none clean enough'),
      windowItem('Best time to air the home', windows.ventilation, 'keep windows shut'),
      windowItem('Most polluted', windows.worst, 'no major peak'),
    ),
    el(
      'div',
      { className: `smog smog-${smog.trapRisk}` },
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
