// Pure-TS editor model for the stage editor. No React/Pixi imports — the
// canvas mutates this model directly and the view re-renders through a
// version counter, so painting a tile never causes a per-tile React render.
//
// Undo convention: drag-paint strokes call beginStroke() once on pointer-down
// and then setTile()/eraseAt() freely; single-shot operations (placeActor,
// placeSpawn, placeGoal, resizeWidth, setBackground) push their own snapshot.

import {
  loadLevel, encodeRows,
  TILE_PF_EMPTY, TILE_PF_GROUND, TILE_PF_GROUND_INNER,
  TILE_PF_FLAG_POLE, TILE_PF_FLAG_TOP,
  type Actor, type ActorType, type Background,
} from "@/lib/platformer/types";
import type { StageLevelData } from "@/lib/types";

export const EDITOR_HEIGHT = 16;
export const EDITOR_MIN_WIDTH = 40;
export const EDITOR_MAX_WIDTH = 200;
const UNDO_CAP = 20;

// Actor types that may appear at most once per level (mirrors the server
// rule); placing a second one replaces the first.
const UNIQUE_ACTOR_TYPES: ReadonlySet<ActorType> = new Set([
  "enemy_bear_boss",
  "npc_tani",
]);

export interface EditorLevel {
  name: string;
  background: Background;
  width: number;
  tiles: Uint8Array; // row-major, EDITOR_HEIGHT * width
  actors: Actor[];
  spawn: { x: number; y: number };
  goal: { x: number; y: number };
}

interface Snapshot {
  background: Background;
  width: number;
  tiles: Uint8Array;
  actors: Actor[];
  spawn: { x: number; y: number };
  goal: { x: number; y: number };
}

function snapshotOf(level: EditorLevel): Snapshot {
  return {
    background: level.background,
    width: level.width,
    tiles: new Uint8Array(level.tiles),
    actors: level.actors.map((a) => ({ ...a })),
    spawn: { ...level.spawn },
    goal: { ...level.goal },
  };
}

function applySnapshot(level: EditorLevel, snap: Snapshot): void {
  level.background = snap.background;
  level.width = snap.width;
  level.tiles = new Uint8Array(snap.tiles);
  level.actors = snap.actors.map((a) => ({ ...a }));
  level.spawn = { ...snap.spawn };
  level.goal = { ...snap.goal };
}

export class EditorModel {
  level: EditorLevel;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  constructor(level: EditorLevel) {
    this.level = level;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Push an undo point. Call once per paint stroke (pointer-down). */
  beginStroke(): void {
    this.undoStack.push(snapshotOf(this.level));
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(snapshotOf(this.level));
    applySnapshot(this.level, snap);
    return true;
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoStack.push(snapshotOf(this.level));
    applySnapshot(this.level, snap);
    return true;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.level.width && y >= 0 && y < EDITOR_HEIGHT;
  }

  /** Paint one tile. Part of a stroke — does NOT push undo. */
  setTile(x: number, y: number, tile: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.level.width + x;
    if (this.level.tiles[i] === tile) return false;
    this.level.tiles[i] = tile;
    return true;
  }

  /** Erase tile + any actors anchored at the cell. Part of a stroke. */
  eraseAt(x: number, y: number): boolean {
    const tileChanged = this.setTile(x, y, TILE_PF_EMPTY);
    const before = this.level.actors.length;
    this.level.actors = this.level.actors.filter((a) => a.x !== x || a.y !== y);
    return tileChanged || this.level.actors.length !== before;
  }

  placeActor(type: ActorType, x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.beginStroke();
    if (UNIQUE_ACTOR_TYPES.has(type)) {
      this.level.actors = this.level.actors.filter((a) => a.type !== type);
    }
    this.level.actors.push({ id: this.nextActorId(), type, x, y });
    return true;
  }

  placeSpawn(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.beginStroke();
    this.level.spawn = { x, y };
    return true;
  }

  /**
   * Stamp the 3-tall goal structure (T over F over F, goal at the bottom F),
   * removing any existing flag tiles first so the goal stays unique.
   */
  placeGoal(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.beginStroke();
    const { tiles } = this.level;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === TILE_PF_FLAG_POLE || tiles[i] === TILE_PF_FLAG_TOP) {
        tiles[i] = TILE_PF_EMPTY;
      }
    }
    const gy = Math.max(2, Math.min(y, EDITOR_HEIGHT - 1));
    this.setTile(x, gy - 2, TILE_PF_FLAG_TOP);
    this.setTile(x, gy - 1, TILE_PF_FLAG_POLE);
    this.setTile(x, gy, TILE_PF_FLAG_POLE);
    this.level.goal = { x, y: gy };
    return true;
  }

  /** Resize keeping the left side; spawn/goal/actors are clamped in-bounds. */
  resizeWidth(newWidth: number): boolean {
    const w = Math.max(EDITOR_MIN_WIDTH, Math.min(newWidth, EDITOR_MAX_WIDTH));
    if (w === this.level.width) return false;
    this.beginStroke();
    const old = this.level.tiles;
    const oldW = this.level.width;
    const tiles = new Uint8Array(EDITOR_HEIGHT * w);
    const copyW = Math.min(oldW, w);
    for (let y = 0; y < EDITOR_HEIGHT; y++) {
      tiles.set(old.subarray(y * oldW, y * oldW + copyW), y * w);
    }
    this.level.tiles = tiles;
    this.level.width = w;
    const clampX = (x: number) => Math.min(x, w - 1);
    this.level.spawn.x = clampX(this.level.spawn.x);
    this.level.goal.x = clampX(this.level.goal.x);
    for (const a of this.level.actors) a.x = clampX(a.x);
    return true;
  }

  setBackground(bg: Background): void {
    if (bg === this.level.background) return;
    this.beginStroke();
    this.level.background = bg;
  }

  toStageLevelData(): StageLevelData {
    const { level } = this;
    return {
      background: level.background,
      rows: encodeRows(level.tiles, level.width, EDITOR_HEIGHT),
      spawn: { ...level.spawn },
      goal: { ...level.goal },
      actors: level.actors.map((a) => ({ ...a })),
      checkpoints: [],
    };
  }

  private nextActorId(): string {
    let max = 0;
    for (const a of this.level.actors) {
      const m = /^a(\d+)$/.exec(a.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `a${max + 1}`;
  }
}

/** Flat-ground starter level: width 64, spawn on the left, goal near the end. */
export function newDefaultLevel(name: string): EditorLevel {
  const width = 64;
  const tiles = new Uint8Array(EDITOR_HEIGHT * width);
  for (let x = 0; x < width; x++) {
    tiles[13 * width + x] = TILE_PF_GROUND;
    tiles[14 * width + x] = TILE_PF_GROUND_INNER;
    tiles[15 * width + x] = TILE_PF_GROUND_INNER;
  }
  const gx = width - 4;
  tiles[10 * width + gx] = TILE_PF_FLAG_TOP;
  tiles[11 * width + gx] = TILE_PF_FLAG_POLE;
  tiles[12 * width + gx] = TILE_PF_FLAG_POLE;
  return {
    name,
    background: "beach",
    width,
    tiles,
    actors: [],
    spawn: { x: 2, y: 12 },
    goal: { x: gx, y: 12 },
  };
}

/** Rebuild editor state from a stored stage (rows decoded via loadLevel). */
export function levelFromStageData(name: string, data: StageLevelData): EditorLevel {
  const map = loadLevel({ ...data, id: "editor", name });
  return {
    name,
    background: data.background,
    width: map.width,
    tiles: map.tiles,
    actors: data.actors.map((a) => ({ ...a })),
    spawn: { ...data.spawn },
    goal: { ...data.goal },
  };
}
