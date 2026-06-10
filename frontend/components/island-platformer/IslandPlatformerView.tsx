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

import type { LevelData, StageId } from "@/lib/platformer/types";
import { sound } from "@/lib/platformer/audio";
import stage1Data from "@/lib/platformer/levels/stage1.json";
import stage2Data from "@/lib/platformer/levels/stage2.json";
import stage3Data from "@/lib/platformer/levels/stage3.json";

const STAGE_DATA: Record<StageId, LevelData> = {
  stage1: stage1Data as LevelData,
  stage2: stage2Data as LevelData,
  stage3: stage3Data as LevelData,
};

const NEXT_STAGE: Partial<Record<StageId, StageId>> = {
  stage1: "stage2",
  stage2: "stage3",
};

import {
  createPlatformerRun, MAX_HP, START_LIVES, type PlatformerRun,
} from "./PlatformerGameRuntime";
import type { KeyboardInput } from "./input/KeyboardInput";
import TouchInput from "./input/TouchInput";
import PlatformerHUD from "./hud/PlatformerHUD";
import EndingDialog from "./hud/EndingDialog";

interface Props {
  visitId: string;
}

type GameStatus = "loading" | "playing" | "cleared" | "gameover";

export default function IslandPlatformerView({ visitId }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<PlatformerRun | null>(null);
  // Shells/lives carry across stage transitions — mirrored into refs so the
  // next stage's runtime can be seeded without adding them to effect deps.
  const shellsRef = useRef(0);
  const livesRef = useRef(START_LIVES);

  // The run's keyboard input, delivered by onReady — state (not a ref) so
  // TouchInput can read it during render.
  const [gameInput, setGameInput] = useState<KeyboardInput | null>(null);
  const [status, setStatus] = useState<GameStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hp, setHp] = useState(MAX_HP);
  const [shells, setShells] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [currentStage, setCurrentStage] = useState<StageId>("stage1");
  const stageName = STAGE_DATA[currentStage].name;
  const isFinalStage = currentStage === "stage3";

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

  // ESC to leave + unlock audio on first user gesture (browser autoplay policy)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      sound.unlock();
      if (e.key === "Escape") leaveVisit();
    };
    const onGesture = () => sound.unlock();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("touchstart", onGesture);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
    };
  }, [leaveVisit]);

  const handleStartChat = useCallback(() => {
    setStatus("playing");
  }, []);

  const handleNextStage = useCallback(() => {
    // The currentStage change tears down this run and builds the next one.
    setHp(MAX_HP);
    setStatus("loading");
    setCurrentStage((cur) => NEXT_STAGE[cur] ?? cur);
  }, []);

  const handleLeave = useCallback(() => {
    leaveVisit();
  }, [leaveVisit]);

  const handleRetry = useCallback(() => {
    if (runRef.current?.retry()) setStatus("playing");
  }, []);

  // ---- Main PIXI init (engine lives in PlatformerGameRuntime.ts) ----
  useEffect(() => {
    if (!canvasRef.current) return;
    const run = createPlatformerRun({
      mount: canvasRef.current,
      level: STAGE_DATA[currentStage],
      bgmTrack: currentStage,
      initialShells: shellsRef.current,
      initialLives: livesRef.current,
      callbacks: {
        onReady: (input) => {
          setGameInput(input);
          setStatus("playing");
        },
        onCleared: () => {
          // Only the final stage triggers the visit-arrival socket event so DM
          // chat unlocks once the player has actually completed the journey.
          if (currentStage === "stage3") {
            socketRef.current.sendArrive();
          }
          setStatus("cleared");
        },
        onGameOver: () => setStatus("gameover"),
        onHpChange: setHp,
        onShellsChange: (s) => { shellsRef.current = s; setShells(s); },
        onLivesChange: (l) => { livesRef.current = l; setLives(l); },
        onError: setError,
      },
    });
    runRef.current = run;
    return () => {
      run.destroy();
      runRef.current = null;
      setGameInput(null);
    };
    // Stage transitions trigger a full re-init via the currentStage dep;
    // visitId forces a fresh run per visit. Socket arrives via socketRef.
  }, [visitId, currentStage]);

  // ---- Render ----
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black text-white p-8">
        <div className="text-center">
          <div className="text-red-400 mb-3">{t("game.failedToLoad")}: {error}</div>
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
          <div className="animate-pulse">{t("game.loadingStage")}</div>
        </div>
      )}

      {status !== "loading" && (
        <PlatformerHUD
          hp={hp}
          maxHp={MAX_HP}
          shells={shells}
          lives={lives}
          stageName={stageName}
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

      {status === "cleared" && !visitorActiveRpsRound && (
        <EndingDialog
          hostName={activeVisitHostName ?? "friend"}
          visitorName={selectedUserName ?? ""}
          shellsCollected={shells}
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

      {status === "gameover" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-2xl border-4 border-red-500 p-6 max-w-sm w-[90%] text-white text-center">
            <div className="text-3xl font-bold mb-2">😵 {t("game.gameOver")}</div>
            <div className="text-sm text-zinc-300 mb-5">
              {shells} {t("game.shellsTryAgain")}
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

      {status !== "loading" && gameInput && (
        <TouchInput input={gameInput} />
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
