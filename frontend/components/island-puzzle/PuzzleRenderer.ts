// Match-3 board renderer — owns the sprite-per-cell piece layer and a tiny
// tween engine the runtime awaits between board mutations. Pure presentation:
// all game rules live in lib/puzzle/board.ts.
//
// A fixed 8x8-ish grid (≤64 persistent sprites) is far below any batching
// concern, so the viewport-culling rule from the island tilemap does not
// apply here; every cell keeps its sprite alive for the whole run.

import { Application, Container, Graphics, Sprite } from "pixi.js";
import { SpritePool } from "@/lib/game-core/SpritePool";
import { PUZZLE_CELL_SIZE, type PuzzlePieceType } from "@/lib/puzzle/types";
import type { Fall, Spawn } from "@/lib/puzzle/board";
import type { PuzzleTextureSet } from "@/lib/puzzle/pieceTextures";

const CELL = PUZZLE_CELL_SIZE;

const SWAP_MS = 160;
const CLEAR_MS = 250;
const SPARKLE_MS = 380;
const FALL_MS_PER_CELL = 90;
const FALL_MS_MIN = 180;
const FALL_MS_MAX = 420;

type Ease = (t: number) => number;
const easeInOutQuad: Ease = (t) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const easeInQuad: Ease = (t) => t * t;
const easeOutQuad: Ease = (t) => 1 - (1 - t) ** 2;

interface Tween {
  sprite: Sprite;
  fromX: number; toX: number;
  fromY: number; toY: number;
  fromAlpha: number; toAlpha: number;
  fromScale: number; toScale: number;
  duration: number;
  elapsed: number;
  ease: Ease;
  onDone?: () => void;
}

export class PuzzleRenderer {
  private app: Application;
  private cols: number;
  private rows: number;
  private textures: PuzzleTextureSet;

  private boardContainer: Container;
  private piecesLayer: Container;
  private sparkleLayer: Container;
  private selectionSprite: Sprite;

  private pieceSprites: (Sprite | null)[];
  private freeSprites: Sprite[] = [];
  private sparklePool: SpritePool;
  private tweens: Tween[] = [];

  constructor(app: Application, cols: number, rows: number, textures: PuzzleTextureSet) {
    this.app = app;
    this.cols = cols;
    this.rows = rows;
    this.textures = textures;
    this.pieceSprites = new Array<Sprite | null>(cols * rows).fill(null);

    this.boardContainer = new Container();
    this.boardContainer.label = "puzzle-board";
    this.boardContainer.pivot.set((cols * CELL) / 2, (rows * CELL) / 2);
    app.stage.addChild(this.boardContainer);

    // Checkerboard cell backdrop
    const bgLayer = new Container();
    bgLayer.label = "cells";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const bg = new Sprite(
          (x + y) % 2 === 0 ? textures.cellBgLight : textures.cellBgDark,
        );
        bg.anchor.set(0.5);
        bg.position.set(x * CELL + CELL / 2, y * CELL + CELL / 2);
        bgLayer.addChild(bg);
      }
    }
    this.boardContainer.addChild(bgLayer);

    this.selectionSprite = new Sprite(textures.selection);
    this.selectionSprite.anchor.set(0.5);
    this.selectionSprite.visible = false;
    this.boardContainer.addChild(this.selectionSprite);

    this.piecesLayer = new Container();
    this.piecesLayer.label = "pieces";
    this.boardContainer.addChild(this.piecesLayer);

    this.sparkleLayer = new Container();
    this.sparkleLayer.label = "sparkles";
    this.boardContainer.addChild(this.sparkleLayer);
    this.sparklePool = new SpritePool(this.sparkleLayer);

    // Clip spawned pieces dropping in from above the grid
    const mask = new Graphics().rect(0, 0, cols * CELL, rows * CELL).fill(0xffffff);
    this.boardContainer.addChild(mask);
    this.boardContainer.mask = mask;
  }

  private cellCenter(index: number): { x: number; y: number } {
    const x = (index % this.cols) * CELL + CELL / 2;
    const y = Math.floor(index / this.cols) * CELL + CELL / 2;
    return { x, y };
  }

  private acquirePiece(piece: PuzzlePieceType): Sprite {
    let s = this.freeSprites.pop();
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.piecesLayer.addChild(s);
    }
    s.texture = this.textures.pieces[piece];
    s.visible = true;
    s.alpha = 1;
    s.scale.set(1);
    return s;
  }

  private releasePiece(s: Sprite): void {
    s.visible = false;
    this.freeSprites.push(s);
  }

  // Instant full sync — initial board, retry, and reshuffle.
  setBoard(cells: (PuzzlePieceType | null)[]): void {
    for (let i = 0; i < this.pieceSprites.length; i++) {
      const sprite = this.pieceSprites[i];
      if (sprite) {
        this.releasePiece(sprite);
        this.pieceSprites[i] = null;
      }
      const piece = cells[i];
      if (piece !== null) {
        const s = this.acquirePiece(piece);
        const { x, y } = this.cellCenter(i);
        s.position.set(x, y);
        this.pieceSprites[i] = s;
      }
    }
  }

  setSelection(index: number | null): void {
    if (index === null) {
      this.selectionSprite.visible = false;
      return;
    }
    const { x, y } = this.cellCenter(index);
    this.selectionSprite.position.set(x, y);
    this.selectionSprite.visible = true;
  }

  // Canvas-pixel coords → cell index, or null outside the board. The board
  // container only translates and scales (no rotation), so invert manually.
  cellAt(canvasX: number, canvasY: number): number | null {
    const c = this.boardContainer;
    const lx = (canvasX - c.position.x) / c.scale.x + c.pivot.x;
    const ly = (canvasY - c.position.y) / c.scale.y + c.pivot.y;
    const x = Math.floor(lx / CELL);
    const y = Math.floor(ly / CELL);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return null;
    return y * this.cols + x;
  }

  private addTween(t: Omit<Tween, "elapsed">): void {
    this.tweens.push({ ...t, elapsed: 0 });
  }

  private moveTween(
    sprite: Sprite, toX: number, toY: number,
    duration: number, ease: Ease, onDone?: () => void,
  ): void {
    this.addTween({
      sprite,
      fromX: sprite.position.x, toX,
      fromY: sprite.position.y, toY,
      fromAlpha: sprite.alpha, toAlpha: sprite.alpha,
      fromScale: sprite.scale.x, toScale: sprite.scale.x,
      duration, ease, onDone,
    });
  }

  // Resolves when `count` onDone callbacks have fired.
  private group(count: number, resolve: () => void): () => void {
    let remaining = count;
    return () => {
      remaining--;
      if (remaining === 0) resolve();
    };
  }

  animateSwap(a: number, b: number): Promise<void> {
    return new Promise((resolve) => {
      const sa = this.pieceSprites[a];
      const sb = this.pieceSprites[b];
      if (!sa || !sb) { resolve(); return; }
      const pa = this.cellCenter(a);
      const pb = this.cellCenter(b);
      const done = this.group(2, resolve);
      this.moveTween(sa, pb.x, pb.y, SWAP_MS, easeInOutQuad, done);
      this.moveTween(sb, pa.x, pa.y, SWAP_MS, easeInOutQuad, done);
      this.pieceSprites[a] = sb;
      this.pieceSprites[b] = sa;
    });
  }

  animateInvalidSwap(a: number, b: number): Promise<void> {
    return new Promise((resolve) => {
      const sa = this.pieceSprites[a];
      const sb = this.pieceSprites[b];
      if (!sa || !sb) { resolve(); return; }
      const pa = this.cellCenter(a);
      const pb = this.cellCenter(b);
      const done = this.group(2, resolve);
      this.moveTween(sa, pb.x, pb.y, SWAP_MS, easeInOutQuad, () => {
        this.moveTween(sa, pa.x, pa.y, SWAP_MS, easeInOutQuad, done);
      });
      this.moveTween(sb, pa.x, pa.y, SWAP_MS, easeInOutQuad, () => {
        this.moveTween(sb, pb.x, pb.y, SWAP_MS, easeInOutQuad, done);
      });
    });
  }

  animateClear(cleared: number[]): Promise<void> {
    return new Promise((resolve) => {
      const sprites = cleared
        .map((i) => ({ i, s: this.pieceSprites[i] }))
        .filter((e): e is { i: number; s: Sprite } => e.s !== null);
      if (sprites.length === 0) { resolve(); return; }

      // Waves are strictly sequential, so the previous burst is done by now.
      this.sparklePool.releaseAll();

      const done = this.group(sprites.length, resolve);
      for (const { i, s } of sprites) {
        this.pieceSprites[i] = null;
        this.addTween({
          sprite: s,
          fromX: s.position.x, toX: s.position.x,
          fromY: s.position.y, toY: s.position.y,
          fromAlpha: 1, toAlpha: 0,
          fromScale: 1, toScale: 0.2,
          duration: CLEAR_MS, ease: easeOutQuad,
          onDone: () => { this.releasePiece(s); done(); },
        });

        const { x, y } = this.cellCenter(i);
        for (let k = 0; k < 4; k++) {
          const sparkle = this.sparklePool.acquire();
          sparkle.texture = this.textures.sparkle;
          sparkle.anchor.set(0.5);
          sparkle.position.set(x, y);
          sparkle.alpha = 1;
          sparkle.scale.set(0.5 + (k % 2) * 0.3);
          const angle = (k / 4) * Math.PI * 2 + (i % 3) * 0.7;
          this.addTween({
            sprite: sparkle,
            fromX: x, toX: x + Math.cos(angle) * CELL * 0.6,
            fromY: y, toY: y + Math.sin(angle) * CELL * 0.6,
            fromAlpha: 1, toAlpha: 0,
            fromScale: sparkle.scale.x, toScale: 0.1,
            duration: SPARKLE_MS, ease: easeOutQuad,
          });
        }
      }
    });
  }

  animateFalls(falls: Fall[], spawns: Spawn[]): Promise<void> {
    return new Promise((resolve) => {
      const total = falls.length + spawns.length;
      if (total === 0) { resolve(); return; }
      const done = this.group(total, resolve);

      for (const f of falls) {
        const s = this.pieceSprites[f.from];
        this.pieceSprites[f.from] = null;
        if (!s) { done(); continue; }
        this.pieceSprites[f.to] = s;
        const to = this.cellCenter(f.to);
        const cellsMoved = Math.abs(
          Math.floor(f.to / this.cols) - Math.floor(f.from / this.cols),
        );
        const dur = Math.min(FALL_MS_MAX, Math.max(FALL_MS_MIN, cellsMoved * FALL_MS_PER_CELL));
        this.moveTween(s, to.x, to.y, dur, easeInQuad, done);
      }

      for (const sp of spawns) {
        const s = this.acquirePiece(sp.piece);
        const to = this.cellCenter(sp.index);
        s.position.set(to.x, to.y - sp.dropFrom * CELL);
        this.pieceSprites[sp.index] = s;
        const dur = Math.min(FALL_MS_MAX, Math.max(FALL_MS_MIN, sp.dropFrom * FALL_MS_PER_CELL));
        this.moveTween(s, to.x, to.y, dur, easeInQuad, done);
      }
    });
  }

  // Per-frame: advance tweens and keep the board centered + fitted.
  update(deltaMS: number): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const boardW = this.cols * CELL;
    const boardH = this.rows * CELL;
    const scale = Math.min(1, (screenW - 16) / boardW, (screenH - 16) / boardH);
    this.boardContainer.scale.set(scale);
    this.boardContainer.position.set(screenW / 2, screenH / 2);

    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      t.elapsed += deltaMS;
      const raw = Math.min(1, t.elapsed / t.duration);
      const k = t.ease(raw);
      t.sprite.position.set(
        t.fromX + (t.toX - t.fromX) * k,
        t.fromY + (t.toY - t.fromY) * k,
      );
      t.sprite.alpha = t.fromAlpha + (t.toAlpha - t.fromAlpha) * k;
      t.sprite.scale.set(t.fromScale + (t.toScale - t.fromScale) * k);
      if (raw >= 1) {
        this.tweens.splice(i, 1);
        t.onDone?.();
      }
    }
  }

  destroy(): void {
    // Flush pending completions so no runtime await hangs across teardown
    // (the runtime re-checks its cancelled flag after every await).
    const pending = this.tweens;
    this.tweens = [];
    for (const t of pending) t.onDone?.();
    this.sparklePool.destroy();
    this.boardContainer.destroy({ children: true });
  }
}
