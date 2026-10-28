// The site's reading of the engine's /v1/ contract (its models.py, published as /v1/schema.json), also accepting the
// pipeline's data/. src/lib/contract.ts checks it against schema.json (docs/CONTRACT.md, "Checking the contract").
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

// A completed fight's Elo at the time (contract 1.3), on the same displayed scale as Fighter.elo.
export const FightElo = z.object({
  red_pre: z.number().int(), // Elo going into the fight
  red_delta: z.number().int(), // that fight's own signed change; 0 for a no contest
  blue_pre: z.number().int(),
  blue_delta: z.number().int(),
  red_p4p_rank: z.number().int().positive().nullish(), // P4P rank going in; null = unranked
  blue_p4p_rank: z.number().int().positive().nullish(),
});

// A completed fight's form at the time (contract 1.4): each corner's last results before it, newest first, at most 3;
// empty for a debut.
export const FightForm = z.object({
  red: z.array(PastFight),
  blue: z.array(PastFight),
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
  elo: FightElo.nullish(), // contract 1.3; null/absent on upcoming and unrated fights
  form: FightForm.nullish(), // contract 1.4; null/absent on upcoming fights
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

// data/rankings.json (the engine's /v1/rankings.json, contract 1.2+); optional, so older data still validates.
const P4pEntry = z.object({
  rank: z.number().int().positive(), // 1..n within its list
  id: z.string().min(1),
  name: z.string().min(1),
  elo: z.number().int(),
  division: z.string().nullable(), // weight class of the latest bout; null = none
  image: z.string().nullable(), // path relative to data/; only P4P entries carry one
});

const ActiveEntry = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  elo: z.number().int(),
  division: z.string().nullable(),
  p4p_rank: z.number().int().positive().nullable(), // rank within the men's or women's list; null = unranked
  provisional: z.boolean().default(false), // fewer than 3 UFC bouts
});

export const Rankings = z.object({
  as_of: isoDate, // the day the ratings are decayed to
  p4p: z.object({ men: z.array(P4pEntry), women: z.array(P4pEntry) }), // top 15 / top 10, by rank
  active: z.array(ActiveEntry), // a UFC bout in the last 365 days, best Elo first
});

export type FinishTier = z.infer<typeof FinishTier>;
export type CardSegment = z.infer<typeof CardSegment>;
export type PastResult = z.infer<typeof PastResult>;
export type Outcome = z.infer<typeof Outcome>;
export type PastFight = z.infer<typeof PastFight>;
export type BestWin = z.infer<typeof BestWin>;
export type Record = z.infer<typeof Record>;
export type Fighter = z.infer<typeof Fighter>;
export type Result = z.infer<typeof Result>;
export type FightElo = z.infer<typeof FightElo>;
export type FightForm = z.infer<typeof FightForm>;
export type Fight = z.infer<typeof Fight>;
export type Event = z.infer<typeof Event>;
export type Index = z.infer<typeof Index>;
export type ModelInfo = z.infer<typeof ModelInfo>;
export type P4pEntry = z.infer<typeof P4pEntry>;
export type ActiveEntry = z.infer<typeof ActiveEntry>;
export type Rankings = z.infer<typeof Rankings>;
