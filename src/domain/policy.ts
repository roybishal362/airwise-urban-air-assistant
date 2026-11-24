import type { Household } from './household.js';
import type { Region } from './region.js';

/**
 * Delhi-NCR's Graded Response Action Plan (GRAP), run by the Commission for
 * Air Quality Management (CAQM), escalates city-wide anti-smog measures by
 * India NAQI band. Families feel these rules directly (school closures,
 * vehicle restrictions, work-from-home orders), so AirWise explains which
 * stage today's air corresponds to and what it means for this household.
 *
 * Stages are formally invoked by CAQM orders based on Delhi's daily average
 * AQI and forecasts; we show the stage the current reading corresponds to and
 * always point users to the official order.
 */

export type GrapStage = 0 | 1 | 2 | 3 | 4;

export interface LocalPolicy {
  name: string;
  stage: Exclude<GrapStage, 0>;
  stageLabel: string;
  /** India NAQI used to determine the stage. */
  naqi: number;
  /** City-wide measures that typically apply at this stage (cumulative). */
  measures: string[];
  /** What those measures mean for this particular household. */
  forYou: string[];
  note: string;
}

const STAGE_LABELS: Readonly<Record<Exclude<GrapStage, 0>, string>> = {
  1: "Stage I – 'Poor' (NAQI 201–300)",
  2: "Stage II – 'Very Poor' (NAQI 301–400)",
  3: "Stage III – 'Severe' (NAQI 401–450)",
  4: "Stage IV – 'Severe+' (NAQI above 450)",
};

const STAGE_MEASURES: Readonly<Record<Exclude<GrapStage, 0>, readonly string[]>> = {
  1: [
    'Dust control at construction sites and on roads',
    'Open burning of garbage and leaves banned',
    'Strict checks on visibly polluting vehicles',
  ],
  2: [
    'Diesel generator use restricted',
    'Higher parking fees to discourage private cars',
    'Extra metro and CNG/electric bus services',
  ],
  3: [
    'Non-essential construction and demolition halted',
    'BS-III petrol and BS-IV diesel four-wheelers restricted',
    'Primary classes may move to hybrid or online mode',
  ],
  4: [
    'Non-essential trucks barred from entering Delhi',
    'Offices may run at 50% attendance with the rest working from home',
    'Schools may shift classes online',
  ],
};

export function grapStageFor(naqi: number): GrapStage {
  if (naqi > 450) return 4;
  if (naqi > 400) return 3;
  if (naqi > 300) return 2;
  if (naqi > 200) return 1;
  return 0;
}

function personalImplications(stage: Exclude<GrapStage, 0>, household: Household): string[] {
  const { commuteMode, workFromHomePossible } = household.lifestyle;
  const drivesFuelCar = commuteMode === 'car_petrol' || commuteMode === 'car_diesel';
  const forYou = [
    'Burning leaves or garbage is banned: report it on the Green Delhi or CPCB Sameer app.',
  ];
  if (stage >= 2 && (drivesFuelCar || commuteMode === 'car_cng')) {
    forYou.push('Parking costs more and extra metro and bus services run: a good week to switch.');
  }
  if (stage >= 3 && drivesFuelCar) {
    forYou.push(
      "Check your car's emission norm: older BS-III petrol and BS-IV diesel cars may be barred.",
    );
  }
  if (stage >= 3 && household.members.children > 0) {
    forYou.push("Watch for your school's notice: classes may move to hybrid or online mode.");
  }
  if (stage >= 4 && workFromHomePossible) {
    forYou.push(
      'Ask your employer about working from home: offices may be told to halve attendance.',
    );
  }
  return forYou;
}

/** GRAP context for Delhi-NCR families; `null` elsewhere or when air is better than 'Poor'. */
export function localPolicy(
  region: Region,
  naqi: number | null,
  household: Household,
): LocalPolicy | null {
  if (!region.isDelhiNcr || naqi === null) return null;
  const stage = grapStageFor(naqi);
  if (stage === 0) return null;
  const measures: string[] = [];
  for (let s = 1; s <= stage; s += 1) measures.push(...STAGE_MEASURES[s as Exclude<GrapStage, 0>]);
  return {
    name: 'Delhi-NCR Graded Response Action Plan (GRAP)',
    stage,
    stageLabel: STAGE_LABELS[stage],
    naqi,
    measures,
    forYou: personalImplications(stage, household),
    note: 'Stages are invoked by CAQM orders based on the daily average; check caqm.nic.in for the order in force.',
  };
}
