// @ts-check
import { replaceChildren } from '../dom.js';
import { renderFamily } from './family.js';
import { renderForecast } from './forecast.js';
import { renderImpact } from './impact.js';
import { renderIndoor } from './indoor.js';
import { renderNow } from './now.js';
import { renderRoutine } from './routine.js';

/**
 * Renders the AirBrief returned by POST /api/brief, one module per section.
 * Types come straight from the server's domain model, so `npm run typecheck`
 * fails if the API contract and the UI ever drift apart.
 * @typedef {import('../../../src/domain/brief.js').AirBrief} Brief
 * @typedef {Record<'now' | 'family' | 'forecast' | 'routine' | 'indoor' | 'impact', Element>} Targets
 */

export { renderCommunityHeadline, renderImpact } from './impact.js';
export { renderFamily, renderPolicy } from './family.js';
export { dayWord, renderForecast } from './forecast.js';
export { renderIndoor } from './indoor.js';
export { renderNow } from './now.js';
export { renderRoutine } from './routine.js';

/**
 * Render every section of the brief into its container.
 * @param {Brief} brief
 * @param {Targets} targets
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
  if (brief.community.households > 1) {
    lines.push(
      '',
      `Together our ${brief.community.households} households could avoid ~${brief.community.total.co2KgPerYear.toLocaleString('en-IN')} kg CO₂ a year.`,
    );
  }
  return lines.join('\n');
}
