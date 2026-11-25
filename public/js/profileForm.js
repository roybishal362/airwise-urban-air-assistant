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
 * A named control: a single input/select, or a group of radio tiles
 * (RadioNodeList), all of which expose a read/write `.value`.
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {HTMLInputElement | HTMLSelectElement | RadioNodeList}
 */
function field(form, name) {
  const node = form.elements.namedItem(name);
  if (
    node instanceof HTMLInputElement ||
    node instanceof HTMLSelectElement ||
    node instanceof RadioNodeList
  ) {
    return node;
  }
  throw new Error(`Missing form field: ${name}`);
}

/**
 * Value of a required choice (radio group or select).
 * @param {HTMLFormElement} form
 * @param {string} name
 * @param {string} label
 */
function choice(form, name, label) {
  const value = field(form, name).value;
  if (!value) throw new FieldError(name, `Choose your ${label}.`);
  return value;
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 */
const checked = (form, name) => /** @type {HTMLInputElement} */ (field(form, name)).checked;

/** Valid range and display name of each numeric field. */
const NUMBER_FIELDS = {
  adults: { min: 0, max: 20, label: 'Adults' },
  children: { min: 0, max: 20, label: 'Children' },
  seniors: { min: 0, max: 20, label: 'Older adults' },
  roomAreaSqm: { min: 4, max: 200, label: 'Room size' },
  purifierCadrM3h: { min: 0, max: 2000, label: 'Purifier CADR' },
  commuteKm: { min: 0, max: 200, label: 'Commute distance' },
  communityHouseholds: { min: 1, max: 10_000, label: 'Households acting together' },
};

/**
 * A required number within its field's range.
 * @param {HTMLFormElement} form
 * @param {keyof typeof NUMBER_FIELDS} name
 */
function number(form, name) {
  const { min, max, label } = NUMBER_FIELDS[name];
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
    adults: number(form, 'adults'),
    children: number(form, 'children'),
    seniors: number(form, 'seniors'),
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
        roomAreaSqm: number(form, 'roomAreaSqm'),
        hasAirPurifier,
        purifierCadrM3h: hasAirPurifier ? number(form, 'purifierCadrM3h') : 0,
      },
      lifestyle: {
        commuteMode: choice(form, 'commuteMode', 'commute'),
        commuteKm: number(form, 'commuteKm'),
        workFromHomePossible: checked(form, 'workFromHomePossible'),
        cookingFuel: choice(form, 'cookingFuel', 'cooking fuel'),
        heating: choice(form, 'heating', 'winter heating'),
        exercisesOutdoors: checked(form, 'exercisesOutdoors'),
      },
      communityHouseholds: Math.round(number(form, 'communityHouseholds')),
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

const COMMUTE_LABELS = /** @type {Readonly<Record<string, string>>} */ ({
  two_wheeler: 'Scooter / bike',
  car_petrol: 'Petrol car',
  car_diesel: 'Diesel car',
  car_cng: 'CNG car',
  ev_car: 'Electric car',
  auto_rickshaw: 'Auto-rickshaw',
  bus: 'Bus',
  metro: 'Metro / train',
  bicycle: 'Bicycle',
  walk: 'Walk',
  none: 'No commute',
});

const CONDITION_LABELS = /** @type {Readonly<Record<string, string>>} */ ({
  asthma: 'Asthma',
  copd: 'COPD',
  heart_disease: 'Heart disease',
  diabetes: 'Diabetes',
  pregnancy: 'Pregnancy',
  allergies: 'Allergies',
});

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Short pills describing the household, shown when the form is collapsed.
 * @param {Profile['household']} h
 * @returns {string[]}
 */
export function summariseHousehold(h) {
  const pills = [];
  if (h.members.adults) pills.push(plural(h.members.adults, 'adult', 'adults'));
  if (h.members.children) pills.push(plural(h.members.children, 'child', 'children'));
  if (h.members.seniors) pills.push(plural(h.members.seniors, 'older adult', 'older adults'));
  for (const c of h.conditions) pills.push(CONDITION_LABELS[c] ?? c);
  const mode = COMMUTE_LABELS[h.lifestyle.commuteMode] ?? h.lifestyle.commuteMode;
  pills.push(h.lifestyle.commuteMode === 'none' ? mode : `${mode} · ${h.lifestyle.commuteKm} km`);
  if (h.home.hasAirPurifier) pills.push('Has purifier');
  if (h.communityHouseholds > 1) pills.push(`${h.communityHouseholds} households together`);
  return pills;
}
