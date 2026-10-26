// What the explainer page says about the vendored finish model. The numbers come from index.model, which
// `fightcard score` writes from model/ (pipeline/src/fightcard/score/summary.py), so a re-export needs no edits
// here. Only the theme labels live here: a new theme in the pipeline fails the build until it has one.
import type { ModelInfo } from './schema';

export const IMPORTANCE_GROUPS: { [key: string]: { group: string; examples: string } } = {
  fight_endings: { group: 'How their fights usually end', examples: 'decision rate, finish-win rate, how often finished' },
  context: { group: 'Bout context', examples: 'weight class, venue, scheduled rounds, year' },
  grappling: { group: 'Grappling', examples: 'takedowns, submission attempts, control time' },
  striking: { group: 'Striking', examples: 'strikes landed and absorbed, defence, knockdowns' },
  physical: { group: 'Body and age', examples: 'reach, height, age, stance' },
  experience: { group: 'Experience and activity', examples: 'minutes fought, layoff, career length' },
  form: { group: 'Form and strength', examples: 'recent results, streaks, Elo, opponents’ Elo' },
};

const TIERS = ['low', 'medium', 'high'] as const;

export function finishModel(info: ModelInfo | null | undefined) {
  const { train_rows, trees, low_max, medium_max, oos, tiers, importance } = info ?? {};
  if (!info || train_rows == null || trees == null || low_max == null || medium_max == null || !oos || !tiers || !importance) {
    throw new Error('index.model has no export summary: run `fightcard score` on this data');
  }
  return {
    version: info.version,
    asOf: info.as_of,
    trainRows: train_rows,
    trees,
    lowMax: low_max,
    mediumMax: medium_max,
    oos: { bouts: oos.bouts, logLoss: oos.log_loss, constantLogLoss: oos.constant_log_loss },
    tiers: Object.fromEntries(
      TIERS.map((t) => [t, { bouts: tiers[t].bouts, finishRate: tiers[t].finish_rate, meanPredicted: tiers[t].mean_predicted }]),
    ) as { [T in (typeof TIERS)[number]]: { bouts: number; finishRate: number; meanPredicted: number } },
    /** Share of the model's total split gain (%), by feature theme, largest first. */
    importance: importance.map(({ group, share }) => {
      const label = IMPORTANCE_GROUPS[group];
      if (!label) throw new Error(`no label for importance group "${group}" in src/lib/finish-model.ts`);
      return { ...label, share };
    }),
  };
}
