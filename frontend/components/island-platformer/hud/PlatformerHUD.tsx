"use client";

import { useState } from "react";
import { sound } from "@/lib/platformer/audio";
import { useT } from "@/lib/i18n";

interface Props {
  hp: number;
  maxHp: number;
  shells: number;
  lives: number;
  stageName: string;
}

export default function PlatformerHUD({ hp, maxHp, shells, lives, stageName }: Props) {
  const t = useT();
  const [muted, setMuted] = useState(() => sound.isMuted());
  const onToggleMute = () => {
    setMuted(sound.toggleMute());
  };

  const hearts = [];
  for (let i = 0; i < maxHp; i++) {
    const filled = i < hp;
    hearts.push(
      <span
        key={i}
        className={`text-2xl transition-opacity ${filled ? "" : "opacity-30 grayscale"}`}
        style={{ filter: filled ? "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" : undefined }}
      >
        ❤️
      </span>,
    );
  }

  return (
    <div className="absolute top-3 left-3 right-3 z-40 flex items-start justify-between pointer-events-none">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">{hearts}</div>
        <div
          className="flex items-center gap-2 text-white text-sm font-bold"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
        >
          <span className="text-xl">🐚</span>
          <span>{String(shells).padStart(3, "0")} / 100</span>
        </div>
        <div
          className="flex items-center gap-2 text-white text-sm font-bold"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
        >
          <span className="text-xl">▶</span>
          <span>× {lives}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleMute}
          className="pointer-events-auto px-2 py-1 rounded-md bg-black/40 hover:bg-black/60 text-white text-sm border border-white/10 backdrop-blur-sm"
          title={muted ? t("game.unmute") : t("game.mute")}
          aria-label={muted ? t("game.unmute") : t("game.mute")}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <div
          className="text-white text-sm font-bold bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
        >
          {stageName}
        </div>
      </div>
    </div>
  );
}
