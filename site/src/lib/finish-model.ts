// What the explainer page says about the vendored finish model (model/README.md). Pinned to one export:
// tests/unit/finish-model.test.ts fails on a re-export until these are updated from model/*.json, and
// `importance` recomputed from model/model.txt (total gain per feature, grouped as below).

export const FINISH_MODEL = {
  version: '2026-10-14+5006318a',
  asOf: '2026-10-14',
  trainRows: 8340,
  trees: 300,
  lowMax: 0.42849160588727814,
  mediumMax: 0.5562006103940996,
  oos: {
    bouts: 4868,
    logLoss: 0.66533996802487,
    constantLogLoss: 0.6929762661705656,
  },
  tiers: {
    low: { bouts: 1623, finishRate: 0.36845348120764015, meanPredicted: 0.3477623155714053 },
    medium: { bouts: 1622, finishRate: 0.4796547472256473, meanPredicted: 0.4897490961492546 },
    high: { bouts: 1623, finishRate: 0.6241528034504005, meanPredicted: 0.646629215062592 },
  },
  /** Share of the model's total split gain (%), by feature group. */
  importance: [
    { group: 'How their fights usually end', share: 19.9, examples: 'decision rate, finish-win rate, how often finished' },
    { group: 'Bout context', share: 17.8, examples: 'weight class, venue, scheduled rounds, year' },
    { group: 'Grappling', share: 17.1, examples: 'takedowns, submission attempts, control time' },
    { group: 'Striking', share: 15.5, examples: 'strikes landed and absorbed, defence, knockdowns' },
    { group: 'Body and age', share: 12.8, examples: 'reach, height, age, stance' },
    { group: 'Experience and activity', share: 9.5, examples: 'minutes fought, layoff, career length' },
    { group: 'Form and strength', share: 7.4, examples: 'recent results, streaks, Elo, opponents’ Elo' },
  ],
} as const;
