// Puzzle engine runtime — Pixi init / pointer input / cleanup, mirroring
// createPlatformerRun's contract. The runtime owns run state (board / score /
// moves) and mirrors changes to the host component through callbacks; React
// owns only presentation state.

import { Application } from "pixi.js";

import {
  validatePuzzleStage,
  type PuzzleStageData,
  type PuzzleTheme,
} from "@/lib/puzzle/types";
import { generateBoard, trySwap, type PuzzleBoard } from "@/lib/puzzle/board";
import { generatePuzzlePieceTextures } from "@/lib/puzzle/pieceTextures";

import { PuzzleRenderer } from "./PuzzleRenderer";

const THEME_BG: Record<PuzzleTheme, number> = {
  beach: 0xa8d8ff,
  stream: 0xb3e5fc,
  forest: 0xc8e6c9,
};

// Drag farther than this (canvas px) commits a swap toward that direction.
const DRAG_THRESHOLD = 14;

interface PuzzleRunCallbacks {
  /** Init finished; the run is live. */
  onReady(): void;
  onScoreChange(score: number): void;
  onMovesChange(movesLeft: number): void;
  /** Board had no valid move left and was auto-reshuffled. */
  onShuffled(): void;
  /** Objective reached — input locked. */
  onCleared(): void;
  /** Out of moves — input locked. */
  onFailed(): void;
  /** Async init failed. */
  onError(message: string): void;
}

export interface PuzzleRunOptions {
  mount: HTMLElement;
  stage: PuzzleStageData;
  callbacks: PuzzleRunCallbacks;
}

export interface PuzzleRun {
  /** Tear down Pixi + listeners. Safe to call before init completes. */
  destroy(): void;
  /**
   * Fresh board, reset score/moves. Returns false (no-op) if init hasn't
   * completed yet.
   */
  retry(): boolean;
}

export function createPuzzleRun(opts: PuzzleRunOptions): PuzzleRun {
  const { mount, stage, callbacks } = opts;

  let cancelled = false;
  let app: Application | null = null;
  let renderer: PuzzleRenderer | null = null;
  let board: PuzzleBoard | null = null;
  let initialized = false;
  let detachPointer: (() => void) | null = null;

  // Run state (owned here, mirrored to the host via callbacks)
  let score = 0;
  let movesLeft = stage.moves;
  let ended = false;
  let busy = false; // an animation sequence is in flight; input ignored
  let selected: number | null = null;

  const setSelected = (index: number | null) => {
    selected = index;
    renderer?.setSelection(index);
  };

  // Swap → animate waves → end check. All awaits re-check `cancelled`
  // because destroy() may flush them mid-sequence.
  const requestSwap = async (a: number, b: number) => {
    if (!renderer || !board || busy || ended) return;
    busy = true;
    setSelected(null);
    try {
      const result = trySwap(board, a, b);
      if (!result.valid) {
        await renderer.animateInvalidSwap(a, b);
        return;
      }
      await renderer.animateSwap(a, b);
      if (cancelled) return;

      movesLeft -= 1;
      callbacks.onMovesChange(movesLeft);

      for (const step of result.steps) {
        await renderer.animateClear(step.cleared);
        if (cancelled) return;
        score += step.scoreDelta;
        callbacks.onScoreChange(score);
        await renderer.animateFalls(step.falls, step.spawns);
        if (cancelled) return;
      }

      if (result.reshuffled) {
        renderer.setBoard(board.cells);
        callbacks.onShuffled();
      }

      if (score >= stage.objective.target) {
        ended = true;
        callbacks.onCleared();
      } else if (movesLeft <= 0) {
        ended = true;
        callbacks.onFailed();
      }
    } finally {
      busy = false;
    }
  };

  (async () => {
    validatePuzzleStage(stage);

    app = new Application();
    await app.init({
      background: THEME_BG[stage.theme],
      resizeTo: mount,
      antialias: true,
    });
    if (cancelled) {
      try { app.destroy(true, { children: true }); } catch { /* init may not be fully wired */ }
      return;
    }
    mount.appendChild(app.canvas);

    const textures = generatePuzzlePieceTextures(app.renderer);
    renderer = new PuzzleRenderer(app, stage.width, stage.height, textures);
    board = generateBoard(stage);
    renderer.setBoard(board.cells);

    app.ticker.add((ticker) => {
      renderer?.update(ticker.deltaMS);
    });

    // Pointer input: drag past the threshold swaps toward that direction;
    // tap selects, tapping an adjacent cell swaps with the selection.
    const canvas = app.canvas;
    let downCell: number | null = null;
    let downX = 0;
    let downY = 0;
    let dragConsumed = false;

    const cellFromEvent = (e: PointerEvent): number | null => {
      if (!renderer) return null;
      const rect = canvas.getBoundingClientRect();
      return renderer.cellAt(e.clientX - rect.left, e.clientY - rect.top);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (busy || ended || !board) return;
      downCell = cellFromEvent(e);
      downX = e.clientX;
      downY = e.clientY;
      dragConsumed = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (downCell === null || dragConsumed || busy || ended || !board) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const col = downCell % board.width;
      const row = Math.floor(downCell / board.width);
      let neighbor: number | null = null;
      if (horizontal) {
        const nc = col + (dx > 0 ? 1 : -1);
        if (nc >= 0 && nc < board.width) neighbor = row * board.width + nc;
      } else {
        const nr = row + (dy > 0 ? 1 : -1);
        if (nr >= 0 && nr < board.height) neighbor = nr * board.width + col;
      }
      dragConsumed = true;
      if (neighbor !== null) void requestSwap(downCell, neighbor);
    };

    const onPointerUp = (e: PointerEvent) => {
      const cell = downCell;
      downCell = null;
      if (dragConsumed || busy || ended || !board) return;
      const upCell = cellFromEvent(e);
      if (cell === null || upCell === null || upCell !== cell) return;
      if (selected === null) {
        setSelected(cell);
      } else if (selected === cell) {
        setSelected(null);
      } else {
        const sx = selected % board.width;
        const sy = Math.floor(selected / board.width);
        const cx = cell % board.width;
        const cy = Math.floor(cell / board.width);
        if (Math.abs(sx - cx) + Math.abs(sy - cy) === 1) {
          void requestSwap(selected, cell);
        } else {
          setSelected(cell);
        }
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    detachPointer = () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    };

    initialized = true;
    callbacks.onReady();
    callbacks.onScoreChange(score);
    callbacks.onMovesChange(movesLeft);
  })().catch((e) => {
    console.error("[puzzle] init error:", e);
    if (!cancelled) callbacks.onError(e instanceof Error ? e.message : String(e));
  });

  return {
    retry() {
      if (!initialized || !renderer) return false;
      board = generateBoard(stage);
      renderer.setBoard(board.cells);
      score = 0;
      movesLeft = stage.moves;
      callbacks.onScoreChange(score);
      callbacks.onMovesChange(movesLeft);
      ended = false;
      busy = false;
      setSelected(null);
      return true;
    },
    destroy() {
      cancelled = true;
      detachPointer?.();
      detachPointer = null;
      // If init never finished, the async block destroys its own app when it
      // resumes and sees `cancelled`. We only own teardown after `initialized`.
      if (!initialized) return;
      try {
        renderer?.destroy();
        app?.destroy(true, { children: true });
      } catch (e) {
        console.warn("[puzzle] cleanup error:", e);
      }
      renderer = null;
      app = null;
    },
  };
}
