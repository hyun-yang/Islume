# 🚀 Project Progress Tracker

## 📊 Overview

* **Project:** Islume Stage Editor (Super Mario Maker style)
* **Current Milestone:** Game Map Editor MVP
* **Overall Status:** 🟢 On Track
* **Last Updated:** 2026-06-11
* **Branch:** `feature/game-map`
* **Plan:** see the approved plan (Phase 1–7) — each user authors up to 3 platformer stages for their island; visitors play the host's published stages with built-in stage1–3 as fallback.

---

## 📋 Task Board

### ⏳ To Do (Backlog)

- [ ] **Phase 4 — Editor MVP:** `frontend/components/stage-editor/` — `editorState.ts` (pure TS + undo/redo), `levelValidation.ts`, `EditorCanvas.tsx` (PixiJS paint), `EditorPalette.tsx`, `StageEditorView.tsx` (slot tabs, toolbar), entry via ProfilePanel + `viewMode === "editor"`.
- [ ] **Phase 5 — Test play + clear/publish loop:** `StageTestPlay.tsx` on the extracted runtime; auto-save before test; clear → `POST cleared`; publish gated on `cleared && !dirty`.
- [ ] **Phase 6 — Visitor integration:** fetch host's published stages in `IslandPlatformerView`, `stages[] + stageIndex` replaces `STAGE_DATA`/`NEXT_STAGE`, last-index final-stage detection (RPS/chat unlock), built-in fallback on empty/error.
- [ ] **Phase 7 — i18n + gates:** `editor.*` keys in en/ko/ja, `npm run lint` + `tsc` + `knip` + `uv run pytest tests/`.

### 🚧 In Progress

- [ ] **Phase 3 — Engine extraction:** move the Pixi init/loop/cleanup from `IslandPlatformerView.tsx` verbatim into `PlatformerGameRuntime.ts` (`createPlatformerRun`). Behavior-preserving; verify built-in stage1→3 full play.

### 🛑 Blocked / Waiting

*(none)*

### ✅ Completed

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
* **Next Steps:** Phase 3 — engine extraction (`createPlatformerRun` in `PlatformerGameRuntime.ts`), behavior-preserving, own commit, verified by built-in stage1→3 full play.

### 2026-06-10

* **Updates:** Analyzed the current platformer (3 hardcoded JSON stages shared by every island; no backend level API). Confirmed requirements via Q&A: Mario-Maker-style clear verification, built-in fallback for islands without custom stages, fixed height 16 / adjustable width 40–200, full tile+actor palette. Implementation plan approved (Phases 1–7); created this tracker.
* **Phase 1 done:** backend complete and verified (migration applied to local DB, full pytest suite 100 passed, live smoke test 14/14). Deviation from plan: checkpoints are allowed (≤4, in-bounds) instead of forced-empty — built-in stage1.json has one and must pass the round-trip guard; the editor still won't place them. Spawn validation is a headroom check (spawn coords mean "tile the player stands on", so the spawn tile itself may be solid).
* **Next Steps:** Phase 2 — frontend plumbing (`id: string` widening, `encodeRows()`, API fns, `useIslandStages` hook), gated by `npx tsc --noEmit`.
