// @ts-check
import { scaleCommunity } from '../community.js';
import { renderCommunityHeadline, renderImpact, renderPledgeSummary } from '../render/index.js';

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {{
 *   container: HTMLElement,
 *   storage: Storage,
 *   getBrief: () => AirBrief | null,
 *   setBrief: (brief: AirBrief) => void,
 *   onHouseholdsChange: (households: number) => void,
 * }} ImpactOptions
 */

const PLEDGE_KEY = 'airwise.pledges.v1';

/** @param {Storage} storage */
export function loadPledges(storage) {
  try {
    const raw = JSON.parse(storage.getItem(PLEDGE_KEY) ?? '[]');
    return new Set(
      Array.isArray(raw) ? raw.filter((id) => typeof id === 'string').slice(0, 50) : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * @param {Storage} storage
 * @param {ReadonlySet<string>} pledged
 */
function savePledges(storage, pledged) {
  try {
    storage.setItem(PLEDGE_KEY, JSON.stringify([...pledged]));
  } catch {
    // Storage full or blocked: pledges still work for this session.
  }
}

/**
 * Update numbers around the slider without re-creating it, so keyboard and pointer focus
 * stay on the slider while it moves.
 * @param {HTMLElement} container @param {AirBrief} brief @param {ReadonlySet<string>} pledged
 */
function refreshAroundSlider(container, brief, pledged) {
  const fresh = renderImpact(brief, pledged);
  const headline = renderCommunityHeadline(brief);
  const swap = (/** @type {string} */ selector, /** @type {Element | null | undefined} */ next) => {
    const current = container.querySelector(selector);
    if (current && next) current.replaceWith(next);
  };
  swap('.impact-stats', headline.querySelector('.impact-stats'));
  swap('.community-figure', headline.querySelector('.community-figure'));
  swap(
    '.actions',
    fresh.find((node) => node?.classList?.contains('actions')),
  );
  const output = container.querySelector('.slider-value');
  if (output) output.textContent = brief.community.households.toLocaleString('en-IN');
}

/**
 * The community slider, when the event came from it.
 * @param {Event} event
 */
const sliderFrom = (event) =>
  event.target instanceof HTMLInputElement && event.target.id === 'community-range'
    ? event.target
    : null;

/**
 * Pledge an action, or take the pledge back.
 * @param {Set<string>} pledged @param {string} id
 */
function togglePledge(pledged, id) {
  if (pledged.has(id)) pledged.delete(id);
  else pledged.add(id);
}

/**
 * Live community slider and pledge tracker. Both recompute on the client
 * from the server's per-household figures, so they respond instantly.
 * @param {ImpactOptions} options
 */
export function setupImpactControls({
  container,
  storage,
  getBrief,
  setBrief,
  onHouseholdsChange,
}) {
  const pledged = loadPledges(storage);

  container.addEventListener('input', (event) => {
    const slider = sliderFrom(event);
    const brief = getBrief();
    if (!slider || !brief) return;
    const scaled = scaleCommunity(brief, Number(slider.value));
    setBrief(scaled);
    refreshAroundSlider(container, scaled, pledged);
  });

  container.addEventListener('change', (event) => {
    const slider = sliderFrom(event);
    if (slider) onHouseholdsChange(Number(slider.value));
  });

  container.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-pledge]');
    const brief = getBrief();
    if (!(button instanceof HTMLButtonElement) || !brief) return;
    const id = button.dataset.pledge ?? '';
    togglePledge(pledged, id);
    savePledges(storage, pledged);
    refreshAroundSlider(container, brief, pledged);
    container.querySelector('#pledge-summary')?.replaceWith(renderPledgeSummary(brief, pledged));
    /** @type {HTMLElement | null} */ (container.querySelector(`[data-pledge="${id}"]`))?.focus();
  });

  return { pledged };
}
