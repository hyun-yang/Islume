// 2D side-scrolling platformer level data.
// JSON levels store rows as compact strings (one char per tile) and are
// converted to a flat Uint8Array via loadLevel().

export const TILE_PF_SIZE = 32;

// Solid terrain
export const TILE_PF_EMPTY = 0;
export const TILE_PF_GROUND = 1;          // grass-topped surface block
export const TILE_PF_GROUND_INNER = 2;    // dirt fill below the surface
export const TILE_PF_PLATFORM = 3;        // top-only solid (Phase 2)
export const TILE_PF_BRICK = 4;
export const TILE_PF_WATER = 5;           // damage on contact (Phase 2)
export const TILE_PF_SAND = 6;
export const TILE_PF_ROCK = 7;
export const TILE_PF_FLAG_POLE = 8;       // goal pole (overlap = clear)
export const TILE_PF_FLAG_TOP = 9;

// Decoration (non-solid)
export const TILE_PF_CLOUD = 64;
export const TILE_PF_BUSH = 65;

export const SOLID_PF_TILES = new Set<number>([
  TILE_PF_GROUND,
  TILE_PF_GROUND_INNER,
  TILE_PF_BRICK,
  TILE_PF_SAND,
  TILE_PF_ROCK,
]);

const HAZARD_PF_TILES = new Set<number>([
  TILE_PF_WATER,
]);

const GOAL_PF_TILES = new Set<number>([
  TILE_PF_FLAG_POLE,
  TILE_PF_FLAG_TOP,
]);

// Single-char legend for compact JSON row strings
const TILE_LEGEND: Record<string, number> = {
  ".": TILE_PF_EMPTY,
  "G": TILE_PF_GROUND,
  "D": TILE_PF_GROUND_INNER,
  "P": TILE_PF_PLATFORM,
  "B": TILE_PF_BRICK,
  "W": TILE_PF_WATER,
  "S": TILE_PF_SAND,
  "R": TILE_PF_ROCK,
  "F": TILE_PF_FLAG_POLE,
  "T": TILE_PF_FLAG_TOP,
  "c": TILE_PF_CLOUD,
  "u": TILE_PF_BUSH,
};

// Reverse legend: tile id → char, for serializing editor tiles back to rows
const TILE_CHAR: Record<number, string> = Object.fromEntries(
  Object.entries(TILE_LEGEND).map(([ch, tile]) => [tile, ch]),
);

// Inverse of the row-decoding loop in loadLevel(); used by the stage editor
// to produce the rows-as-strings format the backend validates and stores.
export function encodeRows(
  tiles: Uint8Array,
  width: number,
  height: number,
): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const ch = TILE_CHAR[tiles[y * width + x]];
      if (ch === undefined) {
        throw new Error(`unknown tile id ${tiles[y * width + x]} at (${x},${y})`);
      }
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

export type ActorType =
  | "enemy_crab"
  | "enemy_starfish"
  | "enemy_frog"
  | "platform_log"
  | "platform_lily"
  | "whale"
  | "enemy_bear_boss"
  | "npc_tani"
  | "item_shell"
  | "item_heart"
  | "item_banana"
  | "item_pineapple"
  | "block_coconut";

export interface Actor {
  id: string;
  type: ActorType;
  // Tile the actor occupies. Ground-anchored actors stand with their feet on
  // this tile's bottom edge ((y+1)*tile); items render centered in the tile.
  x: number;
  y: number;
  walk_range?: [number, number];
  jump_interval_ms?: number;
  dialog?: string[];
  drop?: ActorType;
}

// Built-in stage ids — used for STAGE_DATA keys and audio.startBgm; custom
// stages carry arbitrary string ids (slot-derived) and map BGM via background.
export type StageId = "stage1" | "stage2" | "stage3";
export type Background = "beach" | "stream" | "forest";

export interface LevelMap {
  id: string;
  name: string;
  background: Background;
  width: number;        // in tiles
  height: number;       // in tiles
  tile_size: number;    // px per tile
  spawn: { x: number; y: number };
  goal:  { x: number; y: number };
  tiles: Uint8Array;    // row-major (y * width + x)
  actors: Actor[];
  checkpoints: { x: number; y: number }[];
}

// Raw shape loaded from JSON
export interface LevelData {
  id: string;
  name: string;
  background: Background;
  rows: string[];
  spawn: { x: number; y: number };
  goal:  { x: number; y: number };
  actors: Actor[];
  checkpoints: { x: number; y: number }[];
}

export function loadLevel(data: LevelData): LevelMap {
  const height = data.rows.length;
  if (height === 0) throw new Error(`level ${data.id}: no rows`);
  const width = data.rows[0].length;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = data.rows[y];
    if (row.length !== width) {
      throw new Error(
        `level ${data.id}: row ${y} length ${row.length}, expected ${width}`,
      );
    }
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      const tile = TILE_LEGEND[ch];
      if (tile === undefined) {
        throw new Error(
          `level ${data.id}: unknown tile char '${ch}' at (${x},${y})`,
        );
      }
      tiles[y * width + x] = tile;
    }
  }
  return {
    id: data.id,
    name: data.name,
    background: data.background,
    width,
    height,
    tile_size: TILE_PF_SIZE,
    spawn: data.spawn,
    goal: data.goal,
    tiles,
    actors: data.actors,
    checkpoints: data.checkpoints,
  };
}

function tileAt(level: LevelMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return TILE_PF_EMPTY;
  return level.tiles[y * level.width + x];
}

export function isGoalTile(level: LevelMap, x: number, y: number): boolean {
  return GOAL_PF_TILES.has(tileAt(level, x, y));
}

function isHazardTile(level: LevelMap, x: number, y: number): boolean {
  return HAZARD_PF_TILES.has(tileAt(level, x, y));
}

// AABB-overlap hazard test for the engine's per-frame check.
export function aabbOverlapsHazard(
  level: LevelMap,
  left: number, top: number, right: number, bottom: number,
): boolean {
  const tx0 = Math.floor(left / TILE_PF_SIZE);
  const tx1 = Math.floor((right - 0.01) / TILE_PF_SIZE);
  const ty0 = Math.floor(top / TILE_PF_SIZE);
  const ty1 = Math.floor((bottom - 0.01) / TILE_PF_SIZE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isHazardTile(level, tx, ty)) return true;
    }
  }
  return false;
}
