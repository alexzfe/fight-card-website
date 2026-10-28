# TDD evidence: form at fight time on completed cards (Astro)

- **Source:** the 2026-10-28 past-event redesign, step 3 of 3. Step 1 (`past-event-ui.tdd.md`, PR #23) hid the form
  tiles on completed fights, since `recent_fights` is today's. Step 2 (fightcard-engine#12, contract 1.4) publishes
  `Fight.form`: each corner's last results strictly before the fight.
- **Branch:** `feat/form-at-fight` (from `main`).

## User journeys

1. As a visitor on a past card, each corner's tiles show the form that fighter brought into the fight (`L W`), with
   the same tips as on an upcoming card, and Stats lists the same fights.
2. As a visitor, a fighter making their debut (an empty list) shows no tiles.
3. As a visitor, a completed fight without `Fight.form` (data before 1.4) shows no tiles and no Stats list, never
   today's. Before this, Stats still listed today's last fights on completed cards.
4. As the operator, the site can deploy before the engine's 1.4 data: the contract check only notes `Fight.form`
   missing from an older `schema.json` (`NEWER_FIELDS`), and from 1.4 on a missing one is an error.

## Checkpoint commits (on `feat/form-at-fight`)

| Commit | Stage | Evidence |
|---|---|---|
| `fe6b140` | RED | vitest: 6 failed / 254 passed (`Fight.form` stripped by the schema ×2; not noted before 1.4, not checked against the real 1.4 schema, not flagged missing from 1.4 or later ×4). Playwright: 2 failed / 82 passed (no tiles from `Fight.form`; the winner-only bout's Stats listed today's last fights). |
| `0fa8739` | GREEN | `npm test` 260/260, `npm run test:e2e` 84/84, `astro check` 0 errors. No test changed after RED. |

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | `Fight.form` parses `{red, blue}` of `PastFight`; optional, nullable; both corners required | `tests/unit/schema.test.ts › Fight.form` | unit |
| 2 | The pinned 1.2 and the engine's 1.3 schemas only note `Fight.form` | `contract.test.ts › only notes a contract without Fight.form…` | unit |
| 3 | The engine's real 1.4 schema (`tests/fixtures/schema-1.4.json`, fightcard-engine 62eecd6) passes with no notes on `Fight.elo` / `Fight.form`; a `FightForm.red` type change is an error | `contract.test.ts › checks Fight.form field by field…` | unit |
| 4 | `Fight.form` missing from 1.4 or a later contract is an error | `contract.test.ts › flags Fight.form missing from…` | unit |
| 5 | Golf vs. Hotel's main event: Gus Golf's tiles `L W` (aria `Last 2: loss, win`, tip `Max Mike · SUB R2 · Jul 2026`), none for the debut corner, Stats lists the same two | `site.spec.ts › a completed fight shows each corner's form going into it…` | e2e |
| 6 | The winner-only bout (no `Fight.form`) shows no tiles and no Stats list though Gus Golf has today's form | `site.spec.ts › a completed fight without its form going in shows none…` | e2e |
