// Pure match-3 board logic — no pixi imports, no rendering concerns.
// The runtime calls trySwap() and animates the returned ClearStep waves;
// keeping this module render-free is what lets a future stage editor (or a
// server-side score validator) reuse it as-is.
//
// Cells are flat row-major (y * width + x). The rng is injectable so boards
// can be reproduced from a seed later; gameplay uses Math.random.

import type { PuzzlePieceType, PuzzleStageData } from "./types";

export type Rng = () => number;

export interface PuzzleBoard {
  width: number;
  height: number;
  pieces: PuzzlePieceType[];           // palette this board draws from
  cells: (PuzzlePieceType | null)[];   // null only mid-resolve
}

// One horizontal or vertical run of 3+ equal pieces.
interface Match {
  cells: number[];
}

export interface Fall {
  from: number;
  to: number;
}

export interface Spawn {
  index: number;
  piece: PuzzlePieceType;
  // How many cells above the board top the piece should start falling from
  // (1 = just above row 0). Purely an animation hint.
  dropFrom: number;
}

// One wave of the cascade: clear → gravity → refill.
interface ClearStep {
  matches: Match[];
  cleared: number[];
  falls: Fall[];
  spawns: Spawn[];
  scoreDelta: number;
  cascadeDepth: number; // 1-based wave number; also the score multiplier
}

export interface SwapResult {
  valid: boolean;
  steps: ClearStep[];
  scoreDelta: number;
  reshuffled: boolean; // board had no valid move after resolving
}

function scoreForRun(length: number): number {
  if (length >= 5) return 100;
  if (length === 4) return 60;
  return 30;
}

function randomPiece(pieces: PuzzlePieceType[], rng: Rng): PuzzlePieceType {
  return pieces[Math.floor(rng() * pieces.length)];
}

export function generateBoard(stage: PuzzleStageData, rng: Rng = Math.random): PuzzleBoard {
  const board: PuzzleBoard = {
    width: stage.width,
    height: stage.height,
    pieces: stage.pieces,
    cells: new Array<PuzzlePieceType | null>(stage.width * stage.height).fill(null),
  };
  regenerate(board, rng);
  return board;
}

// Fresh random fill, retried until a valid move exists (a fresh fill can lack
// one — rare on 8x8). The bound only guards against an infinite loop; the
// last fill is accepted if it somehow never satisfies.
function regenerate(board: PuzzleBoard, rng: Rng): void {
  for (let attempt = 0; attempt < 100; attempt++) {
    fillNoPreMatch(board, rng);
    if (hasValidMove(board)) return;
  }
}

// Fill every cell, rerolling any piece that would complete a 3-run with the
// two cells to its left or above. Always satisfiable with >=3 piece types.
function fillNoPreMatch(board: PuzzleBoard, rng: Rng): void {
  const { width, height, pieces, cells } = board;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let piece: PuzzlePieceType;
      do {
        piece = randomPiece(pieces, rng);
      } while (
        (x >= 2 && cells[i - 1] === piece && cells[i - 2] === piece) ||
        (y >= 2 && cells[i - width] === piece && cells[i - 2 * width] === piece)
      );
      cells[i] = piece;
    }
  }
}

// All horizontal and vertical runs of 3+. A cell may appear in two runs
// (L/T shapes); clearing unions them, scoring counts each run.
function findMatches(board: PuzzleBoard): Match[] {
  const { width, height, cells } = board;
  const matches: Match[] = [];

  for (let y = 0; y < height; y++) {
    let runStart = 0;
    for (let x = 1; x <= width; x++) {
      const same =
        x < width &&
        cells[y * width + x] !== null &&
        cells[y * width + x] === cells[y * width + runStart];
      if (!same) {
        if (x - runStart >= 3 && cells[y * width + runStart] !== null) {
          const run: number[] = [];
          for (let k = runStart; k < x; k++) run.push(y * width + k);
          matches.push({ cells: run });
        }
        runStart = x;
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let runStart = 0;
    for (let y = 1; y <= height; y++) {
      const same =
        y < height &&
        cells[y * width + x] !== null &&
        cells[y * width + x] === cells[runStart * width + x];
      if (!same) {
        if (y - runStart >= 3 && cells[runStart * width + x] !== null) {
          const run: number[] = [];
          for (let k = runStart; k < y; k++) run.push(k * width + x);
          matches.push({ cells: run });
        }
        runStart = y;
      }
    }
  }

  return matches;
}

function areAdjacent(board: PuzzleBoard, a: number, b: number): boolean {
  const ax = a % board.width;
  const ay = Math.floor(a / board.width);
  const bx = b % board.width;
  const by = Math.floor(b / board.width);
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

// Swap two adjacent cells. If the swap creates no match it is reverted and
// reported invalid; otherwise the full cascade is resolved on the board and
// returned as animation waves.
export function trySwap(
  board: PuzzleBoard,
  a: number,
  b: number,
  rng: Rng = Math.random,
): SwapResult {
  if (!areAdjacent(board, a, b)) {
    return { valid: false, steps: [], scoreDelta: 0, reshuffled: false };
  }
  const { cells } = board;
  [cells[a], cells[b]] = [cells[b], cells[a]];
  if (findMatches(board).length === 0) {
    [cells[a], cells[b]] = [cells[b], cells[a]];
    return { valid: false, steps: [], scoreDelta: 0, reshuffled: false };
  }
  const steps = resolveCascades(board, rng);
  const scoreDelta = steps.reduce((sum, s) => sum + s.scoreDelta, 0);
  let reshuffled = false;
  if (!hasValidMove(board)) {
    reshuffle(board, rng);
    reshuffled = true;
  }
  return { valid: true, steps, scoreDelta, reshuffled };
}

// Run clear → gravity → refill until the board settles. Mutates the board;
// each returned wave describes what the renderer should animate.
function resolveCascades(board: PuzzleBoard, rng: Rng): ClearStep[] {
  const steps: ClearStep[] = [];
  for (let depth = 1; ; depth++) {
    const matches = findMatches(board);
    if (matches.length === 0) break;

    const clearedSet = new Set<number>();
    let waveScore = 0;
    for (const m of matches) {
      waveScore += scoreForRun(m.cells.length);
      for (const c of m.cells) clearedSet.add(c);
    }
    const cleared = [...clearedSet];
    for (const c of cleared) board.cells[c] = null;

    const falls = applyGravity(board);
    const spawns = refill(board, rng);

    steps.push({
      matches,
      cleared,
      falls,
      spawns,
      scoreDelta: waveScore * depth,
      cascadeDepth: depth,
    });
  }
  return steps;
}

function applyGravity(board: PuzzleBoard): Fall[] {
  const { width, height, cells } = board;
  const falls: Fall[] = [];
  for (let x = 0; x < width; x++) {
    let writeY = height - 1;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      if (cells[i] !== null) {
        if (writeY !== y) {
          cells[writeY * width + x] = cells[i];
          cells[i] = null;
          falls.push({ from: i, to: writeY * width + x });
        }
        writeY--;
      }
    }
  }
  return falls;
}

function refill(board: PuzzleBoard, rng: Rng): Spawn[] {
  const { width, height, cells, pieces } = board;
  const spawns: Spawn[] = [];
  for (let x = 0; x < width; x++) {
    let drop = 0;
    // Top-down so the highest empty cell gets the largest dropFrom.
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if (cells[i] === null) drop++;
    }
    let remaining = drop;
    for (let y = 0; y < height && remaining > 0; y++) {
      const i = y * width + x;
      if (cells[i] === null) {
        const piece = randomPiece(pieces, rng);
        cells[i] = piece;
        spawns.push({ index: i, piece, dropFrom: remaining });
        remaining--;
      }
    }
  }
  return spawns;
}

function hasValidMove(board: PuzzleBoard): boolean {
  const { width, height, cells } = board;
  const swapCheck = (a: number, b: number): boolean => {
    [cells[a], cells[b]] = [cells[b], cells[a]];
    const found = findMatches(board).length > 0;
    [cells[a], cells[b]] = [cells[b], cells[a]];
    return found;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width && swapCheck(i, i + 1)) return true;
      if (y + 1 < height && swapCheck(i, i + width)) return true;
    }
  }
  return false;
}

// Shuffle the existing pieces into a no-pre-match board with a valid move.
// Falls back to a fresh fill if the multiset can't settle (e.g. pathological
// piece counts) — piece distribution is not gameplay-critical.
function reshuffle(board: PuzzleBoard, rng: Rng = Math.random): void {
  const pieces = board.cells.filter((c): c is PuzzlePieceType => c !== null);
  for (let attempt = 0; attempt < 100; attempt++) {
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    board.cells = [...pieces];
    if (findMatches(board).length === 0 && hasValidMove(board)) return;
  }
  regenerate(board, rng);
}
