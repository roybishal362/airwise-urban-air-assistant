import { z } from 'zod';
import { householdSchema } from '../domain/household.js';

/**
 * Request contracts. Objects are strict (unknown keys rejected), strings are
 * length-bounded, and numbers are range-checked: the API trusts nothing.
 */

/** Letters (any script), digits, spaces and common place-name punctuation only. */
const PLACE_TEXT = /^[\p{L}\p{M}\p{N}\s.,'’()-]+$/u;
const PLACE_TEXT_MESSAGE = 'Use letters, numbers and basic punctuation only';

/**
 * Place names reach the GenAI prompt, so they are restricted to characters
 * that occur in real place names (no tags, quotes, braces or symbols).
 */
const placeText = (max: number) =>
  z.string().trim().min(1).max(max).regex(PLACE_TEXT, PLACE_TEXT_MESSAGE);

export const locationSchema = z.strictObject({
  name: placeText(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: placeText(80).optional(),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional(),
  region: placeText(80).optional(),
  timezone: z
    .string()
    .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/)
    .max(64)
    .optional(),
});

export const standardSchema = z.enum(['auto', 'us', 'in']);

export const briefRequestSchema = z.strictObject({
  location: locationSchema,
  standard: standardSchema.default('auto'),
  household: householdSchema,
});

export const chatRequestSchema = z.strictObject({
  location: locationSchema,
  standard: standardSchema.default('auto'),
  household: householdSchema,
  message: z.string().trim().min(1).max(600),
  history: z
    .array(z.strictObject({ role: z.enum(['user', 'assistant']), content: z.string().max(3000) }))
    .max(12)
    .default([]),
});

export const placesQuerySchema = z.object({
  q: z.string().trim().min(2).max(80).regex(PLACE_TEXT, PLACE_TEXT_MESSAGE),
});

export type BriefRequestBody = z.infer<typeof briefRequestSchema>;
export type ChatRequestBody = z.infer<typeof chatRequestSchema>;
