// Client-side mirror of the server validation in services/visit/schemas.py
// (StageLevelData._validate_level) — keep both rule lists in sync when
// changing either side. Gates the editor's Save/Test buttons and renders
// inline messages; the server remains the source of truth.

import type { StageLevelData } from "@/lib/types";

const HEIGHT = 16;
const MIN_WIDTH = 40;
const MAX_WIDTH = 200;
const MAX_ACTORS = 32;
const MAX_CHECKPOINTS = 4;
const SOLID_CHARS = new Set(["G", "D", "B", "S", "R"]);

export interface LevelValidation {
  ok: boolean;
  /** i18n keys (editor.err.*) — resolved by the editor UI via useT(). */
  errors: string[];
}

export function validateLevel(data: StageLevelData): LevelValidation {
  const errors: string[] = [];
  const push = (key: string) => {
    if (!errors.includes(key)) errors.push(key);
  };

  if (data.rows.length !== HEIGHT) push("editor.err.height");
  const width = data.rows[0]?.length ?? 0;
  if (width < MIN_WIDTH || width > MAX_WIDTH) push("editor.err.width");
  if (data.rows.some((r) => r.length !== width)) push("editor.err.height");

  const inBounds = (p: { x: number; y: number }) =>
    p.x >= 0 && p.x < width && p.y >= 0 && p.y < HEIGHT;

  if (!inBounds(data.spawn)) push("editor.err.spawnOob");
  if (!inBounds(data.goal)) push("editor.err.goalOob");

  // Spawn coords mean "the tile the player stands on" (bottom anchor) — the
  // player body (~2 tiles tall) above it must not be inside a solid tile.
  if (inBounds(data.spawn)) {
    for (const dy of [1, 2]) {
      const by = data.spawn.y - dy;
      if (by >= 0 && SOLID_CHARS.has(data.rows[by][data.spawn.x])) {
        push("editor.err.spawnHeadroom");
      }
    }
  }

  // The engine's clear check is overlap with a flag-pole tile — a stage
  // without one is unclearable, and therefore unpublishable.
  if (!data.rows.some((r) => r.includes("F"))) push("editor.err.noFlag");

  if (data.actors.length > MAX_ACTORS) push("editor.err.tooManyActors");
  const seen = new Set<string>();
  for (const a of data.actors) {
    if (seen.has(a.id)) push("editor.err.dupActorIds");
    seen.add(a.id);
    if (!inBounds(a)) push("editor.err.actorOob");
  }
  if (data.actors.filter((a) => a.type === "enemy_bear_boss").length > 1) {
    push("editor.err.tooManyBosses");
  }
  if (data.actors.filter((a) => a.type === "npc_tani").length > 1) {
    push("editor.err.tooManyNpcs");
  }

  if (
    data.checkpoints.length > MAX_CHECKPOINTS ||
    data.checkpoints.some((cp) => !inBounds(cp))
  ) {
    push("editor.err.checkpoints");
  }

  return { ok: errors.length === 0, errors };
}
