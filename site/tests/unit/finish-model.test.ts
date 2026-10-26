import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finishModel, IMPORTANCE_GROUPS } from '../../src/lib/finish-model';
import { Index } from '../../src/lib/schema';

// The explainer page quotes index.model, which `fightcard score` writes from the vendored export. A re-export
// needs no hand edits; a new importance group (a new feature theme in the pipeline) needs a label here.
const info = Index.parse(JSON.parse(fs.readFileSync(new URL('../fixtures/data/index.json', import.meta.url), 'utf8'))).model!;

describe('finishModel', () => {
  it('reads the export summary from index.model', () => {
    const m = finishModel(info);
    expect(m.version).toBe(info.version);
    expect(m.asOf).toBe(info.as_of);
    expect(m.trainRows).toBe(info.train_rows);
    expect(m.trees).toBe(info.trees);
    expect(m.lowMax).toBe(info.low_max);
    expect(m.mediumMax).toBe(info.medium_max);
    expect(m.oos).toEqual({
      bouts: info.oos!.bouts,
      logLoss: info.oos!.log_loss,
      constantLogLoss: info.oos!.constant_log_loss,
    });
    expect(m.tiers.high).toEqual({
      bouts: info.tiers!.high.bouts,
      finishRate: info.tiers!.high.finish_rate,
      meanPredicted: info.tiers!.high.mean_predicted,
    });
  });
  it('labels importance groups in the pipeline order', () => {
    const m = finishModel(info);
    expect(m.importance.map((g) => g.share)).toEqual(info.importance!.map((g) => g.share));
    expect(m.importance[0]).toEqual({ ...IMPORTANCE_GROUPS[info.importance![0]!.group], share: info.importance![0]!.share });
  });
  it('fails the build without a summary, or on a group it has no label for', () => {
    expect(() => finishModel({ as_of: '2026-10-14', version: 'v' })).toThrow(/summary/);
    expect(() => finishModel({ ...info, importance: [{ group: 'new_theme', share: 100 }] })).toThrow(/new_theme/);
    expect(() => finishModel(null)).toThrow(/summary/);
  });
  it('has a label for every group in the real data', () => {
    const real = JSON.parse(fs.readFileSync(new URL('../../../data/index.json', import.meta.url), 'utf8'));
    expect(() => finishModel(Index.parse(real).model)).not.toThrow();
  });
});
