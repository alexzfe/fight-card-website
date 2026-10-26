// The rating formula from docs/ELO.md, for the explainer page's charts and worked example.
// The pipeline's score stage (pipeline/src/fightcard/score/elo.py) is what computes the ratings on the cards.

export const ELO_START = 1500;
export const DECAY_PER_YEAR = 0.9;

/** The chance A beats B: 1 / (1 + 10^((Rb − Ra) / 400)). */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

/** K = 275 / (n + 5)^0.4, where n = the fighter's prior bouts. */
export function kFactor(n: number): number {
  return 275 / (n + 5) ** 0.4;
}

/** R = 1500 + (R − 1500) · 0.9^years, for years since the last bout. */
export function decay(rating: number, years: number): number {
  return ELO_START + (rating - ELO_START) * DECAY_PER_YEAR ** years;
}

/** A's change from one bout: K(n) · (W − E), with W = 1 win, 0.8 majority, 0.6 split, 0.5 draw, 0 loss. */
export function eloChange(ra: number, rb: number, n: number, w: number): number {
  return kFactor(n) * (w - expectedScore(ra, rb));
}
