import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINISH_MODEL } from '../../src/lib/finish-model';

// The explainer page quotes the vendored export's numbers. On a re-export these fail until
// src/lib/finish-model.ts is updated (importance included: recompute it from model/model.txt).
const model = (file: string) => JSON.parse(fs.readFileSync(new URL(`../../../model/${file}`, import.meta.url), 'utf8'));

describe('FINISH_MODEL matches the vendored export', () => {
  const thresholds = model('thresholds.json');
  const manifest = model('manifest.json');

  it('is for the same export', () => {
    expect(FINISH_MODEL.version).toBe(manifest.version);
    expect(FINISH_MODEL.asOf).toBe(manifest.as_of);
    expect(FINISH_MODEL.trainRows).toBe(manifest.train.rows);
  });
  it('quotes the tier cut points', () => {
    expect(FINISH_MODEL.lowMax).toBe(thresholds.low_max);
    expect(FINISH_MODEL.mediumMax).toBe(thresholds.medium_max);
  });
  it('quotes the out-of-sample evidence', () => {
    expect(FINISH_MODEL.oos.bouts).toBe(thresholds.oos.n);
    expect(FINISH_MODEL.oos.logLoss).toBe(thresholds.oos.log_loss);
    expect(FINISH_MODEL.oos.constantLogLoss).toBe(thresholds.oos.constant_log_loss);
    for (const t of ['low', 'medium', 'high'] as const) {
      expect(FINISH_MODEL.tiers[t]).toEqual({
        bouts: thresholds.tier_counts[t],
        finishRate: thresholds.tier_finish_rates[t],
        meanPredicted: thresholds.tier_mean_pred[t],
      });
    }
  });
  it('splits importance into shares that add up to 100%', () => {
    const total = FINISH_MODEL.importance.reduce((s, g) => s + g.share, 0);
    expect(total).toBeCloseTo(100, 0);
  });
});
