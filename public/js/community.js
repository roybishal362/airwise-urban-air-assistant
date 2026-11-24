// @ts-check

/**
 * Client-side impact arithmetic for instant interactivity: the community
 * slider and pledge tracker update without another server round trip. The
 * per-household figures still come from the server's domain engines.
 *
 * @typedef {import('../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {import('../../src/domain/impact/index.js').SustainableAction} SustainableAction
 * @typedef {import('../../src/domain/impact/index.js').Quantity} Quantity
 */

/** Yearly CO₂ uptake of one mature tree (matches the server factor). */
export const TREE_CO2_KG = 21;

/**
 * @param {number | null} value
 * @param {number} factor
 */
const times = (value, factor) => (value === null ? null : Math.round(value * factor));

/**
 * Re-scale every community figure in the brief to `households`.
 * @param {AirBrief} brief
 * @param {number} households
 * @returns {AirBrief}
 */
export function scaleCommunity(brief, households) {
  const n = Math.max(1, Math.min(10_000, Math.round(households)));
  const per = brief.community.perHousehold;
  const totalCo2 = Math.round(per.co2KgPerYear * n);
  return {
    ...brief,
    communityHouseholds: n,
    community: {
      ...brief.community,
      households: n,
      total: { co2KgPerYear: totalCo2, pm25GPerYear: Math.round(per.pm25GPerYear * n) },
      treesEquivalent: Math.round(totalCo2 / TREE_CO2_KG),
    },
    actions: brief.actions.map((action) => ({
      ...action,
      community: {
        co2KgPerYear: times(action.perHousehold.co2KgPerYear, n),
        pm25GPerYear: times(action.perHousehold.pm25GPerYear, n),
        noxGPerYear: times(action.perHousehold.noxGPerYear, n),
      },
    })),
  };
}

/**
 * Yearly impact of the actions a household has pledged.
 * @param {readonly SustainableAction[]} actions
 * @param {ReadonlySet<string>} pledged
 */
export function pledgeTotals(actions, pledged) {
  let co2 = 0;
  let pm25 = 0;
  let count = 0;
  for (const action of actions) {
    if (!pledged.has(action.id)) continue;
    count += 1;
    co2 += action.perHousehold.co2KgPerYear ?? 0;
    pm25 += action.perHousehold.pm25GPerYear ?? 0;
  }
  return {
    count,
    co2KgPerYear: Math.round(co2),
    pm25GPerYear: Math.round(pm25),
    trees: Math.round(co2 / TREE_CO2_KG),
  };
}
