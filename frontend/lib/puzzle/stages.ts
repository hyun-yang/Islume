import type { PuzzleStageData } from "./types";

// Built-in stages, in play order. Difficulty ramps by adding piece types
// (more types = fewer natural matches) and tightening the move budget.
export const BUILTIN_PUZZLE_STAGES: PuzzleStageData[] = [
  {
    game_type: "puzzle",
    id: "puzzle1",
    name: "Tide Pool",
    theme: "beach",
    width: 8,
    height: 8,
    pieces: ["shell", "starfish", "banana", "heart"],
    moves: 20,
    objective: { type: "score", target: 1000 },
  },
  {
    game_type: "puzzle",
    id: "puzzle2",
    name: "Banana Grove",
    theme: "forest",
    width: 8,
    height: 8,
    pieces: ["shell", "starfish", "banana", "pineapple", "heart"],
    moves: 20,
    objective: { type: "score", target: 1500 },
  },
  {
    game_type: "puzzle",
    id: "puzzle3",
    name: "Coconut Cove",
    theme: "stream",
    width: 8,
    height: 8,
    pieces: ["shell", "starfish", "banana", "pineapple", "coconut", "heart"],
    moves: 18,
    objective: { type: "score", target: 2000 },
  },
];
