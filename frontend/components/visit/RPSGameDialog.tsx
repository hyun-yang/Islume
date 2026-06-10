"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HAND_EMOJI,
  type Hand,
} from "@/lib/visit/rps";
import { fetchBalance, submitRpsPick, createRpsRound } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";

type Role = "visitor" | "host";

interface Props {
  role: Role;
  myUserId: string;
  myDisplayName: string;
  opponentDisplayName: string;
  visitId: string;
  roundId: string;
  wagerAmount: number;
  currencyLabel?: string;
  onClose: () => void;
  /**
   * Visitor only — initiator can request another round; the server treats this
   * the same as a fresh invite to the host.
   */
  canRequestRematch?: boolean;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; balance: number }
  | { kind: "picking"; mine: Hand }
  | { kind: "waiting" }
  | { kind: "result"; mine: Hand; opp: Hand; resultText: string; tone: "win" | "lose" | "draw"; balanceAfter?: number }
  | { kind: "cancelled"; reason: string };

export default function RPSGameDialog({
  role, myUserId, myDisplayName, opponentDisplayName,
  visitId, roundId: initialRoundId, wagerAmount,
  currencyLabel = "ISL", onClose, canRequestRematch,
}: Props) {
  const t = useT();
  const [roundId, setRoundId] = useState(initialRoundId);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const lastRpsReveal = useAppStore((s) => s.lastRpsReveal);
  const lastRpsCancelled = useAppStore((s) => s.lastRpsCancelled);
  const setLastRpsReveal = useAppStore((s) => s.setLastRpsReveal);
  const setLastRpsCancelled = useAppStore((s) => s.setLastRpsCancelled);
  const setVisitorActiveRpsRound = useAppStore((s) => s.setVisitorActiveRpsRound);

  // Initial balance fetch.
  const refreshBalance = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const b = await fetchBalance(myUserId);
      setPhase({ kind: "ready", balance: b.balance });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "balance_fetch_failed";
      setPhase({ kind: "cancelled", reason });
    }
  }, [myUserId]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance, roundId]);

  // Watch for reveal events targeted at this round.
  useEffect(() => {
    if (!lastRpsReveal || lastRpsReveal.roundId !== roundId) return;
    const { visitorPick, hostPick, outcome, balanceAfter } = lastRpsReveal;
    const mine = role === "visitor" ? visitorPick : hostPick;
    const opp = role === "visitor" ? hostPick : visitorPick;
    let resultText: string;
    let tone: "win" | "lose" | "draw";
    if (outcome === "draw") {
      tone = "draw";
      resultText = `${t("rps.draw")} ${t("rps.noExchange").replace("{currency}", currencyLabel)}`;
    } else {
      const iWon = (role === "visitor" && outcome === "win") || (role === "host" && outcome === "lose");
      tone = iWon ? "win" : "lose";
      resultText = iWon
        ? `${t("rps.youWon")} +${wagerAmount} ${currencyLabel}`
        : `${t("rps.youLost")} −${wagerAmount} ${currencyLabel}`;
    }
    setPhase({ kind: "result", mine, opp, resultText, tone, balanceAfter });
    setLastRpsReveal(null);
  }, [lastRpsReveal, roundId, role, currencyLabel, wagerAmount, setLastRpsReveal, t]);

  // Watch for cancellation events.
  useEffect(() => {
    if (!lastRpsCancelled || lastRpsCancelled.roundId !== roundId) return;
    setPhase({ kind: "cancelled", reason: lastRpsCancelled.reason });
    setLastRpsCancelled(null);
  }, [lastRpsCancelled, roundId, setLastRpsCancelled]);

  const onPick = useCallback(async (mine: Hand) => {
    setPhase({ kind: "picking", mine });
    try {
      const round = await submitRpsPick(visitId, roundId, myUserId, mine);
      // If the opponent had already picked, the server resolves immediately;
      // we may receive the reveal before the response returns. The reveal
      // effect handles the result; otherwise we wait.
      if (round.status === "pending") {
        setPhase({ kind: "waiting" });
      }
      // status=revealed/cancelled is delivered via user-channel reveal event.
    } catch (e) {
      const reason = e instanceof Error ? e.message : "submit_failed";
      setPhase({ kind: "cancelled", reason });
    }
  }, [visitId, roundId, myUserId]);

  const onRematch = useCallback(async () => {
    if (!canRequestRematch) return;
    try {
      const round = await createRpsRound(visitId, myUserId);
      setRoundId(round.round_id);
      setVisitorActiveRpsRound({
        visitId,
        roundId: round.round_id,
        wagerAmount: round.wager_amount,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "rematch_failed";
      setPhase({ kind: "cancelled", reason });
    }
  }, [canRequestRematch, visitId, myUserId, setVisitorActiveRpsRound]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
      <div className="bg-gradient-to-b from-indigo-100 to-indigo-200 rounded-2xl shadow-2xl border-4 border-indigo-400 p-6 max-w-md w-[90%] text-zinc-800">
        <div className="text-2xl text-center font-bold mb-1">{t("rps.title")}</div>
        <div className="text-center text-sm text-zinc-600 mb-3">
          {myDisplayName} vs. {opponentDisplayName}
        </div>

        {phase.kind === "loading" && (
          <div className="text-center py-8 text-zinc-700 animate-pulse">{t("common.loading")}</div>
        )}

        {phase.kind === "ready" && (
          <>
            <div className="text-center text-sm text-zinc-700 mb-4">
              {t("rps.wager")} <span className="font-bold">{wagerAmount} {currencyLabel}</span>
              {" · "}
              {t("rps.yourBalance")} <span className="font-bold">{phase.balance} {currencyLabel}</span>
            </div>
            <div className="text-center text-sm font-medium mb-3">{t("rps.chooseHand")}</div>
            <div className="flex gap-3 justify-center mb-4">
              {(["rock", "paper", "scissors"] as Hand[]).map((h) => (
                <button
                  key={h}
                  onClick={() => onPick(h)}
                  className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-white hover:bg-indigo-50 border-2 border-indigo-300 text-zinc-800 transition-colors shadow-sm"
                >
                  <span className="text-3xl">{HAND_EMOJI[h]}</span>
                  <span className="text-xs font-bold">{t(`rps.${h}`)}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-center">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-zinc-300 text-zinc-700 text-sm font-medium hover:bg-zinc-400"
              >
                {t("rps.quit")}
              </button>
            </div>
          </>
        )}

        {phase.kind === "picking" && (
          <div className="text-center py-8">
            <div className="text-5xl mb-2">{HAND_EMOJI[phase.mine]}</div>
            <div className="text-sm text-zinc-700">{t("rps.lockedIn")} {t("rps.waitingFor")} {opponentDisplayName}…</div>
          </div>
        )}

        {phase.kind === "waiting" && (
          <div className="text-center py-8">
            <div className="text-sm text-zinc-700 animate-pulse">{t("rps.waitingFor")} {opponentDisplayName}…</div>
          </div>
        )}

        {phase.kind === "result" && (
          <>
            <div className="text-center mb-3">
              <div className="text-3xl mb-1">
                {t("common.you")} {HAND_EMOJI[phase.mine]} · {opponentDisplayName} {HAND_EMOJI[phase.opp]}
              </div>
              <div className={
                phase.tone === "win"
                  ? "text-emerald-700 font-bold text-lg"
                  : phase.tone === "lose"
                    ? "text-rose-700 font-bold text-lg"
                    : "text-zinc-700 font-bold text-lg"
              }>
                {phase.resultText}
              </div>
              {phase.balanceAfter !== undefined && (
                <div className="text-xs text-zinc-600 mt-1">
                  {t("rps.yourBalance")} {phase.balanceAfter} {currencyLabel}
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              {canRequestRematch && (
                <button
                  onClick={onRematch}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600 shadow-md"
                >
                  {t("rps.playAgain")}
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-zinc-300 text-zinc-700 font-bold hover:bg-zinc-400"
              >
                {canRequestRematch ? t("rps.quit") : t("common.close")}
              </button>
            </div>
          </>
        )}

        {phase.kind === "cancelled" && (
          <>
            <div className="text-center mb-4">
              <div className="text-rose-700 font-bold text-lg">{t("rps.roundCancelled")}</div>
              <div className="text-xs text-zinc-600 mt-1">{phase.reason}</div>
            </div>
            <div className="flex justify-center">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-zinc-300 text-zinc-700 font-bold hover:bg-zinc-400"
              >
                {t("common.close")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
