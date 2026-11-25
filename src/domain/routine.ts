import type { Household } from './household.js';
import type { CommuteComparison } from './impact/index.js';
import type { IndoorPlan } from './indoor.js';
import type { FamilyRisk } from './risk.js';
import type { SmogOutlook } from './smog.js';
import type { LocalTime, TimeWindow } from './types.js';

import {
  bedtimeStep,
  commuteStep,
  cookingStep,
  eveningStep,
  exerciseStep,
  playStep,
  ventilationStep,
} from './routineSteps.js';

export interface DayWindows {
  /** Cleanest 1-hour slot between 06:00 and 21:00 (exercise). */
  outdoor: TimeWindow | null;
  /** Cleanest 2-hour daytime slot (airing the home). */
  ventilation: TimeWindow | null;
  /** Cleanest 1-hour slot between 14:00 and 19:00 (children's play). */
  play: TimeWindow | null;
  /** Most polluted 3-hour block in the next 24 h. */
  worst: TimeWindow | null;
}

export type RoutineTag = 'exposure' | 'emissions' | 'indoor';

export interface RoutineStep {
  id: string;
  when: string;
  title: string;
  detail: string;
  /** The direct impact of following this step. */
  why: string;
  tags: RoutineTag[];
}

export interface RoutineInput {
  household: Household;
  risk: FamilyRisk;
  windows: DayWindows;
  smog: SmogOutlook;
  commute: CommuteComparison | null;
  indoor: IndoorPlan;
  /** Current local time of the reading. */
  now: LocalTime;
}

/** Assemble a time-ordered daily plan that lowers exposure and emissions. */
export function buildRoutine(input: RoutineInput): RoutineStep[] {
  const steps = [
    exerciseStep(input),
    commuteStep(input),
    ventilationStep(input),
    playStep(input),
    eveningStep(input),
    cookingStep(input),
    bedtimeStep(input),
  ];
  return steps.filter((s): s is RoutineStep => s !== null);
}
