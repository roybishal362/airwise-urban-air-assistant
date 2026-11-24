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
 */

const HASH_PREFIX = '#/';

/** @param {TabsOptions} options */
export function setupTabs({ tablist, onChange, win = window }) {
  const entries = /** @type {HTMLButtonElement[]} */ ([
    ...tablist.querySelectorAll('[role="tab"]'),
  ]).map((tab) => ({
    id: String(tab.dataset.tab),
    tab,
    panel: win.document.getElementById(String(tab.getAttribute('aria-controls'))),
  }));
  const ids = entries.map((entry) => entry.id);
  const home = ids[0] ?? '';
  let current = home;

  /** The tab named in the URL, or '' when there is none. */
  const fromHash = () => {
    const { hash } = win.location;
    return hash.startsWith(HASH_PREFIX) ? hash.slice(HASH_PREFIX.length) : '';
  };

  /**
   * Activate a tab (unknown ids fall back to the first tab).
   * @param {string} id
   * @param {{ focus?: 'tab' | 'panel' | 'none', push?: boolean }} [options]
   */
  function select(id, { focus = 'none', push = true } = {}) {
    const target = ids.includes(id) ? id : home;
    for (const entry of entries) {
      const on = entry.id === target;
      entry.tab.setAttribute('aria-selected', String(on));
      entry.tab.tabIndex = on ? 0 : -1;
      if (entry.panel) entry.panel.hidden = !on;
    }
    if (push && target !== current && win.location.hash !== `${HASH_PREFIX}${target}`) {
      win.history.pushState(null, '', `${HASH_PREFIX}${target}`);
    }
    current = target;
    const active = entries.find((entry) => entry.id === target);
    if (focus === 'tab') active?.tab.focus();
    if (focus === 'panel') active?.panel?.focus();
    onChange?.(target);
    return target;
  }

  tablist.addEventListener('click', (event) => {
    const tab = /** @type {Element} */ (event.target).closest('[role="tab"]');
    if (tab instanceof HTMLElement) select(String(tab.dataset.tab));
  });

  tablist.addEventListener('keydown', (event) => {
    const index = ids.indexOf(current);
    const moves = new Map([
      ['ArrowRight', index + 1],
      ['ArrowLeft', index - 1],
      ['Home', 0],
      ['End', ids.length - 1],
    ]);
    const move = moves.get(event.key);
    if (move === undefined) return;
    event.preventDefault();
    select(String(ids[(move + ids.length) % ids.length]), { focus: 'tab' });
  });

  // Any element with data-goto="<tab>" (e.g. "Edit family", "Ask a question") switches tabs.
  win.document.addEventListener('click', (event) => {
    const link = /** @type {Element} */ (event.target).closest('[data-goto]');
    const goto = link instanceof HTMLElement ? String(link.dataset.goto) : '';
    if (ids.includes(goto)) select(goto, { focus: 'panel' });
  });

  win.addEventListener('popstate', () => select(fromHash(), { push: false }));

  select(fromHash(), { push: false });
  return { select, current: () => current };
}
