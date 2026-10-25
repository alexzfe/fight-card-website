// Mirrors pipeline/src/fightcard/models.py. Keep in sync with docs/CONTRACT.md.
import { z } from 'astro/zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'expected ISO 8601 UTC with Z');

export const FinishTier = z.enum(['high', 'medium', 'low']);
export const EventStatus = z.enum(['upcoming', 'completed']);

export const Record = z.object({
  w: z.number().int().nonnegative().default(0),
  l: z.number().int().nonnegative().default(0),
  d: z.number().int().nonnegative().default(0),
  nc: z.number().int().nonnegative().default(0),
});

export const Fighter = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nickname: z.string().nullish(),
  record: Record.default({ w: 0, l: 0, d: 0, nc: 0 }),
  height_in: z.number().positive().nullish(),
  reach_in: z.number().positive().nullish(),
  stance: z.string().nullish(),
  dob: isoDate.nullish(),
  image: z.string().nullish(),
  details_fetched_at: isoTimestamp.nullish(),
});

export const Result = z.object({
  winner: z.string().nullish(),
  method: z.string().nullish(),
  round: z.number().int().positive().nullish(),
  time: z.string().nullish(),
});

export const Fight = z.object({
  id: z.string().min(1),
  weight_class: z.string().nullish(),
  title_fight: z.boolean().default(false),
  red: z.string().min(1),
  blue: z.string().min(1),
  finish_tier: FinishTier.nullish(),
  tier_frozen_at: isoTimestamp.nullish(),
  result: Result.nullish(),
});

export const Event = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lowercase URL slug'),
  name: z.string().min(1),
  date: isoDate,
  location: z.string().nullish(),
  status: EventStatus,
  fights: z.array(Fight),
});

export const ModelInfo = z.object({ as_of: isoDate, version: z.string() });

export const Index = z.object({
  generated_at: isoTimestamp,
  upcoming: z.array(z.string()),
  recent: z.array(z.string()),
  model: ModelInfo.nullish(),
});

export const Fighters = z.record(z.string(), Fighter);

export type FinishTier = z.infer<typeof FinishTier>;
export type Record = z.infer<typeof Record>;
export type Fighter = z.infer<typeof Fighter>;
export type Result = z.infer<typeof Result>;
export type Fight = z.infer<typeof Fight>;
export type Event = z.infer<typeof Event>;
export type Index = z.infer<typeof Index>;
