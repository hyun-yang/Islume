"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";
import { useVisitSocket } from "@/hooks/useVisitSocket";
import { useEndVisit } from "@/hooks/useVisit";
import { fetchVisitMessages, createRpsRound } from "@/lib/api";
import type { DMMessage } from "@/lib/types";
import VisitChatPanel from "@/components/island/VisitChatPanel";
import RPSGameDialog from "@/components/visit/RPSGameDialog";

import { BUILTIN_PUZZLE_STAGES } from "@/lib/puzzle/stages";
import { createPuzzleRun, type PuzzleRun } from "./PuzzleGameRuntime";
import PuzzleHUD from "./hud/PuzzleHUD";
import PuzzleEndingDialog from "./hud/PuzzleEndingDialog";

interface Props {
  visitId: string;
}

type GameStatus = "loading" | "playing" | "cleared" | "failed";

// The visit plumbing below (socket, DM chat, RPS invite, single leave path)
// mirrors IslandPlatformerView; extracting a shared visit-shell hook is
// deferred until a third game shows the stable common shape.
export default function IslandPuzzleView({ visitId }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<PuzzleRun | null>(null);

  const [status, setStatus] = useState<GameStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [movesLeft, setMovesLeft] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [shuffledToast, setShuffledToast] = useState(false);

  // Visit chat state
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [typingPeers, setTypingPeers] = useState<Set<string>>(new Set());
  const seenIdsRef = useRef<Set<string>>(new Set());

  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const selectedUserName = useAppStore((s) => s.selectedUserName);
  const visitStatus = useAppStore((s) => s.visitStatus);
  const activeVisitHostId = useAppStore((s) => s.activeVisitHostId);
  const activeVisitHostName = useAppStore((s) => s.activeVisitHostName);
  const setVisitStatus = useAppStore((s) => s.setVisitStatus);
  const endVisit = useEndVisit();

  // Built-in stages only for now; host-authored puzzle stages arrive with
  // editor support (island_stages + game_type discriminator).
  const stage = BUILTIN_PUZZLE_STAGES[Math.min(stageIndex, BUILTIN_PUZZLE_STAGES.length - 1)];
  const isFinalStage = stageIndex >= BUILTIN_PUZZLE_STAGES.length - 1;

  // Single exit path — fires DELETE /visits/{id} so the backend marks the
  // visit as "ended" instead of leaving an orphaned active row. The hook's
  // onSettled flips viewMode back to "world" via endVisitState.
  const leaveVisit = useCallback(() => {
    if (endVisit.isPending) return;
    endVisit.mutate(visitId);
  }, [visitId, endVisit]);

  // RPS multiplayer
  const visitorActiveRpsRound = useAppStore((s) => s.visitorActiveRpsRound);
  const setVisitorActiveRpsRound = useAppStore((s) => s.setVisitorActiveRpsRound);
  const [rpsError, setRpsError] = useState<string | null>(null);

  const onPlayGame = useCallback(async () => {
    if (!selectedUserId || !activeVisitHostId) return;
    setRpsError(null);
    try {
      const round = await createRpsRound(visitId, selectedUserId);
      setVisitorActiveRpsRound({
        visitId,
        roundId: round.round_id,
        wagerAmount: round.wager_amount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("game.failedToStartRound");
      setRpsError(msg);
    }
  }, [visitId, selectedUserId, activeVisitHostId, setVisitorActiveRpsRound, t]);

  // ---- Socket ----
  const socket = useVisitSocket({
    visitId,
    onArrive: () => setVisitStatus("arrived"),
    onLeave: () => setVisitStatus("ended"),
    onMessage: (m) => {
      if (seenIdsRef.current.has(m.id)) return;
      seenIdsRef.current.add(m.id);
      setMessages((prev) => [...prev, m]);
    },
    onTyping: (sender, isTyping) => {
      setTypingPeers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(sender);
        else next.delete(sender);
        return next;
      });
    },
  });

  const socketRef = useRef(socket);
  useEffect(() => { socketRef.current = socket; }, [socket]);

  // Fetch DM history once arrived
  useEffect(() => {
    if (visitStatus !== "arrived") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchVisitMessages(visitId);
        if (cancelled) return;
        for (const m of res.messages) seenIdsRef.current.add(m.id);
        setMessages(res.messages);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [visitId, visitStatus]);

  // ESC to leave
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leaveVisit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaveVisit]);

  // Auto-hide the reshuffle toast
  useEffect(() => {
    if (!shuffledToast) return;
    const timer = setTimeout(() => setShuffledToast(false), 2500);
    return () => clearTimeout(timer);
  }, [shuffledToast]);

  const handleStartChat = useCallback(() => {
    setStatus("playing");
  }, []);

  const handleNextStage = useCallback(() => {
    // The stageIndex change tears down this run and builds the next one.
    setStatus("loading");
    setStageIndex((i) => i + 1);
  }, []);

  const handleLeave = useCallback(() => {
    leaveVisit();
  }, [leaveVisit]);

  const handleRetry = useCallback(() => {
    if (runRef.current?.retry()) setStatus("playing");
  }, []);

  // ---- Main PIXI init (engine lives in PuzzleGameRuntime.ts) ----
  useEffect(() => {
    if (!canvasRef.current) return;
    const run = createPuzzleRun({
      mount: canvasRef.current,
      stage,
      callbacks: {
        onReady: () => setStatus("playing"),
        onScoreChange: setScore,
        onMovesChange: setMovesLeft,
        onShuffled: () => setShuffledToast(true),
        onCleared: () => {
          // Only the final stage triggers the visit-arrival socket event so DM
          // chat unlocks once the player has actually completed the journey.
          if (isFinalStage) {
            socketRef.current.sendArrive();
          }
          setStatus("cleared");
        },
        onFailed: () => setStatus("failed"),
        onError: setError,
      },
    });
    runRef.current = run;
    return () => {
      run.destroy();
      runRef.current = null;
    };
    // Stage transitions re-init via the `stage` dep (stageIndex); visitId
    // forces a fresh run per visit. Socket via socketRef.
  }, [visitId, stage, isFinalStage]);

  // ---- Render ----
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black text-white p-8">
        <div className="text-center">
          <div className="text-red-400 mb-3">{t("puzzle.failedToLoad")}: {error}</div>
          <button
            onClick={leaveVisit}
            className="px-4 py-2 bg-zinc-700 rounded"
          >
            {t("game.backToWorld")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative bg-[#a8d8ff] select-none">
      <div ref={canvasRef} className="absolute inset-0" />

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white z-50">
          <div className="animate-pulse">{t("puzzle.loading")}</div>
        </div>
      )}

      {status !== "loading" && (
        <PuzzleHUD
          score={score}
          target={stage.objective.target}
          movesLeft={movesLeft}
          stageName={stage.name}
        />
      )}

      {status !== "loading" && (
        <button
          onClick={leaveVisit}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-5 py-2 rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300 hover:from-amber-400 hover:via-orange-400 hover:to-rose-400 text-amber-900 text-base font-bold shadow-lg ring-2 ring-white/70 border border-white/40 backdrop-blur-sm transition-transform hover:scale-105"
          title="ESC"
        >
          🌴 {t("game.leaveIsland")}
        </button>
      )}

      {shuffledToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-sky-100 border-2 border-sky-400 text-sky-900 px-4 py-2 rounded-lg shadow-lg text-sm">
          🔀 {t("puzzle.shuffled")}
        </div>
      )}

      {status === "cleared" && !visitorActiveRpsRound && (
        <PuzzleEndingDialog
          hostName={activeVisitHostName ?? "friend"}
          visitorName={selectedUserName ?? ""}
          score={score}
          isFinalStage={isFinalStage}
          onNextStage={handleNextStage}
          onStartChat={handleStartChat}
          onPlayGame={isFinalStage && selectedUserId && activeVisitHostId ? onPlayGame : undefined}
          onLeave={handleLeave}
        />
      )}

      {rpsError && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-rose-100 border-2 border-rose-400 text-rose-900 px-4 py-2 rounded-lg shadow-lg text-sm">
          {rpsError}
          <button
            onClick={() => setRpsError(null)}
            className="ml-3 text-rose-700 hover:text-rose-900 font-bold"
          >×</button>
        </div>
      )}

      {visitorActiveRpsRound && selectedUserId && activeVisitHostId && (
        <RPSGameDialog
          role="visitor"
          myUserId={selectedUserId}
          myDisplayName={selectedUserName ?? "you"}
          opponentDisplayName={activeVisitHostName ?? "host"}
          visitId={visitorActiveRpsRound.visitId}
          roundId={visitorActiveRpsRound.roundId}
          wagerAmount={visitorActiveRpsRound.wagerAmount}
          canRequestRematch
          onClose={() => setVisitorActiveRpsRound(null)}
        />
      )}

      {status === "failed" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-2xl border-4 border-red-500 p-6 max-w-sm w-[90%] text-white text-center">
            <div className="text-3xl font-bold mb-2">😵 {t("puzzle.outOfMoves")}</div>
            <div className="text-sm text-zinc-300 mb-5">
              🏆 {t("puzzle.score")} {score} / {stage.objective.target}
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-bold hover:bg-emerald-600"
              >
                {t("common.retry")}
              </button>
              <button
                onClick={handleLeave}
                className="px-4 py-2 rounded-lg bg-zinc-700 text-white font-bold hover:bg-zinc-600"
              >
                {t("game.endVisit")}
              </button>
            </div>
          </div>
        </div>
      )}

      <VisitChatPanel
        socket={socket}
        senderId={selectedUserId ?? ""}
        locked={visitStatus !== "arrived"}
        messages={messages}
        typingPeers={typingPeers}
        onPlayGame={selectedUserId && activeVisitHostId ? onPlayGame : undefined}
      />
    </div>
  );
}
