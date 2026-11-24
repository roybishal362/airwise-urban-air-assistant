// @ts-check
import { el, replaceChildren } from './dom.js';
import {
  clock,
  formatCo2,
  formatMass,
  formatNumber,
  signedPct,
  timeRange,
  trapRiskLabel,
} from './format.js';

/**
 * Renders the AirBrief returned by POST /api/brief. Types come straight from
 * the server's domain model, so `npm run typecheck` fails if the API contract
 * and the UI ever drift apart.
 * @typedef {import('../../src/domain/brief.js').AirBrief} Brief
 * @typedef {import('../../src/domain/types.js').TimeWindow} TimeWindow
 * @typedef {import('../../src/domain/impact.js').ModeImpact} ModeImpact
 */

const PRIORITY_LABEL = /** @type {Record<number, string>} */ ({
  1: 'Do first',
  2: 'Recommended',
  3: 'Good to know',
});
const TAG_LABEL = /** @type {Record<string, string>} */ ({
  exposure: 'Less exposure',
  emissions: 'Fewer emissions',
  indoor: 'Cleaner indoors',
});

/** @param {Brief} brief */
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

/** @param {Brief} brief */
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
          risk.reasons.map((/** @type {string} */ r) => el('li', { text: r })),
        ),
      ),
    ),
    el(
      'ul',
      { className: 'member-advice' },
      risk.memberAdvice.map((m) => el('li', {}, el('strong', { text: `${m.who}: ` }), m.advice)),
    ),
  ];
}

/**
 * ' tomorrow' when a window starts on the day after the reading.
 * @param {string} time
 * @param {string} reference
 */
export function dayWord(time, reference) {
  return time.slice(0, 10) === reference.slice(0, 10) ? '' : ' tomorrow';
}

/** @param {Brief} brief */
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
          text: `${clock(h.time)}: AQI ${h.aqi}, ${h.label}`,
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
        smog.explanation.map((/** @type {string} */ line) => el('li', { text: line })),
      ),
    ),
  ];
}

/** @param {Brief} brief */
export function renderRoutine(brief) {
  return [
    el(
      'ol',
      { className: 'timeline' },
      brief.routine.map((step) =>
        el(
          'li',
          {},
          el('p', { className: 'when', text: step.when }),
          el('h3', { text: step.title }),
          el('p', { text: step.detail }),
          el('p', { className: 'why' }, el('strong', { text: 'Impact: ' }), step.why),
          el(
            'p',
            { className: 'tags' },
            step.tags.map((/** @type {string} */ t) =>
              el('span', { className: `tag tag-${t}`, text: TAG_LABEL[t] ?? t }),
            ),
          ),
        ),
      ),
    ),
  ];
}

/** @param {Brief} brief */
export function renderIndoor(brief) {
  const { indoor } = brief;
  const comparison = el(
    'table',
    { className: 'compare' },
    el('caption', {
      text: `Estimated PM2.5 in a ${indoor.roomVolumeM3} m³ room with windows shut`,
    }),
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col', text: 'Setup' }),
        el('th', { scope: 'col', text: 'PM2.5 µg/m³' }),
        el('th', { scope: 'col', text: 'Change' }),
      ),
    ),
    el(
      'tbody',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'row', text: 'Outdoors' }),
        el('td', { text: indoor.outdoorPm25 }),
        el('td', { text: '—' }),
      ),
      el(
        'tr',
        {},
        el('th', { scope: 'row', text: 'Indoors, no filter' }),
        el('td', { text: indoor.baselineIndoorPm25 }),
        el('td', { text: '—' }),
      ),
      indoor.options.map((o) =>
        el(
          'tr',
          {},
          el('th', { scope: 'row', text: `${o.label} (${o.cadrM3h} m³/h)` }),
          el('td', { text: o.indoorPm25 }),
          el('td', { text: signedPct(-o.reductionPct) }),
        ),
      ),
    ),
  );
  return [
    comparison,
    el(
      'ul',
      { className: 'hacks' },
      indoor.hacks.map((h) =>
        el(
          'li',
          { className: `hack p${h.priority}` },
          el('span', { className: 'priority', text: PRIORITY_LABEL[h.priority] ?? '' }),
          el('h3', { text: h.title }),
          el('p', { text: h.detail }),
          el('p', { className: 'why' }, el('strong', { text: 'Impact: ' }), h.impact),
        ),
      ),
    ),
  ];
}

/** @param {Brief} brief */
export function renderImpact(brief) {
  /** @type {(Node | null)[]} */
  const parts = [];
  const { commute, actions, communityHouseholds } = brief;
  if (commute) {
    /** @type {(ModeImpact & { current: boolean, inhaledChangePct: number, suitableToday: boolean })[]} */
    const rows = [
      { ...commute.current, current: true, inhaledChangePct: 0, suitableToday: true },
      ...commute.alternatives.map((alt) => ({ ...alt, current: false })),
    ];
    parts.push(
      el(
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
              el('td', {
                text: r.current ? '—' : r.suitableToday ? 'Yes' : 'Better on cleaner days',
              }),
            ),
          ),
        ),
      ),
    );
  }

  const community = communityHouseholds > 1;
  parts.push(
    el(
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
    ),
  );
  if (!community) {
    parts.push(
      el('p', {
        className: 'hint',
        text: 'Tip: set "Households acting together" in your profile to see what your society or street could achieve.',
      }),
    );
  }
  return parts;
}

/**
 * Render every section of the brief into its container.
 * @param {Brief} brief
 * @param {Record<'now' | 'family' | 'forecast' | 'routine' | 'indoor' | 'impact', Element>} targets
 */
export function renderBrief(brief, targets) {
  replaceChildren(targets.now, renderNow(brief));
  replaceChildren(targets.family, renderFamily(brief));
  replaceChildren(targets.forecast, renderForecast(brief));
  replaceChildren(targets.routine, renderRoutine(brief));
  replaceChildren(targets.indoor, renderIndoor(brief));
  replaceChildren(targets.impact, renderImpact(brief));
}

/**
 * Plain-text plan for sharing (WhatsApp, SMS) or reading aloud.
 * @param {Brief} brief
 */
export function planToText(brief) {
  const lines = [`AirWise plan for ${brief.location.name}`, brief.summary, ''];
  for (const step of brief.routine) lines.push(`• ${step.when}: ${step.title}`);
  return lines.join('\n');
}
