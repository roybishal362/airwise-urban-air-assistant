// @ts-check

/** Two-way mapping between the profile form and the Profile object. */

/** @typedef {import('./storage.js').Profile} Profile */

/** A validation error tied to one form field, so the UI can mark and focus it. */
export class FieldError extends RangeError {
  /**
   * @param {string} field
   * @param {string} message
   */
  constructor(field, message) {
    super(message);
    this.name = 'FieldError';
    this.field = field;
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {HTMLInputElement | HTMLSelectElement}
 */
function field(form, name) {
  const node = form.elements.namedItem(name);
  if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) return node;
  throw new Error(`Missing form field: ${name}`);
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 */
const checked = (form, name) => /** @type {HTMLInputElement} */ (field(form, name)).checked;

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @param {string} label
 */
function number(form, name, min, max, label) {
  const input = field(form, name);
  const value = Number(input.value);
  if (input.value.trim() === '' || !Number.isFinite(value) || value < min || value > max) {
    throw new FieldError(name, `${label} must be between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Read and validate the form. Throws FieldError with a user-facing message.
 * @param {HTMLFormElement} form
 * @returns {Profile}
 */
export function readProfile(form) {
  const members = {
    adults: number(form, 'adults', 0, 20, 'Adults'),
    children: number(form, 'children', 0, 20, 'Children'),
    seniors: number(form, 'seniors', 0, 20, 'Older adults'),
  };
  if (members.adults + members.children + members.seniors < 1) {
    throw new FieldError('adults', 'Add at least one person to your household.');
  }
  const conditions = Array.from(form.querySelectorAll('input[name="conditions"]:checked')).map(
    (node) => /** @type {HTMLInputElement} */ (node).value,
  );
  const hasAirPurifier = checked(form, 'hasAirPurifier');
  const standard = /** @type {'auto' | 'us' | 'in'} */ (field(form, 'standard').value);
  return {
    standard,
    household: {
      members,
      conditions,
      home: {
        roomAreaSqm: number(form, 'roomAreaSqm', 4, 200, 'Room size'),
        hasAirPurifier,
        purifierCadrM3h: hasAirPurifier
          ? number(form, 'purifierCadrM3h', 0, 2000, 'Purifier CADR')
          : 0,
      },
      lifestyle: {
        commuteMode: field(form, 'commuteMode').value,
        commuteKm: number(form, 'commuteKm', 0, 200, 'Commute distance'),
        workFromHomePossible: checked(form, 'workFromHomePossible'),
        cookingFuel: field(form, 'cookingFuel').value,
        heating: field(form, 'heating').value,
        exercisesOutdoors: checked(form, 'exercisesOutdoors'),
      },
      communityHouseholds: Math.round(
        number(form, 'communityHouseholds', 1, 10_000, 'Households acting together'),
      ),
    },
  };
}

/**
 * @param {HTMLFormElement} form
 * @param {Profile} profile
 */
export function writeProfile(form, profile) {
  const { household: h } = profile;
  /** @type {[string, string | number][]} */
  const values = [
    ['adults', h.members.adults],
    ['children', h.members.children],
    ['seniors', h.members.seniors],
    ['commuteMode', h.lifestyle.commuteMode],
    ['commuteKm', h.lifestyle.commuteKm],
    ['cookingFuel', h.lifestyle.cookingFuel],
    ['heating', h.lifestyle.heating],
    ['roomAreaSqm', h.home.roomAreaSqm],
    ['purifierCadrM3h', h.home.purifierCadrM3h],
    ['communityHouseholds', h.communityHouseholds],
    ['standard', profile.standard],
  ];
  for (const [name, value] of values) field(form, name).value = String(value);
  /** @type {[string, boolean][]} */
  const flags = [
    ['workFromHomePossible', h.lifestyle.workFromHomePossible],
    ['exercisesOutdoors', h.lifestyle.exercisesOutdoors],
    ['hasAirPurifier', h.home.hasAirPurifier],
  ];
  for (const [name, value] of flags)
    /** @type {HTMLInputElement} */ (field(form, name)).checked = value;
  form.querySelectorAll('input[name="conditions"]').forEach((node) => {
    const box = /** @type {HTMLInputElement} */ (node);
    box.checked = h.conditions.includes(box.value);
  });
}
