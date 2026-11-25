import { POLLUTANT_LABELS, STANDARDS } from './aqi/standards.js';
import type { AirBrief, PollutantReading } from './briefTypes.js';
import type { Trend } from './forecast.js';
import { POLLUTANT_IDS, type AqiReading, type Concentrations, type StandardId } from './types.js';

/** How the brief presents itself: the standard's legend, today's reading and a one-paragraph summary. */

const TREND_WORDS: Readonly<Record<Trend['direction'], string>> = {
  improving: 'expected to improve',
  worsening: 'expected to worsen',
  stable: 'expected to stay about the same',
};

/** One-paragraph plain-text summary of the brief, used when sharing and by the rule-based assistant. */
export function summarise(brief: Omit<AirBrief, 'summary'>): string {
  const { location, current, standard, risk, forecast, smog } = brief;
  const parts = [
    `${location.name}: air is ${current.category.label} (${standard.shortName} ${current.aqi}, mainly ${current.dominantLabel}).`,
    risk.headline,
  ];
  if (forecast.trend) {
    parts.push(
      `Over the next ${forecast.trend.lookaheadHours} hours it is ${TREND_WORDS[forecast.trend.direction]} (AQI ~${forecast.trend.next}).`,
    );
  }
  if (smog.trapRisk === 'high' || smog.trapRisk === 'severe') {
    parts.push(`Smog-trap risk is ${smog.trapRisk}.`);
  }
  if (brief.policy) {
    parts.push(`Delhi-NCR GRAP ${brief.policy.stageLabel.split(' – ')[0]} conditions.`);
  }
  if (forecast.windows.outdoor) {
    const w = forecast.windows.outdoor;
    parts.push(`Cleanest hour: ${w.start.slice(11, 16)} (AQI ~${w.averageAqi}).`);
  }
  return parts.join(' ');
}

/** The standard's names and category bands, as the UI legend needs them. */
export function standardSummary(standardId: StandardId): AirBrief['standard'] {
  const standard = STANDARDS[standardId];
  return {
    id: standard.id,
    name: standard.name,
    shortName: standard.shortName,
    bands: standard.categories.map(({ min, max, label, color }) => ({ min, max, label, color })),
  };
}

/** Today's reading for the UI: AQI, category, main pollutant and each pollutant's concentration and sub-index. */
export function currentSummary(current: Concentrations, reading: AqiReading): AirBrief['current'] {
  const pollutants: PollutantReading[] = [];
  for (const id of POLLUTANT_IDS) {
    const value = current[id];
    if (value === null || value === undefined) continue;
    pollutants.push({
      id,
      label: POLLUTANT_LABELS[id],
      concentration: Math.round(value * 10) / 10,
      subIndex: reading.subIndices[id] ?? null,
    });
  }
  return {
    aqi: reading.value,
    category: reading.category,
    dominantPollutant: reading.dominantPollutant,
    dominantLabel: POLLUTANT_LABELS[reading.dominantPollutant],
    pollutants,
  };
}
