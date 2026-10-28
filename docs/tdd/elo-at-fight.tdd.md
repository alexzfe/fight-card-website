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
6. As the operator, the site can deploy before the engine publishes 1.3: a `schema.json` older than 1.3 without
   `Fight.elo` is only a note in the contract check (`NEWER_FIELDS` in `src/lib/contract.ts`), while a 1.3 one is
   checked field by field (and, since the review fixes, a 1.3 or unversioned one without it is an error).

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

## Review fixes

From the PR #22 review (ecc:typescript-reviewer + ecc:code-reviewer; no critical or high; one medium, five low).
RED (`49dcae5`): vitest 9 failed / 245 passed; Playwright 1 failed / 75 passed. GREEN (`3090e04`): vitest 254
passed, Playwright 76 passed, `astro check` 0 errors. One test changed after RED: the aria snapshot's expected text
in the screen-reader test is now quoted (`- text: "Elo 1548 (up 26) · #4 P4P"`), because an unquoted ` #` starts a
YAML comment and cut the expected text short. What it asserts is unchanged, and it still fails without the fix.

- **S1 (medium): the contract relaxation expires.** `NEWER_FIELDS` is now `{ 'Fight.elo': '1.3' }`. A missing
  `Fight.elo` is only a note when the contract is older than 1.3. At 1.3 or later it is an error, and so it is when
  the version can't be read (fails closed). The version comes from `schema.json`'s title, `fightcard /v1 (contract
  1.2)`, not from index.json's `contract_version`. The title is in the file the check is given (`checkContract` and
  `validate-data` see only `schema.json`) and comes from the same engine build as the `$defs` it checks, so the two
  can't disagree. Versions compare part by part, so 1.10 is later than 1.3. `npm run validate-data` on the
  committed 1.2 `data/` still passes with the note.
- **S2 (low): the engine's real 1.3 schema.** `site/tests/fixtures/schema-1.3.json` replaces the hand-written
  `contract13()`. It is `fightcard.publish.build.schema()` from fightcard-engine `580d8d8` (PR #11, branch with
  `Fight.elo`), written with `json.dumps(schema(), indent=1)`. The pinned 1.2 `/v1/` fixture is unchanged.
  CONTRACT.md records where the file comes from. It passed the check at RED: the site already matched it.
- **S3 (low): an accessible change.** The signed change (`(−14)`) is `aria-hidden`, followed by the site's `sr-only`
  text `(down 14)` (`spokenDelta`: `up 26` / `down 14` / `no change`). What's shown is unchanged. The e2e tests
  check the visible text without the `sr-only` words, and check the aria snapshot (`Elo 1580 (down 26) · #12 P4P`).
- **S4 (low): no non-null assertion.** `eloAtFight`'s pre is `formatElo(…) ?? DASH`, as the file writes other
  unknowns.
- **S5 (low): docs.** ELO.md's Peak bullet says the tooltip shows it on upcoming and unrated fights. On a completed
  fight with Elo at the time, the tooltip explains the at-time number instead. ELO.md and CONTRACT.md describe the
  version gate.
- **S6 (low): test gaps.** In `f0000000000000d1` (the main event), the blue corner, Hugo Hotel, now has
  `blue_p4p_rank` 12, so a blue corner's past rank is shown unlinked: `Elo 1580 (−26) · #12 P4P`. A new completed
  fight, `f0000000000000d4`, is a no contest (Max Mike vs. Finn Foxtrot, `Overturned`, deltas 0) that shows
  `Elo 1502 (±0)`. The 360px test now checks that the main event's blue line is the longest at-time line on the
  page, that every line box of it stays inside the fight row, and that its `.who` doesn't overflow. The fight row
  is the bound because the large corner's `.who` is wider than its 100px corner by design, on both sides. These
  tests passed at RED, since the behaviour was already right: they fill coverage gaps. The finish-label test now
  expects four rows on Golf vs. Hotel.

| # | What is guaranteed | Test | Type | RED | GREEN |
|---|---|---|---|---|---|
| 9 | A contract older than 1.3 only notes `Fight.elo`; the engine's real 1.3 schema passes, and a `FightElo` type change is an error | `contract.test.ts › only notes a contract without Fight.elo…`, `› checks Fight.elo field by field against the 1.3 contract` | unit | PASS | PASS |
| 10 | A missing `Fight.elo` is an error at 1.3, 1.10 and 2.0 (and is no longer only a note) | `contract.test.ts › flags Fight.elo missing from %s…` ×3 | unit | FAIL | PASS |
| 11 | A missing `Fight.elo` is an error when there's no title, no version in the title, or an unreadable one | `contract.test.ts › flags Fight.elo missing from a contract with %s (fails closed)` ×3 | unit | FAIL | PASS |
| 12 | `spokenDelta`: `up 26`, `down 14`, `no change`; `eloAtFight` carries it | `format.test.ts › spokenDelta`, `› eloAtFight` ×2 | unit | FAIL | PASS |
| 13 | Screen readers hear `Elo 1548 (up 26) · #4 P4P`, `Elo 1580 (down 26) · #12 P4P`, `Elo 1471 (no change)` | `site.spec.ts › screen readers hear the at-time change in words…` | e2e | FAIL | PASS |
| 14 | The blue corner's `#12 P4P` and red's `#4`, `#7` are unlinked; the no contest shows `±0` | `site.spec.ts › a completed fight shows each corner's Elo at the time…` | e2e | PASS | PASS |
| 15 | At 360px the longest at-time line (the main event's blue corner) stays inside its row without overflowing | `site.spec.ts › no horizontal overflow at 360px` | e2e | PASS | PASS |

### Not acting

- `.positive()` on `*_pre`: Elo values are about 1000 to 2200 and the contract says integer, so no change.
- `provisional` / `inactive` tags next to the at-time Elo: a product call, kept as is until the user decides.
- `Fight.elo` changing between publishes: an engine concern, documented there (fightcard-engine CONTRACT.md / ELO.md).

```
$ cd site && npm test
      Tests  254 passed (254)

$ npm run test:e2e
  76 passed

$ npm run check
- 0 errors
```
