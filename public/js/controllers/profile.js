// @ts-check
import { el, replaceChildren } from '../dom.js';
import { FieldError, readProfile, summariseHousehold, writeProfile } from '../profileForm.js';
import { saveProfile } from '../storage.js';

/**
 * @typedef {import('../storage.js').Profile} Profile
 * @typedef {{
 *   form: HTMLFormElement,
 *   panel: HTMLElement,
 *   toggle: HTMLButtonElement,
 *   summary: HTMLUListElement,
 *   hint: HTMLParagraphElement,
 *   error: HTMLParagraphElement,
 * }} ProfileUi
 * @typedef {{
 *   ui: ProfileUi,
 *   storage: Storage,
 *   getProfile: () => Profile,
 *   setProfile: (profile: Profile) => void,
 *   onSaved: () => void,
 * }} ProfileOptions
 */

/**
 * Remove field-level error markers, keeping any other descriptions.
 * @param {HTMLFormElement} form
 */
function clearFieldErrors(form) {
  form.querySelectorAll('[aria-invalid="true"]').forEach((node) => {
    node.removeAttribute('aria-invalid');
    const described = (node.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((id) => id && id !== 'profile-error');
    if (described.length) node.setAttribute('aria-describedby', described.join(' '));
    else node.removeAttribute('aria-describedby');
  });
}

/**
 * Tie the error message to the offending field so screen readers announce both.
 * @param {HTMLFormElement} form
 * @param {FieldError} error
 */
function markField(form, error) {
  const target = form.elements.namedItem(error.field);
  const field = target instanceof RadioNodeList ? target[0] : target;
  if (!(field instanceof HTMLElement)) return;
  field.setAttribute('aria-invalid', 'true');
  const described = field.getAttribute('aria-describedby');
  field.setAttribute(
    'aria-describedby',
    described ? `${described} profile-error` : 'profile-error',
  );
  field.focus();
}

/**
 * − / + steppers for the household counts, bounded by the input's min/max.
 * @param {HTMLFormElement} form
 */
function setupSteppers(form) {
  form.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-step]');
    if (!(button instanceof HTMLButtonElement)) return;
    const input = form.elements.namedItem(button.dataset.target ?? '');
    if (!(input instanceof HTMLInputElement)) return;
    const next = (Number(input.value) || 0) + Number(button.dataset.step);
    input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), next)));
  });
}

/**
 * Visual household editor: steppers, chips and tiles, collapsing into a
 * one-line summary once the family is set up.
 * @param {ProfileOptions} options
 */
export function setupProfile({ ui, storage, getProfile, setProfile, onSaved }) {
  /** @param {boolean} open */
  function setOpen(open) {
    ui.panel.hidden = !open;
    ui.toggle.setAttribute('aria-expanded', String(open));
    ui.toggle.textContent = open ? 'Hide family details' : 'Edit family';
  }

  function renderSummary() {
    replaceChildren(
      ui.summary,
      summariseHousehold(getProfile().household).map((text) => el('li', { text })),
    );
  }

  function submit() {
    clearFieldErrors(ui.form);
    let profile;
    try {
      profile = readProfile(ui.form);
    } catch (error) {
      ui.error.textContent = error instanceof RangeError ? error.message : 'Please check the form.';
      ui.error.hidden = false;
      setOpen(true);
      if (error instanceof FieldError) markField(ui.form, error);
      return;
    }
    ui.error.hidden = true;
    setProfile(profile);
    saveProfile(storage, profile);
    renderSummary();
    ui.hint.textContent = 'Saved in this browser. Every recommendation now uses your family.';
    setOpen(false);
    onSaved();
  }

  setupSteppers(ui.form);
  ui.toggle.addEventListener('click', () => setOpen(ui.panel.hidden === true));
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  writeProfile(ui.form, getProfile());
  renderSummary();
  // The plan leads; the editor stays one click away instead of a wall of fields.
  setOpen(false);
  return { setOpen, renderSummary };
}
