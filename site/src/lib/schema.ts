// Mirrors pipeline/src/fightcard/models.py. Keep in sync with docs/CONTRACT.md.
import { z } from 'astro/zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'expected ISO 8601 UTC with Z');

export const FinishTier = z.enum(['high', 'medium', 'low']);
export const CardSegment = z.enum(['main', 'prelims', 'early_prelims']);
export const EventStatus = z.enum(['upcoming', 'completed']);
export const PastResult = z.enum(['win', 'loss', 'draw', 'nc']);

export const Record = z.object({
  w: z.number().int().nonnegative().default(0),
  l: z.number().int().nonnegative().default(0),
  d: z.number().int().nonnegative().default(0),
  nc: z.number().int().nonnegative().default(0),
});

export const PastFight = z.object({
  result: PastResult,
  opponent: z.string().min(1),
  opponent_id: z.string().nullish(),
  method: z.string().nullish(),
  round: z.number().int().positive().nullish(),
  time: z.string().nullish(),
  event: z.string(),
  date: isoDate.nullish(),
});

export const BestWin = z.object({
  opponent_id: z.string().min(1),
  opponent: z.string().min(1),
  elo: z.number().int(), // the opponent's Elo going into that bout
  date: isoDate,
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
  recent_fights: z.array(PastFight).nullish(), // newest first, at most 3
  elo: z.number().int().nullish(), // current Elo, re-anchored; null = unknown
  elo_peak: z.number().int().nullish(), // highest Elo after the 5th UFC bout; null = none yet
  p4p_rank: z.number().int().positive().nullish(), // pound-for-pound rank; null = unranked
  elo_provisional: z.boolean().default(false), // fewer than 3 UFC bouts
  elo_inactive: z.boolean().default(false), // no bout in the last 12 months
  best_win: BestWin.nullish(), // the beaten opponent rated highest going into the bout; null = no win
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
  segment: CardSegment.nullish(), // null = unknown; the site shows no heading
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
export type CardSegment = z.infer<typeof CardSegment>;
export type PastResult = z.infer<typeof PastResult>;
export type PastFight = z.infer<typeof PastFight>;
export type BestWin = z.infer<typeof BestWin>;
export type Record = z.infer<typeof Record>;
export type Fighter = z.infer<typeof Fighter>;
export type Result = z.infer<typeof Result>;
export type Fight = z.infer<typeof Fight>;
export type Event = z.infer<typeof Event>;
export type Index = z.infer<typeof Index>;
