"use client";

import { useT } from "@/lib/i18n";

interface Props {
  score: number;
  target: number;
  movesLeft: number;
  stageName: string;
}

export default function PuzzleHUD({ score, target, movesLeft, stageName }: Props) {
  const t = useT();
  return (
    <div className="absolute top-3 left-3 right-3 z-40 flex items-start justify-between pointer-events-none">
      <div className="flex flex-col gap-1.5">
        <div
          className="flex items-center gap-2 text-white text-sm font-bold"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
        >
          <span className="text-xl">🏆</span>
          <span>{t("puzzle.score")} {score} / {target}</span>
        </div>
        <div
          className="flex items-center gap-2 text-white text-sm font-bold"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
        >
          <span className="text-xl">👆</span>
          <span>{t("puzzle.moves")} × {movesLeft}</span>
        </div>
      </div>
      <div
        className="text-white text-sm font-bold bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
      >
        {stageName}
      </div>
    </div>
  );
}
