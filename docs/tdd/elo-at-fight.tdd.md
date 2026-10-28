# TDD evidence: Elo at fight time on completed cards (Astro)

- **Source:** the 2026-10-28 Elo history plan. A completed card showed today's Elo and today's P4P rank next to an
  old result, which misleads. The engine (fightcard-engine#11, contract 1.3) now publishes `Fight.elo` on completed
  fights: each corner's Elo going in, the bout's own change and the P4P rank going in.
- **Branch:** `feat/elo-at-fight` (from `main`). Builds on the display in `elo-ui.tdd.md`.

## User journeys

1. As a visitor on a completed card, each corner reads `Elo 1612 (+26) · #4 P4P`: the Elo going into that fight, the
   change from it (muted, `+26` / `−14` / `±0`), and the P4P rank then.
2. As a visitor, that past rank isn't a link: `/rankings/` is today's list.
3. As a visitor, one short tip says what the numbers are: "Elo going into this fight, and the change from it". No
   other tooltip is added or removed (on these corners it stands in for the peak / best win tip, which describes
   today; Stats still lists both).
4. As a visitor, `provisional` / `inactive` and the Peak row are unchanged: they describe today.
5. As a visitor, a completed fight without `fight.elo`, and every upcoming fight, shows today's Elo and linked rank
   as before.
6. As the operator, the site can deploy before the engine publishes 1.3: a `schema.json` without `Fight.elo` is only
   a note in the contract check (`NEWER_FIELDS` in `src/lib/contract.ts`), while a 1.3 one is checked field by field.

## Checkpoint commits (on `feat/elo-at-fight`)

| Commit | Stage | Evidence |
|---|---|---|
| `1b24282` | RED | vitest: 13 failed / 234 passed (`Fight.elo` stripped by the schema ×4; `formatDelta`, `eloAtFight`, `AT_FIGHT_TIP` missing ×7; no `Fight.elo` note, and a 1.3 `FightElo` type change not flagged ×2). Playwright: 3 failed / 72 passed (the completed card shows no at-time Elo; no `elo-delta` in light or dark). |
| `8f7a2e2` | GREEN | `npm test` 247/247, `npm run test:e2e` 75/75, `astro check` 0 errors. No test changed after RED. |

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | `Fight.elo` parses the 1.3 shape; is optional and nullable; ranks may be missing or null; pre/delta must be integers (no `"1612"`, no 1612.5), ranks positive integers; each pre and delta is required | `tests/unit/schema.test.ts › Fight.elo` | unit |
| 2 | `formatDelta`: `+26`, `−14` (U+2212), `±0` | `tests/unit/format.test.ts › formatDelta` | unit |
| 3 | `eloAtFight` gives `Elo 1548` / `+26` / `#4 P4P` per corner, `rank: null` unranked, `null` without `fight.elo`; the tip text | `tests/unit/format.test.ts › eloAtFight` | unit |
| 4 | The pinned 1.2 contract only notes `Fight.elo`; a 1.3 contract passes and a `FightElo` type change is an error | `tests/unit/contract.test.ts › only notes a contract without Fight.elo…`, `› checks Fight.elo against a 1.3 contract` | unit |
| 5 | A completed card shows `Elo 1548 (+26) · #4 P4P`, `Elo 1580 (−26)`, and Ivan India's `1612 (−14) · #7 P4P` though he is 1640 today; no rank link; the one tip shows on hover; Hugo Hotel's `provisional` tag stays | `site.spec.ts › a completed fight shows each corner's Elo at the time…` | e2e |
| 6 | The change is muted text, lighter than the Elo, in light and dark | `site.spec.ts › the at-time change is quiet muted text (light)`, `(dark)` | e2e |
| 7 | The completed fight without `elo` shows today's `Elo 1531`, its `Peak 1604` tip and `inactive` tag, no change | `site.spec.ts › a completed fight without Elo at the time shows today's…` | e2e |
| 8 | Upcoming cards: no change shown, today's `Elo 1690 · #3 P4P` with its rankings link | `site.spec.ts › upcoming fights still show today's Elo…` (and the existing Elo tests) | e2e |

Fixture changes (`tests/fixtures/data`): `f0000000000000d1` and `…d2` gain `elo`; `…d3` (the draw) has none, for the
fallback. Ivan India gains today's `elo` 1640; Hugo Hotel `elo` 1555 and `elo_provisional`. The `/v1/` fixture stays
real 1.2 publish output.

## Commands and final output

```
$ cd site && npm test
      Tests  247 passed (247)

$ npm run test:e2e
  75 passed

$ npm run check
- 0 errors
```
