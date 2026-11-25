// @ts-check

/**
 * WAI-ARIA tabs for the app shell: click or arrow keys (Left/Right/Home/End)
 * switch tabs, only the active tab is in the tab order, panels are hidden
 * rather than removed, and the active tab lives in the URL (`#/forecast`) so
 * deep links and the browser's back button work.
 *
 * @typedef {{
 *   tablist: HTMLElement,
 *   onChange?: (id: string) => void,
 *   win?: Window,
 * }} TabsOptions
 * @typedef {{ id: string, tab: HTMLButtonElement, panel: HTMLElement | null }} TabEntry
 * @typedef {{ focus?: 'tab' | 'panel' | 'none', push?: boolean, scroll?: boolean }} SelectOptions
 */

const HASH_PREFIX = '#/';

/**
 * Mark one tab selected: only it is in the Tab order and only its panel is shown.
 * @param {readonly TabEntry[]} entries @param {string} target
 */
function markSelected(entries, target) {
  for (const { id, tab, panel } of entries) {
    const on = id === target;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (panel) panel.hidden = !on;
  }
}

/**
 * If the page was scrolled past the panel's top, bring it into view (CSS
 * scroll-margin keeps it clear of the sticky bars), then move focus.
 * @param {TabEntry} entry @param {SelectOptions} options
 */
function reveal({ tab, panel }, { focus = 'none', scroll = true }) {
  if (panel && scroll && panel.getBoundingClientRect().top < 0) {
    panel.scrollIntoView({ block: 'start' });
  }
  if (focus === 'tab') tab.focus({ preventScroll: true });
  if (focus === 'panel' && panel) panel.focus({ preventScroll: true });
}

/**
 * Index of the tab an arrow/Home/End key moves to, wrapping around; null for other keys.
 * @param {string} key @param {number} index @param {number} count
 */
function keyTarget(key, index, count) {
  const moves = new Map([
    ['ArrowRight', index + 1],
    ['ArrowLeft', index - 1],
    ['Home', 0],
    ['End', count - 1],
  ]);
  const move = moves.get(key);
  return move === undefined ? null : (move + count) % count;
}

/**
 * Each tab with its id and the panel it controls.
 * @param {HTMLElement} tablist @param {Window} win
 * @returns {TabEntry[]}
 */
function collectEntries(tablist, win) {
  return /** @type {HTMLButtonElement[]} */ ([...tablist.querySelectorAll('[role="tab"]')]).map(
    (tab) => ({
      id: String(tab.dataset.tab),
      tab,
      panel: win.document.getElementById(String(tab.getAttribute('aria-controls'))),
    }),
  );
}

/**
 * The tab named in the URL, or '' when there is none.
 * @param {Window} win
 */
function tabFromHash(win) {
  const { hash } = win.location;
  return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
}

/**
 * Clicks, arrow keys, data-goto links and the back button all switch tabs.
 * @param {{
 *   tablist: HTMLElement,
 *   win: Window,
 *   ids: readonly string[],
 *   select: (id: string, options?: SelectOptions) => string,
 *   current: () => string,
 * }} ctx
 */
function bindTabEvents({ tablist, win, ids, select, current }) {
  tablist.addEventListener('click', (event) => {
    const tab = /** @type {Element} */ (event.target).closest('[role="tab"]');
    if (tab instanceof HTMLElement) select(String(tab.dataset.tab));
  });
  tablist.addEventListener('keydown', (event) => {
    const next = keyTarget(event.key, ids.indexOf(current()), ids.length);
    if (next === null) return;
    event.preventDefault();
    select(String(ids[next]), { focus: 'tab' });
  });
  // Any element with data-goto="<tab>" (e.g. "Edit family", "Ask a question") switches tabs.
  win.document.addEventListener('click', (event) => {
    const link = /** @type {Element} */ (event.target).closest('[data-goto]');
    const goto = link instanceof HTMLElement ? String(link.dataset.goto) : '';
    if (ids.includes(goto)) select(goto, { focus: 'panel' });
  });
  win.addEventListener('popstate', () => select(tabFromHash(win), { push: false }));
}

/**
 * Wire up the tabs and open the one in the URL (or the first).
 * @param {TabsOptions} options
 */
export function setupTabs({ tablist, onChange, win = window }) {
  const entries = collectEntries(tablist, win);
  const ids = entries.map((entry) => entry.id);
  const home = ids[0] ?? '';
  let current = home;

  /**
   * Activate a tab (unknown ids fall back to the first tab).
   * @param {string} id @param {SelectOptions} [options]
   */
  function select(id, options = {}) {
    const target = ids.includes(id) ? id : home;
    markSelected(entries, target);
    const url = `${HASH_PREFIX}${target}`;
    if (options.push !== false && target !== current && win.location.hash !== url) {
      win.history.pushState(null, '', url);
    }
    current = target;
    const active = entries.find((entry) => entry.id === target);
    if (active) reveal(active, options);
    onChange?.(target);
    return target;
  }

  bindTabEvents({ tablist, win, ids, select, current: () => current });
  select(tabFromHash(win), { push: false, scroll: false });
  return { select, current: () => current };
}
