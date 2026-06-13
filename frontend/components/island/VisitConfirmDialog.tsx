"use client";

import { useState } from "react";

import { useAppStore } from "@/stores/appStore";
import { useStartVisit } from "@/hooks/useVisit";
import { useT } from "@/lib/i18n";
import { GAMES } from "@/lib/games";
import type { GameId } from "@/lib/types";

export default function VisitConfirmDialog() {
  const t = useT();
  const pendingVisit = useAppStore((s) => s.pendingVisit);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const cancelVisitRequest = useAppStore((s) => s.cancelVisitRequest);
  const startVisit = useStartVisit();
  const [gameId, setGameId] = useState<GameId>("platformer");

  if (!pendingVisit || !selectedUserId) return null;

  const hostLabel = pendingVisit.hostName;
  const isPending = startVisit.isPending;
  const errorMessage =
    startVisit.isError && startVisit.error instanceof Error ? startVisit.error.message : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-[360px] p-6">
        <h2 className="text-base font-semibold text-zinc-900 mb-2">
          {hostLabel}{t("visit.islandVisitSuffix")}
        </h2>
        <p className="text-sm text-zinc-600 mb-4">
          {t("visit.visitIntro")}
        </p>
        <div className="text-xs font-semibold text-zinc-500 mb-2">
          {t("games.choose")}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {GAMES.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameId(g.id)}
              disabled={isPending}
              className={`text-left rounded-md border p-3 transition-colors disabled:opacity-50 ${
                gameId === g.id
                  ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600"
                  : "border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              <div className="text-sm font-semibold text-zinc-900">
                {g.icon} {t(g.titleKey)}
              </div>
              <div className="text-xs text-zinc-600 mt-1">{t(g.descKey)}</div>
            </button>
          ))}
        </div>
        {errorMessage && (
          <p className="text-sm text-red-600 mb-3">{errorMessage}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={cancelVisitRequest}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() =>
              startVisit.mutate({
                visitorId: selectedUserId,
                hostId: pendingVisit.hostId,
                hostName: pendingVisit.hostName,
                gameId,
              })
            }
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-md bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {isPending ? t("visit.entering") : t("visit.enter")}
          </button>
        </div>
      </div>
    </div>
  );
}
