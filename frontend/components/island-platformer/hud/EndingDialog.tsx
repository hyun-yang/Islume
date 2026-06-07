"use client";

import { useT } from "@/lib/i18n";

interface Props {
  hostName: string;
  visitorName: string;
  shellsCollected: number;
  isFinalStage: boolean;
  onNextStage?: () => void;
  onStartChat: () => void;
  onPlayGame?: () => void;
  onLeave: () => void;
}

export default function EndingDialog({
  hostName, visitorName, shellsCollected,
  isFinalStage, onNextStage, onStartChat, onPlayGame, onLeave,
}: Props) {
  const t = useT();
  const title = isFinalStage ? `🌴 ${t("game.youArrived")}` : `🚩 ${t("game.stageCleared")}`;
  const subtitle = isFinalStage ? `${hostName}${t("game.sCabin")}` : t("game.onToNextStage");
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
      <div className="bg-gradient-to-b from-amber-100 to-amber-200 rounded-2xl shadow-2xl border-4 border-amber-400 p-6 max-w-md w-[90%] text-zinc-800">
        <div className="text-3xl text-center mb-1">{title}</div>
        <div className="text-center text-lg font-bold mb-2">{subtitle}</div>
        {isFinalStage ? (
          <div className="text-center text-sm mb-4 text-zinc-700 leading-relaxed">
            <p className="font-medium">{`"${t("game.welcome")}, ${visitorName || t("game.friend")}!"`}</p>
            <p className="mt-1">{`"${t("game.thanksForMakingIt")}"`}</p>
          </div>
        ) : (
          <div className="text-center text-sm mb-4 text-zinc-700">
            <p>{t("game.tougherStretch")}</p>
          </div>
        )}
        <div className="text-xs text-zinc-600 text-center mb-4">
          🐚 {shellsCollected} {t("game.collected")}
        </div>
        <div className="flex flex-wrap gap-3 justify-center">
          {isFinalStage ? (
            <>
              <button
                onClick={onStartChat}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-md transition-colors"
              >
                {t("game.startChat")}
              </button>
              {onPlayGame && (
                <button
                  onClick={onPlayGame}
                  className="px-4 py-2 rounded-lg bg-indigo-500 text-white font-bold hover:bg-indigo-600 shadow-md transition-colors"
                >
                  🎮 {t("game.playRps")}
                </button>
              )}
            </>
          ) : (
            <button
              onClick={onNextStage}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-md transition-colors"
            >
              {t("game.nextStage")}
            </button>
          )}
          <button
            onClick={onLeave}
            className="px-4 py-2 rounded-lg bg-zinc-300 text-zinc-700 font-bold hover:bg-zinc-400 transition-colors"
          >
            {t("game.leave")}
          </button>
        </div>
      </div>
    </div>
  );
}
