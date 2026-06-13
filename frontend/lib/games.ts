// Registry of games a visitor can play on a host's island. Deliberately
// dumb — data + component only, no lifecycle hooks. Adding a genre means
// extending the GameId union in lib/types.ts and appending one entry here.

import type { ComponentType } from "react";
import type { GameId } from "@/lib/types";
import IslandPlatformerView from "@/components/island-platformer/IslandPlatformerView";
import IslandPuzzleView from "@/components/island-puzzle/IslandPuzzleView";

export interface GameDefinition {
  id: GameId;
  titleKey: string; // i18n key
  descKey: string;  // i18n key
  icon: string;     // emoji, matching the existing UI chrome style
  component: ComponentType<{ visitId: string }>;
}

export const GAMES: GameDefinition[] = [
  {
    id: "platformer",
    titleKey: "games.platformer.title",
    descKey: "games.platformer.desc",
    icon: "🏃",
    component: IslandPlatformerView,
  },
  {
    id: "puzzle",
    titleKey: "games.puzzle.title",
    descKey: "games.puzzle.desc",
    icon: "🐚",
    component: IslandPuzzleView,
  },
];

export function gameById(id: GameId): GameDefinition {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}
