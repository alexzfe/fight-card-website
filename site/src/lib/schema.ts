// Mirrors pipeline/src/fightcard/models.py. Keep in sync with docs/CONTRACT.md.
import { z } from 'astro/zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'expected ISO 8601 UTC with Z');

export const FinishTier = z.enum(['high', 'medium', 'low']);
export const CardSegment = z.enum(['main', 'prelims', 'early_prelims']);
export const EventStatus = z.enum(['upcoming', 'completed']);
export const PastResult = z.enum(['win', 'loss', 'draw', 'nc']);
export const Outcome = z.enum(['win', 'draw', 'nc']);

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
  outcome: Outcome.nullish(), // /v1/ only: tells a draw from a no contest (winner is null for both)
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

const TierStats = z.object({ bouts: z.number().int(), finish_rate: z.number(), mean_predicted: z.number() });

// The export summary (pipeline/src/fightcard/score/summary.py) is optional so older data still validates;
// the how-it-works page requires it (lib/finish-model.ts).
export const ModelInfo = z.object({
  as_of: isoDate,
  version: z.string(),
  train_rows: z.number().int().nullish(),
  trees: z.number().int().nullish(),
  low_max: z.number().nullish(),
  medium_max: z.number().nullish(),
  oos: z.object({ bouts: z.number().int(), log_loss: z.number(), constant_log_loss: z.number() }).nullish(),
  tiers: z.object({ low: TierStats, medium: TierStats, high: TierStats }).nullish(),
  importance: z.array(z.object({ group: z.string(), share: z.number() })).nullish(),
});

export const Index = z.object({
  generated_at: isoTimestamp,
  upcoming: z.array(z.string()),
  recent: z.array(z.string()),
  model: ModelInfo.nullish(),
  contract_version: z.string().regex(/^\d+(\.\d+)*$/, 'expected a version like "1" or "1.2"').nullish(), // /v1/ only
});

export const Fighters = z.record(z.string(), Fighter);

export type FinishTier = z.infer<typeof FinishTier>;
export type CardSegment = z.infer<typeof CardSegment>;
export type PastResult = z.infer<typeof PastResult>;
export type Outcome = z.infer<typeof Outcome>;
export type PastFight = z.infer<typeof PastFight>;
export type BestWin = z.infer<typeof BestWin>;
export type Record = z.infer<typeof Record>;
export type Fighter = z.infer<typeof Fighter>;
export type Result = z.infer<typeof Result>;
export type Fight = z.infer<typeof Fight>;
export type Event = z.infer<typeof Event>;
export type Index = z.infer<typeof Index>;
export type ModelInfo = z.infer<typeof ModelInfo>;
