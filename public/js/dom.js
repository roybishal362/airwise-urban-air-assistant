// @ts-check

/**
 * Tiny safe DOM builder. Text is always assigned through `textContent`, so
 * data from the network (place names, AI answers) can never become markup.
 * There is deliberately no innerHTML anywhere in the front end.
 */

/** @typedef {string | number | Node | null | undefined | false} Child */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | boolean | number | undefined>} [attrs]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'text') node.textContent = String(value);
    else if (name === 'className') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

/**
 * @param {Node} parent
 * @param {(Child | Child[])[]} children
 */
function append(parent, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

/** @param {Element} node */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Replace the content of a container.
 * @param {Element} node
 * @param {...(Child | Child[])} children
 */
export function replaceChildren(node, ...children) {
  clear(node);
  append(node, children);
}

/**
 * Look up a required element by id, failing loudly if the markup changed.
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
export function byId(id, type) {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing #${id}`);
  return node;
}
