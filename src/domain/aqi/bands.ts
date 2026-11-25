import type { AqiCategory, PollutantId, StandardId } from '../types.js';

/** Shapes of an AQI standard's breakpoint tables, and helpers to build them from rows. */

export interface Band {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
}

export type ConcentrationUnit = 'ug/m3' | 'mg/m3' | 'ppb' | 'ppm';

export interface PollutantScale {
  unit: ConcentrationUnit;
  /** Concentrations are truncated to this many decimals before lookup (EPA rule). */
  decimals: number;
  bands: readonly Band[];
}

export interface CategoryDefinition extends AqiCategory {
  min: number;
  max: number;
}

export interface AqiStandard {
  id: StandardId;
  name: string;
  shortName: string;
  categories: readonly CategoryDefinition[];
  scales: Readonly<Record<PollutantId, PollutantScale>>;
}

export type Row = readonly [cLow: number, cHigh: number, iLow: number, iHigh: number];

/** A pair of range ends: a concentration range or an index range. */
export type Range = readonly [number, number];

/** Breakpoint rows as band objects. */
export const toBands = (rows: readonly Row[]): Band[] =>
  rows.map(([cLow, cHigh, iLow, iHigh]) => ({ cLow, cHigh, iLow, iHigh }));

/** Pair each concentration range with the index range at the same position (tables must match in length). */
export const withIndex = (concentrations: readonly Range[], index: readonly Range[]): Row[] =>
  concentrations.map(([cLow, cHigh], i) => {
    const range = index[i];
    if (!range) throw new Error('Breakpoint table and index table lengths differ');
    return [cLow, cHigh, range[0], range[1]] as const;
  });
