// Palette definitions shared by EditorPalette (buttons) and EditorCanvas
// (thumbnail extraction + ghost sprites). Flag tiles (F/T) are deliberately
// absent — the goal tool stamps the whole structure to keep the goal unique.

import {
  TILE_PF_GROUND, TILE_PF_GROUND_INNER, TILE_PF_PLATFORM, TILE_PF_BRICK,
  TILE_PF_WATER, TILE_PF_SAND, TILE_PF_ROCK, TILE_PF_CLOUD, TILE_PF_BUSH,
  type ActorType,
} from "@/lib/platformer/types";

export type EditorTool =
  | { kind: "tile"; tile: number }
  | { kind: "actor"; actorType: ActorType }
  | { kind: "eraser" }
  | { kind: "spawn" }
  | { kind: "goal" };

export interface PaletteTile {
  tile: number;
  labelKey: string; // i18n key
}

export interface PaletteActor {
  type: ActorType;
  labelKey: string; // i18n key
}

export const PALETTE_TILES: PaletteTile[] = [
  { tile: TILE_PF_GROUND, labelKey: "editor.tile.ground" },
  { tile: TILE_PF_GROUND_INNER, labelKey: "editor.tile.dirt" },
  { tile: TILE_PF_PLATFORM, labelKey: "editor.tile.platform" },
  { tile: TILE_PF_BRICK, labelKey: "editor.tile.brick" },
  { tile: TILE_PF_WATER, labelKey: "editor.tile.water" },
  { tile: TILE_PF_SAND, labelKey: "editor.tile.sand" },
  { tile: TILE_PF_ROCK, labelKey: "editor.tile.rock" },
  { tile: TILE_PF_CLOUD, labelKey: "editor.tile.cloud" },
  { tile: TILE_PF_BUSH, labelKey: "editor.tile.bush" },
];

export const PALETTE_ACTORS: PaletteActor[] = [
  { type: "enemy_crab", labelKey: "editor.actor.crab" },
  { type: "enemy_starfish", labelKey: "editor.actor.starfish" },
  { type: "enemy_frog", labelKey: "editor.actor.frog" },
  { type: "platform_log", labelKey: "editor.actor.log" },
  { type: "platform_lily", labelKey: "editor.actor.lily" },
  { type: "whale", labelKey: "editor.actor.whale" },
  { type: "enemy_bear_boss", labelKey: "editor.actor.bear" },
  { type: "npc_tani", labelKey: "editor.actor.tani" },
  { type: "item_shell", labelKey: "editor.actor.shell" },
  { type: "item_heart", labelKey: "editor.actor.heart" },
  { type: "item_banana", labelKey: "editor.actor.banana" },
  { type: "item_pineapple", labelKey: "editor.actor.pineapple" },
  { type: "block_coconut", labelKey: "editor.actor.coconut" },
];

export function tileThumbKey(tile: number): string {
  return `tile:${tile}`;
}

export function actorThumbKey(type: ActorType): string {
  return `actor:${type}`;
}
