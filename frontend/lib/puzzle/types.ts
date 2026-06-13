// Match-3 swap puzzle ("Shell Swap") stage data.
// Stages are developer-authored TypeScript consts for now; the game_type
// discriminator is included so the same shape can later be stored in
// island_stages.level_data alongside platformer stages (absent ⇒ platformer).

export const PUZZLE_CELL_SIZE = 48;

export type PuzzlePieceType =
  | "shell"
  | "starfish"
  | "banana"
  | "pineapple"
  | "coconut"
  | "heart";

export type PuzzleTheme = "beach" | "stream" | "forest";

interface PuzzleObjective {
  type: "score";
  target: number;
}

export interface PuzzleStageData {
  game_type: "puzzle";
  id: string;
  name: string;
  theme: PuzzleTheme;
  width: number;   // in cells
  height: number;  // in cells
  pieces: PuzzlePieceType[];
  moves: number;
  objective: PuzzleObjective;
}

export function validatePuzzleStage(stage: PuzzleStageData): void {
  if (stage.width < 4 || stage.height < 4) {
    throw new Error(`puzzle ${stage.id}: board must be at least 4x4`);
  }
  // 3 piece types is the minimum where a no-pre-match board can always be
  // generated; fewer makes accidental matches unavoidable.
  if (stage.pieces.length < 3) {
    throw new Error(`puzzle ${stage.id}: need at least 3 piece types`);
  }
  if (new Set(stage.pieces).size !== stage.pieces.length) {
    throw new Error(`puzzle ${stage.id}: duplicate piece types`);
  }
  if (stage.moves < 1) {
    throw new Error(`puzzle ${stage.id}: moves must be positive`);
  }
  if (stage.objective.target < 1) {
    throw new Error(`puzzle ${stage.id}: objective target must be positive`);
  }
}
