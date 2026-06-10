"use client";

// Test-play mode for the stage editor: runs the author's level on the exact
// game runtime visitors will play (createPlatformerRun), with only the HUD
// and cleared/game-over overlays — no chat/RPS/visit chrome. Reaching the
// flag fires onClear exactly once (the parent POSTs the cleared flag).

import { useEffect, useRef, useState } from "react";

import { useT } from "@/lib/i18n";
import { sound } from "@/lib/platformer/audio";
import type { Background, LevelData, StageId } from "@/lib/platformer/types";
import {
  createPlatformerRun, MAX_HP, START_LIVES, type PlatformerRun,
} from "@/components/island-platformer/PlatformerGameRuntime";
import PlatformerHUD from "@/components/island-platformer/hud/PlatformerHUD";

// Custom stages carry no StageId, so BGM follows the background theme.
const BGM_BY_BACKGROUND: Record<Background, StageId> = {
  beach: "stage1",
  stream: "stage2",
  forest: "stage3",
};

type Status = "loading" | "playing" | "cleared" | "gameover";

interface Props {
  /** Snapshot of the level under test — must be referentially stable. */
  level: LevelData;
  onClear: () => void;
  onExit: () => void;
}

export default function StageTestPlay({ level, onClear, onExit }: Props) {
  const t = useT();
  const mountRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<PlatformerRun | null>(null);
  const clearedOnceRef = useRef(false);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hp, setHp] = useState(MAX_HP);
  const [shells, setShells] = useState(0);
  const [lives, setLives] = useState(START_LIVES);

  const onClearRef = useRef(onClear);
  useEffect(() => { onClearRef.current = onClear; }, [onClear]);
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  // ESC to leave + unlock audio on first user gesture (browser autoplay policy)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      sound.unlock();
      if (e.key === "Escape") onExitRef.current();
    };
    const onGesture = () => sound.unlock();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onGesture);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onGesture);
    };
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    const run = createPlatformerRun({
      mount: mountRef.current,
      level,
      bgmTrack: BGM_BY_BACKGROUND[level.background],
      callbacks: {
        onReady: () => setStatus("playing"),
        onCleared: () => {
          setStatus("cleared");
          if (!clearedOnceRef.current) {
            clearedOnceRef.current = true;
            onClearRef.current();
          }
        },
        onGameOver: () => setStatus("gameover"),
        onHpChange: setHp,
        onShellsChange: setShells,
        onLivesChange: setLives,
        onError: setError,
      },
    });
    runRef.current = run;
    return () => {
      run.destroy();
      runRef.current = null;
    };
  }, [level]);

  const handleRetry = () => {
    if (runRef.current?.retry()) setStatus("playing");
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black text-white p-8">
        <div className="text-center">
          <div className="text-red-400 mb-3">{t("game.failedToLoad")}: {error}</div>
          <button
            onClick={() => onExitRef.current()}
            className="px-4 py-2 bg-zinc-700 rounded"
          >
            {t("editor.backToEditor")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative bg-[#a8d8ff] select-none">
      <div ref={mountRef} className="absolute inset-0" />

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white z-50">
          <div className="animate-pulse">{t("game.loadingStage")}</div>
        </div>
      )}

      {status !== "loading" && (
        <PlatformerHUD
          hp={hp}
          maxHp={MAX_HP}
          shells={shells}
          lives={lives}
          stageName={level.name}
        />
      )}

      {status !== "loading" && (
        <button
          onClick={() => onExitRef.current()}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-5 py-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-white text-sm font-bold shadow-lg ring-2 ring-white/40 backdrop-blur-sm"
          title="ESC"
        >
          ← {t("editor.backToEditor")}
        </button>
      )}

      {status === "cleared" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-2xl border-4 border-emerald-500 p-6 max-w-sm w-[90%] text-white text-center">
            <div className="text-3xl font-bold mb-2">🎉 {t("editor.testCleared")}</div>
            <div className="text-sm text-zinc-300 mb-5">{t("editor.clearedHint")}</div>
            <button
              onClick={() => onExitRef.current()}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600"
            >
              {t("editor.backToEditor")}
            </button>
          </div>
        </div>
      )}

      {status === "gameover" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-2xl border-4 border-red-500 p-6 max-w-sm w-[90%] text-white text-center">
            <div className="text-3xl font-bold mb-5">😵 {t("game.gameOver")}</div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600"
              >
                {t("common.retry")}
              </button>
              <button
                onClick={() => onExitRef.current()}
                className="px-4 py-2 rounded-lg bg-zinc-700 text-white font-bold hover:bg-zinc-600"
              >
                {t("editor.backToEditor")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
