"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { declineRpsRound } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function RpsInvitationToast() {
  const t = useT();
  const invite = useAppStore((s) => s.pendingRpsInvite);
  const setRpsInvite = useAppStore((s) => s.setRpsInvite);
  const setAcceptedHostRpsRound = useAppStore((s) => s.setAcceptedHostRpsRound);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const [busy, setBusy] = useState(false);

  if (!invite) return null;

  const onAccept = () => {
    setAcceptedHostRpsRound(invite);
    setRpsInvite(null);
  };

  const onDecline = async () => {
    if (!selectedUserId) return;
    setBusy(true);
    try {
      await declineRpsRound(invite.visitId, invite.roundId, selectedUserId);
    } catch {
      // Even on failure, dismiss the toast to free the user; the round will
      // expire on its own via the 60s TTL.
    }
    setRpsInvite(null);
    setBusy(false);
  };

  return (
    <div className="fixed top-20 right-4 z-[60] pointer-events-auto">
      <div className="bg-gradient-to-b from-indigo-100 to-indigo-200 rounded-xl shadow-2xl border-2 border-indigo-400 p-4 max-w-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">🎮</span>
          <div className="font-bold text-indigo-900">{t("notif.gameChallenge")}</div>
        </div>
        <div className="text-sm text-zinc-700 mb-3">
          <span className="font-semibold">{invite.visitorName || t("notif.aVisitor")}</span> {t("notif.wantsToPlay")}{" "}
          <span className="font-semibold">{t("notif.rockPaperScissors")}</span> {t("notif.for")}{" "}
          <span className="font-bold">{invite.wagerAmount} ISL</span>.
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onDecline}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-300 disabled:opacity-50"
          >
            {t("notif.decline")}
          </button>
          <button
            onClick={onAccept}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-50"
          >
            {t("notif.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
