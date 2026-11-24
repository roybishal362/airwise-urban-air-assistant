import { describe, expect, it } from 'vitest';
import { buildBrief } from '../../src/domain/brief.js';
import {
  buildSustainableActions,
  compareCommute,
  computeModeImpact,
  summariseCommunity,
  type SustainableAction,
} from '../../src/domain/impact/index.js';
import { grapStageFor, localPolicy } from '../../src/domain/policy.js';
import {
  INDIA_GRID_CO2,
  WORLD_AVERAGE_GRID_CO2,
  isInDelhiNcr,
  resolveRegion,
} from '../../src/domain/region.js';
import { DELHI, makeAir, makeHousehold, makeWeather } from '../fixtures/data.js';

const LONDON = { name: 'London', latitude: 51.5, longitude: -0.12, countryCode: 'GB' };
const MUMBAI = { name: 'Mumbai', latitude: 19.07, longitude: 72.88, countryCode: 'IN' };
const NOIDA = { name: 'Noida', latitude: 28.54, longitude: 77.39, countryCode: 'IN' };

describe('resolveRegion', () => {
  it('recognises Delhi-NCR, the rest of India and other countries', () => {
    expect(resolveRegion(DELHI)).toEqual({
      countryCode: 'IN',
      isIndia: true,
      isDelhiNcr: true,
      gridCo2KgPerKwh: INDIA_GRID_CO2,
      emergencyNumber: '112 (ambulance 108)',
    });
    expect(resolveRegion(NOIDA).isDelhiNcr).toBe(true);
    expect(resolveRegion(MUMBAI)).toMatchObject({ isIndia: true, isDelhiNcr: false });
    expect(resolveRegion(LONDON)).toMatchObject({
      isIndia: false,
      gridCo2KgPerKwh: 0.21,
      emergencyNumber: '999 or 112',
    });
  });

  it('infers India from the timezone and falls back to world averages', () => {
    const located = { name: 'Your location', latitude: 28.6, longitude: 77.2 };
    expect(resolveRegion(located, 'Asia/Kolkata')).toMatchObject({
      countryCode: 'IN',
      isDelhiNcr: true,
    });
    expect(resolveRegion({ ...located, latitude: 0, longitude: 0 })).toMatchObject({
      countryCode: null,
      gridCo2KgPerKwh: WORLD_AVERAGE_GRID_CO2,
      emergencyNumber: 'your local emergency number',
    });
    expect(resolveRegion({ ...LONDON, countryCode: 'de' }).emergencyNumber).toBe('112');
  });

  it('bounds Delhi-NCR geographically', () => {
    expect(isInDelhiNcr(28.65, 77.23)).toBe(true);
    expect(isInDelhiNcr(26.85, 80.95)).toBe(false); // Lucknow
  });
});

describe('location-aware impact', () => {
  it('prices electric modes with the local grid', () => {
    const delhiMetro = computeModeImpact('metro', 10, 50, INDIA_GRID_CO2);
    const londonMetro = computeModeImpact('metro', 10, 50, 0.21);
    expect(londonMetro.co2KgPerWeek).toBeLessThan(delhiMetro.co2KgPerWeek);
    expect(computeModeImpact('ev_car', 10, 50, 0.06).co2KgPerWeek).toBe(0.8); // 100 km × 0.14 kWh × 0.06
    // Fuel modes do not depend on the grid.
    expect(computeModeImpact('car_petrol', 10, 50, 0.06).co2KgPerWeek).toBe(15);
  });

  it('mentions Indian schemes only in India', () => {
    const household = makeHousehold({
      lifestyle: {
        ...makeHousehold().lifestyle,
        commuteMode: 'car_petrol',
        cookingFuel: 'biomass',
        workFromHomePossible: true,
      },
    });
    const text = (region: ReturnType<typeof resolveRegion>) =>
      buildSustainableActions(
        household,
        compareCommute(household, 80, 3, region.gridCo2KgPerKwh),
        region,
      )
        .map((a) => `${a.detail} ${a.impactStatement}`)
        .join(' ');
    const india = text(resolveRegion(DELHI));
    const uk = text(resolveRegion(LONDON));
    expect(india).toMatch(/Gaadi Off|Ujjwala|Sameer|GRAP/);
    expect(uk).not.toMatch(/Gaadi Off|Ujjwala|Sameer|GRAP|India/);
    expect(uk).toMatch(/grid factor 0.21/);
  });
});

describe('summariseCommunity', () => {
  const action = (
    id: string,
    category: SustainableAction['category'],
    co2: number | null,
    pm: number | null,
  ): SustainableAction => ({
    id,
    title: id,
    category,
    detail: '',
    impactStatement: '',
    perHousehold: { co2KgPerYear: co2, pm25GPerYear: pm, noxGPerYear: null },
    community: { co2KgPerYear: co2, pm25GPerYear: pm, noxGPerYear: null },
  });

  it('counts only the largest transport saving and scales by households', () => {
    const summary = summariseCommunity(
      [
        action('switch-commute', 'transport', 700, 50),
        action('no-idling', 'transport', 65, null),
        action('never-burn-waste', 'waste', null, 1040),
        action('save-electricity', 'energy', 263, null),
      ],
      10,
    );
    expect(summary.countedActionIds).toEqual([
      'switch-commute',
      'never-burn-waste',
      'save-electricity',
    ]);
    expect(summary.perHousehold).toEqual({ co2KgPerYear: 963, pm25GPerYear: 1090 });
    expect(summary.total).toEqual({ co2KgPerYear: 9630, pm25GPerYear: 10900 });
    expect(summary.treesEquivalent).toBe(459);
  });

  it('handles households without transport actions', () => {
    expect(
      summariseCommunity([action('save-electricity', 'energy', 263, null)], 1).countedActionIds,
    ).toEqual(['save-electricity']);
  });
});

describe('Delhi-NCR GRAP policy', () => {
  it('maps NAQI to GRAP stages', () => {
    expect([150, 201, 300, 301, 401, 450, 451].map(grapStageFor)).toEqual([0, 1, 1, 2, 3, 3, 4]);
  });

  it('applies only in Delhi-NCR and only from "Poor" air', () => {
    const household = makeHousehold();
    expect(localPolicy(resolveRegion(MUMBAI), 420, household)).toBeNull();
    expect(localPolicy(resolveRegion(DELHI), 150, household)).toBeNull();
    expect(localPolicy(resolveRegion(DELHI), null, household)).toBeNull();
  });

  it('accumulates measures and explains what they mean for this family', () => {
    const family = makeHousehold({
      lifestyle: {
        ...makeHousehold().lifestyle,
        commuteMode: 'car_diesel',
        workFromHomePossible: true,
      },
    });
    const severe = localPolicy(resolveRegion(DELHI), 470, family);
    expect(severe?.stage).toBe(4);
    expect(severe?.measures).toHaveLength(12);
    expect(severe?.forYou.join(' ')).toMatch(/Sameer/);
    expect(severe?.forYou.join(' ')).toMatch(/Parking costs more/);
    expect(severe?.forYou.join(' ')).toMatch(/BS-IV diesel/);
    expect(severe?.forYou.join(' ')).toMatch(/school/);
    expect(severe?.forYou.join(' ')).toMatch(/working from home/);
    const poor = localPolicy(
      resolveRegion(DELHI),
      250,
      makeHousehold({ members: { adults: 2, children: 0, seniors: 0 } }),
    );
    expect(poor).toMatchObject({ stage: 1 });
    expect(poor?.forYou).toHaveLength(1);
    expect(poor?.note).toMatch(/caqm/i);
  });

  it('flows into the brief using the India NAQI even when the US scale is shown', () => {
    const smoggy = makeAir({ scale: 4 });
    const brief = buildBrief({
      location: DELHI,
      air: smoggy,
      weather: makeWeather(),
      household: makeHousehold(),
      standard: 'us',
    });
    expect(brief.standard.id).toBe('us');
    expect(brief.policy?.name).toMatch(/GRAP/);
    expect(brief.summary).toMatch(/GRAP Stage/);
    expect(brief.region.isDelhiNcr).toBe(true);
    expect(brief.community.households).toBe(1);
    const mumbai = buildBrief({
      location: MUMBAI,
      air: smoggy,
      weather: null,
      household: makeHousehold(),
      standard: 'auto',
    });
    expect(mumbai.policy).toBeNull();
  });
});
