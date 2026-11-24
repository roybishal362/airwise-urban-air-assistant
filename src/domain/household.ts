import { z } from 'zod';

/**
 * The household profile is the "lifestyle" half of the problem statement.
 * It is validated strictly (unknown keys rejected, every number bounded) and is
 * never logged or put in a URL because it contains health information.
 */

export const HEALTH_CONDITIONS = [
  'asthma',
  'copd',
  'heart_disease',
  'diabetes',
  'pregnancy',
  'allergies',
] as const;
export type HealthCondition = (typeof HEALTH_CONDITIONS)[number];

export const COMMUTE_MODES = [
  'car_petrol',
  'car_diesel',
  'car_cng',
  'ev_car',
  'two_wheeler',
  'auto_rickshaw',
  'bus',
  'metro',
  'bicycle',
  'walk',
  'none',
] as const;
export type CommuteMode = (typeof COMMUTE_MODES)[number];

export const COOKING_FUELS = ['lpg', 'piped_gas', 'electric', 'biomass', 'kerosene'] as const;
export type CookingFuel = (typeof COOKING_FUELS)[number];

export const HEATING_TYPES = ['none', 'electric', 'gas', 'wood_or_coal', 'kerosene'] as const;
export type HeatingType = (typeof HEATING_TYPES)[number];

const count = z.number().int().min(0).max(20);

export const householdSchema = z.strictObject({
  members: z
    .strictObject({ adults: count, children: count, seniors: count })
    .refine((m) => m.adults + m.children + m.seniors >= 1, {
      message: 'A household needs at least one member',
    }),
  conditions: z
    .array(z.enum(HEALTH_CONDITIONS))
    .max(HEALTH_CONDITIONS.length)
    .transform((list) => [...new Set(list)]),
  home: z.strictObject({
    /** Floor area of the room the family spends most time in (usually the bedroom). */
    roomAreaSqm: z.number().min(4).max(200),
    hasAirPurifier: z.boolean(),
    /** Clean Air Delivery Rate printed on the purifier box, in m³/h. */
    purifierCadrM3h: z.number().min(0).max(2000),
  }),
  lifestyle: z.strictObject({
    commuteMode: z.enum(COMMUTE_MODES),
    /** One-way commute distance. */
    commuteKm: z.number().min(0).max(200),
    workFromHomePossible: z.boolean(),
    cookingFuel: z.enum(COOKING_FUELS),
    heating: z.enum(HEATING_TYPES),
    exercisesOutdoors: z.boolean(),
  }),
  /** How many households (e.g. a residents' association) will act together. */
  communityHouseholds: z.number().int().min(1).max(10_000),
});

export type Household = z.infer<typeof householdSchema>;

export const DEFAULT_HOUSEHOLD: Household = {
  members: { adults: 2, children: 1, seniors: 1 },
  conditions: [],
  home: { roomAreaSqm: 12, hasAirPurifier: false, purifierCadrM3h: 0 },
  lifestyle: {
    commuteMode: 'two_wheeler',
    commuteKm: 10,
    workFromHomePossible: false,
    cookingFuel: 'lpg',
    heating: 'none',
    exercisesOutdoors: true,
  },
  communityHouseholds: 1,
};

export const CONDITION_LABELS: Readonly<Record<HealthCondition, string>> = {
  asthma: 'asthma',
  copd: 'COPD',
  heart_disease: 'heart disease',
  diabetes: 'diabetes',
  pregnancy: 'pregnancy',
  allergies: 'allergies',
};

const SENSITIVE_CONDITIONS: ReadonlySet<HealthCondition> = new Set([
  'asthma',
  'copd',
  'heart_disease',
  'diabetes',
  'pregnancy',
]);

export interface Vulnerability {
  /** True when anyone at home belongs to a pollution-sensitive group. */
  isSensitive: boolean;
  /** Human-readable list, e.g. ["children", "the family member with asthma"]. */
  groups: string[];
  hasRespiratory: boolean;
  hasCardiac: boolean;
}

export function assessVulnerability(household: Household): Vulnerability {
  const groups: string[] = [];
  if (household.members.children > 0) groups.push('children');
  if (household.members.seniors > 0) groups.push('older adults');
  for (const condition of household.conditions) {
    if (SENSITIVE_CONDITIONS.has(condition))
      groups.push(`the family member with ${CONDITION_LABELS[condition]}`);
  }
  return {
    isSensitive: groups.length > 0,
    groups,
    hasRespiratory: household.conditions.some((c) => c === 'asthma' || c === 'copd'),
    hasCardiac: household.conditions.includes('heart_disease'),
  };
}

/** ["a", "b", "c"] → "a, b and c". */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function householdSize(household: Household): number {
  const { adults, children, seniors } = household.members;
  return adults + children + seniors;
}
