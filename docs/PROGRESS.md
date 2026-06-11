# 🚀 Project Progress Tracker

## 📊 Overview

* **Project:** Islume Stage Editor (Super Mario Maker style)
* **Current Milestone:** Game Map Editor MVP — **complete** (Phases 0–7)
* **Overall Status:** ✅ Done (pending final human play-through)
* **Last Updated:** 2026-06-11
* **Branch:** `feature/game-map`
* **Plan:** see the approved plan (Phase 1–7) — each user authors up to 3 platformer stages for their island; visitors play the host's published stages with built-in stage1–3 as fallback.

---

## 📋 Task Board

### ⏳ To Do (Backlog)

*(empty)*

### 🚧 In Progress

*(none)*

### 🛑 Blocked / Waiting

*(none)*

### ✅ Completed

- [x] **Post-milestone fix round 1 (user play-through feedback):** (1) Editor canvas now zooms the 16-tile strip to fill the viewport height (the dead sky/sand bands above and below the map are gone) and gained horizontal navigation: wheel scroll, Space/middle-drag pan, arrow keys, plus an on-canvas hint. (2) Actor coordinate convention unified to "y = tile the actor occupies" — ground-anchored actors (crab, starfish, frog, log, lily, whale, bear, tani, coconut block) now stand at `(y+1)*TILE` instead of floating one tile up; built-in stage JSONs migrated (y−1, net pixel change zero). (3) A log without an explicit `walk_range` patrols only the contiguous water span beneath it, inset by its half-width (stationary if not over water). Verified live: Quinn's 18-actor stage in editor test play — all actors grounded, log bounces exactly at the water edges.
- [x] **Phase 7 — i18n + gates:** i18n was added per-phase; key sets verified identical across en/ko/ja (60 `editor.*` keys). Gates: `tsc` 0 errors; `lint` 6 pre-existing errors only (none in feature files); `knip` reports only the two pre-existing `@deprecated` exports (`fetchVisit`, `fetchRpsRound` — intentionally retained); `pytest` 100 passed. Cleanup: un-exported `PlatformerRunCallbacks` (internal-only).
- [x] **Phase 6 — Visitor integration:** `IslandPlatformerView` fetches the host's published stages (`useIslandStages(activeVisitHostId, true)`); `stages[] + stageIndex` replaced `STAGE_DATA`/`NEXT_STAGE`/`currentStage`; final stage = last index (drives `sendArrive`, EndingDialog `isFinalStage`, RPS unlock); built-ins on empty list or fetch error (the feature never blocks a visit); `stages === null` while loading so the game never starts on the wrong set; custom-stage BGM mapped from background. Verified in the browser: Bob visiting Alice (1 published custom stage) → custom flat level played, clearing it (first == last) showed the arrival dialog with Start chat + Play RPS and unlocked chat; Bob visiting Kate (0 published) → built-in "Stage 1: Sunny Beach" fallback.
- [x] **Phase 5 — Test play + clear/publish loop:** `StageTestPlay.tsx` runs the author's level on `createPlatformerRun` (HUD + cleared/game-over overlays only; BGM mapped from background; ESC exits). Test = validate → auto-save → play; the save is skipped only when `!dirty && stage` (server already holds exactly this content), preserving the "cleared an old version" race block. `onCleared` fires once → `POST cleared`; Publish enables on `cleared && !dirty`. Verified end-to-end in the browser: Test → auto-save (draft/uncleared) → flag reached → "Stage cleared!" overlay → `cleared=True` in DB → back to editor → Publish enabled → `status=published` + stage appears in `?published=true`.
- [x] **Phase 4 — Editor MVP:** `stage-editor/` — `EditorModel` (pure TS, mutable model + 20-deep undo/redo snapshots; paint strokes never trigger per-tile React renders), `levelValidation.ts` (client mirror of `services/visit/schemas.py`, returns `editor.err.*` i18n keys), `EditorCanvas.tsx` (PlatformerRenderer reuse over a live LevelMap view sharing the model's Uint8Array; grid/spawn-marker/actor-ghost/hover overlays synced by version counter; arrow-key + middle-drag pan; palette thumbnails extracted once via `renderer.extract.base64`), `EditorPalette.tsx`, `StageEditorView.tsx` (slot tabs with 🟢/⭐/📝 badges, name/width/background controls, Save/Test/Publish/Unpublish/Delete/Exit, dirty tracking, delete-confirm dialog), entry via ProfilePanel button + `viewMode === "editor"` fullscreen branch, `editor.*` i18n keys in en/ko/ja. Verified: tsc + lint clean; browser smoke — entry, paint, dirty indicator, Save→backend row (draft/uncleared, tiles match), undo, slot-switch with discard confirm + badges, Exit. Test button is rendered disabled until Phase 5.
- [x] **Phase 3 — Engine extraction:** `createPlatformerRun()` in `PlatformerGameRuntime.ts` — Pixi init/loop/cleanup moved verbatim; runtime owns run state (hp/shells/lives/goal/checkpoint) and mirrors via callbacks; `initialShells`/`initialLives` preserve cross-stage carry-over; level compiled inside async init so malformed data flows through `onError`. Side fix: TouchInput's render-time `inputRef.current` read (latent `react-hooks/refs` violation, previously masked because the giant effect made the component unanalyzable) replaced with `gameInput` state. Verified: `tsc` 0 errors, lint clean for touched files, manual full play stage1→3 (HUD, V toggle, damage/collect, death/respawn, game-over retry, shell/lives carry-over on stage transition, final-stage chat/RPS unlock, ESC leave + re-enter) all passed.
- [x] **Phase 2 — Frontend plumbing:** `LevelData.id`/`LevelMap.id` widened to `string` (no ripple — `tsc` clean), `encodeRows()` + reverse legend, `ActorType`/`Background` exported, `VisitViewMode` + `"editor"`, `IslandStage`/`StageLevelData` types, 6 stage API fns in `lib/api.ts`, `useIslandStages.ts` hooks (query key `["islandStages", islandId, publishedOnly]` + invalidate-by-prefix mutations). Gate passed: `npx tsc --noEmit` 0 errors; lint errors unchanged (6 pre-existing, none in touched files).
- [x] **Phase 1 — Backend:** `island_stages` table + migration `0620ab77cd88`, level-data validation schemas, 6 stage endpoints (list/save/cleared/publish/unpublish/delete). 21 unit tests + 14/14 live endpoint smoke checks passed (state machine verified: save resets to draft/uncleared, publish 409s without clear, unpublish keeps cleared).
- [x] **Phase 0 — Progress tracker:** created this document; plan approved (clear-to-publish required, built-in fallback, width 40–200, full element palette).

---

## 🐛 Active Bugs / Issues

| Issue ID | Description | Severity | Status |
| :--- | :--- | :--- | :--- |
| SEC-1 | IDOR on stage endpoints — no auth, anyone can save/publish/delete any island's stages (flagged HIGH by automated security review). Same class as the documented system-wide no-auth MVP gap (CLAUDE.md "What is NOT in MVP"); to be fixed in the single system-wide auth PR, not per-endpoint. | High | Accepted (MVP gap) |

---

## 📝 Daily Log

### 2026-06-11

* **Phase 2 done:** frontend plumbing complete. The `id: StageId → string` widening produced zero tsc errors (built-in `STAGE_DATA` keys stay `StageId`-typed; `startBgm` call sites use the separately-typed `currentStage` state, so no ripple). Logged SEC-1 (stage-endpoint IDOR) as an accepted MVP gap per the system-wide-auth-PR policy.
* **Phase 3 done:** engine extracted to `PlatformerGameRuntime.ts`; manual stage1→3 full-play regression passed (user-verified, all 10 checklist items including shell/lives carry-over and final-stage unlock). Two design notes: (a) runtime owns hp/shells/lives — React state became a HUD mirror, so the stale-closure workarounds in the old loop disappeared; (b) carry-over across stages is seeded via `initialShells`/`initialLives` opts from refs.
* **Phase 4 done:** editor MVP complete and smoke-tested in the browser (entry → paint → save → backend verified end-to-end; the state machine resets to draft/uncleared on save as designed). Known cosmetic nit: the banana palette thumbnail extracts dark — texture renders fine in-game; revisit if it bothers anyone.
* **Phase 5 done:** full Mario-Maker loop verified live in the browser (automated: held ArrowRight across the default flat stage to the flag). Note for future testing: `KeyboardInput` reads `e.code`, not `e.key` — synthetic key events must set `code`. Alice's slot-1 stage is left published in the local DB as the fixture for Phase 6 visitor testing.
* **Phase 6 done:** visitor integration verified in the browser (custom-1-stage island → final-stage unlock on its only stage; 0-published island → built-in fallback). Testing note: in the headless browser the map's island layer can stay empty — MapLibre's glyph fetches 404 there, `isStyleLoaded()` stays false after `load` already fired, so the deferred `setData` never runs; re-triggering the effect (switch user away/back) repopulates it. Not reproducible in a real browser; logged in case it shows up in CI later.
* **Phase 7 done — milestone complete.** All gates green. Remaining for a human: a free-form play-through of the full loop (build a real stage with enemies/platforms, clear, publish, visit from the second browser) before merging to main.
* **Fix round 1 (from the user's play-through):** four issues fixed — editor couldn't reach off-screen map (added wheel scroll / Space+drag / arrows + hint overlay), editor showed dead bands above/below the 16-tile strip (fit-height zoom), ground actors floated one tile up in-game (editor stores the *occupied* tile but `ActorManager` treated y as the *supporting* tile — engine switched to the occupied-tile convention, built-in JSONs migrated y−1 so their pixels are unchanged, and stored custom stages are fixed automatically), and default-range logs drifted out of their pond (`logWaterRange` clamps the patrol to the contiguous water span minus the log's half-width). Gates: tsc 0, lint/knip at baseline, pytest 100. Verified in-browser on Quinn's stage.

### 2026-06-10

* **Updates:** Analyzed the current platformer (3 hardcoded JSON stages shared by every island; no backend level API). Confirmed requirements via Q&A: Mario-Maker-style clear verification, built-in fallback for islands without custom stages, fixed height 16 / adjustable width 40–200, full tile+actor palette. Implementation plan approved (Phases 1–7); created this tracker.
* **Phase 1 done:** backend complete and verified (migration applied to local DB, full pytest suite 100 passed, live smoke test 14/14). Deviation from plan: checkpoints are allowed (≤4, in-bounds) instead of forced-empty — built-in stage1.json has one and must pass the round-trip guard; the editor still won't place them. Spawn validation is a headroom check (spawn coords mean "tile the player stands on", so the spawn tile itself may be solid).
* **Next Steps:** Phase 2 — frontend plumbing (`id: string` widening, `encodeRows()`, API fns, `useIslandStages` hook), gated by `npx tsc --noEmit`.
