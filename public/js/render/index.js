// @ts-check
import { replaceChildren } from '../dom.js';
import { renderFamily } from './family.js';
import { renderForecast } from './forecast.js';
import { renderGlance } from './glance.js';
import { renderImpact } from './impact.js';
import { renderIndoor } from './indoor.js';
import { renderNow } from './now.js';
import { renderRoutine } from './routine.js';

/**
 * Renders the AirBrief returned by POST /api/brief, one module per section.
 * Types come straight from the server's domain model, so `npm run typecheck`
 * fails if the API contract and the UI ever drift apart.
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {Record<'now' | 'glance' | 'family' | 'forecast' | 'routine' | 'indoor' | 'impact', Element>} Targets
 */

export { renderCommunityHeadline, renderImpact, renderPledgeSummary } from './impact.js';
export { renderFamily, renderPolicy } from './family.js';
export { dayWord, renderChart, renderForecast } from './forecast.js';
export { renderGlance } from './glance.js';
export { renderIndoor } from './indoor.js';
export { renderGauge, renderNow } from './now.js';
export { renderRoutine } from './routine.js';

/**
 * Render every section of the brief into its container.
 * @param {Brief} brief
 * @param {Targets} targets
 * @param {ReadonlySet<string>} [pledged]
 */
export function renderBrief(brief, targets, pledged = new Set()) {
  replaceChildren(targets.now, renderNow(brief));
  replaceChildren(targets.glance, renderGlance(brief));
  replaceChildren(targets.family, renderFamily(brief));
  replaceChildren(targets.forecast, renderForecast(brief));
  replaceChildren(targets.routine, renderRoutine(brief));
  replaceChildren(targets.indoor, renderIndoor(brief));
  replaceChildren(targets.impact, renderImpact(brief, pledged));
}

/**
 * Plain-text plan for sharing (WhatsApp, SMS) or reading aloud.
 * @param {Brief} brief
 */
export function planToText(brief) {
  const lines = [`AirWise plan for ${brief.location.name}`, brief.summary, ''];
  for (const tile of brief.glance) lines.push(`${tile.label}: ${tile.value}`);
  lines.push('');
  for (const step of brief.routine) lines.push(`• ${step.when}: ${step.title}`);
  if (brief.community.households > 1) {
    lines.push(
      '',
      `Together our ${brief.community.households} households could avoid ~${brief.community.total.co2KgPerYear.toLocaleString('en-IN')} kg CO₂ a year.`,
    );
  }
  return lines.join('\n');
}
