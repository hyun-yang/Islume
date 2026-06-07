"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Application, Text } from "pixi.js";

import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";
import { useVisitSocket } from "@/hooks/useVisitSocket";
import { useEndVisit } from "@/hooks/useVisit";
import { fetchVisitMessages, createRpsRound } from "@/lib/api";
import type { DMMessage } from "@/lib/types";
import VisitChatPanel from "@/components/island/VisitChatPanel";
import RPSGameDialog from "@/components/visit/RPSGameDialog";

import {
  loadLevel, isGoalTile, aabbOverlapsHazard,
  TILE_PF_SIZE, type LevelData, type LevelMap, type StageId,
} from "@/lib/platformer/types";
import { generatePlatformerTileTextures } from "@/lib/platformer/tilesetTextures";
import { generatePlatformerCharacterTextures, type CharacterTextureSet } from "@/lib/platformer/characterTextures";
import { loadPlatformerCharacterTexturesFromAtlas } from "@/lib/platformer/characterTexturesAtlas";
import { generatePlatformerEnemyTextures } from "@/lib/platformer/enemyTextures";
import { generatePlatformerItemTextures } from "@/lib/platformer/itemTextures";
import { generatePlatformerPlatformTextures } from "@/lib/platformer/platformTextures";
import { generatePlatformerBossTextures } from "@/lib/platformer/bossTextures";
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

import { PlatformerRenderer } from "./PlatformerRenderer";
import { Player } from "./Player";
import { ActorManager, type ActorEvents } from "./ActorManager";
import { PlatformerCamera } from "./PlatformerCamera";
import { KeyboardInput } from "./input/KeyboardInput";
import TouchInput from "./input/TouchInput";
import PlatformerHUD from "./hud/PlatformerHUD";
import EndingDialog from "./hud/EndingDialog";

interface Props {
  visitId: string;
}

const MAX_HP = 3;
const START_LIVES = 3;
const SHELLS_PER_LIFE = 100;

type GameStatus = "loading" | "playing" | "cleared" | "gameover";

export default function IslandPlatformerView({ visitId }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const playerRef = useRef<Player | null>(null);
  const inputRef = useRef<KeyboardInput | null>(null);
  const goalReachedRef = useRef(false);
  const checkpointReachedRef = useRef(false);
  const spawnRef = useRef({ x: 0, y: 0 });

  const [status, setStatus] = useState<GameStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [hp, setHp] = useState(MAX_HP);
  const [shells, setShells] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [currentStage, setCurrentStage] = useState<StageId>("stage1");
  const stageName = STAGE_DATA[currentStage].name;
  const currentStageRef = useRef<StageId>(currentStage);
  useEffect(() => { currentStageRef.current = currentStage; }, [currentStage]);
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

  // ---- Goal handling (decoupled from PIXI loop so React state changes settle) ----
  const triggerGoal = useCallback(() => {
    if (goalReachedRef.current) return;
    goalReachedRef.current = true;
    const player = playerRef.current;
    if (player) {
      player.controlsLocked = true;
      player.vx = 0;
    }
    // Only the final stage triggers the visit-arrival socket event so DM
    // chat unlocks once the player has actually completed the journey.
    if (currentStageRef.current === "stage3") {
      socketRef.current.sendArrive();
    }
    sound.flag();
    sound.stopBgm();
    setStatus("cleared");
  }, []);

  const handleStartChat = useCallback(() => {
    setStatus("playing");
  }, []);

  const handleNextStage = useCallback(() => {
    // Reset run-state refs; the useEffect will tear down and rebuild Pixi.
    goalReachedRef.current = false;
    checkpointReachedRef.current = false;
    setHp(MAX_HP);
    setStatus("loading");
    setCurrentStage((cur) => NEXT_STAGE[cur] ?? cur);
  }, []);

  const handleLeave = useCallback(() => {
    leaveVisit();
  }, [leaveVisit]);

  const handleRetry = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.respawn(spawnRef.current.x, spawnRef.current.y);
    player.hp = MAX_HP;
    setHp(MAX_HP);
    setLives(START_LIVES);
    setShells(0);
    goalReachedRef.current = false;
    checkpointReachedRef.current = false;
    setStatus("playing");
  }, []);

  // ---- Main PIXI init ----
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    let app: Application | null = null;
    let renderer: PlatformerRenderer | null = null;
    let manager: ActorManager | null = null;
    let camera: PlatformerCamera | null = null;
    let player: Player | null = null;
    let input: KeyboardInput | null = null;
    let initialized = false;
    let onVKey: ((e: KeyboardEvent) => void) | null = null;

    (async () => {
      // 1. Load level (depends on currentStage; effect re-runs on stage change)
      const level: LevelMap = loadLevel(STAGE_DATA[currentStage]);

      // 2. Init Pixi
      app = new Application();
      await app.init({
        background: 0xa8d8ff,
        resizeTo: canvasRef.current!,
        antialias: false,
      });
      if (cancelled) {
        try { app.destroy(true, { children: true }); } catch { /* init may not be fully wired */ }
        return;
      }
      canvasRef.current!.appendChild(app.canvas);
      appRef.current = app;

      // 3. Generate textures
      const tileTextures = generatePlatformerTileTextures(app.renderer);
      const charTexturesV1 = generatePlatformerCharacterTextures(app.renderer);
      // V2 atlas loaded in parallel; non-blocking — V toggle stays disabled on failure.
      let charTexturesV2: CharacterTextureSet | null = null;
      try {
        charTexturesV2 = await loadPlatformerCharacterTexturesFromAtlas();
      } catch (e) {
        console.warn("[platformer] v2 atlas load failed, V toggle disabled:", e);
      }
      if (cancelled) return;
      // Tani uses the same character body in a different palette so the
      // host reads as a distinct figure standing next to the flag.
      const taniTextures = generatePlatformerCharacterTextures(app.renderer, 0x42a5f5);
      const enemyTextures = generatePlatformerEnemyTextures(app.renderer);
      const itemTextures = generatePlatformerItemTextures(app.renderer);
      const platformTextures = generatePlatformerPlatformTextures(app.renderer);
      const bossTextures = generatePlatformerBossTextures(app.renderer);

      // 4. Build engine
      renderer = new PlatformerRenderer(app, level, tileTextures);

      const spawnPxX = level.spawn.x * TILE_PF_SIZE + TILE_PF_SIZE / 2;
      const spawnPxY = level.spawn.y * TILE_PF_SIZE;
      spawnRef.current = { x: spawnPxX, y: spawnPxY };

      player = new Player(spawnPxX, spawnPxY, charTexturesV1);
      renderer.getActorsContainer().addChild(player.container);
      playerRef.current = player;

      // Local copies for the events closure (player ref may change)
      const playerLocal = player;
      const events: ActorEvents = {
        onShellCollected: () => {
          sound.shell();
          setShells((prev) => {
            const next = prev + 1;
            if (next >= SHELLS_PER_LIFE) {
              setLives((l) => l + 1);
              return next - SHELLS_PER_LIFE;
            }
            return next;
          });
        },
        onHeartCollected: () => { sound.heart(); setHp(playerLocal.hp); },
        onPlayerDamaged:  () => { sound.damage(); setHp(playerLocal.hp); },
        onEnemyStomped:   () => sound.stomp(),
        onBananaCollected: () => sound.banana(),
        onPineappleCollected: () => sound.pineapple(),
        onBossCleared: () => sound.bossCleared(),
      };
      manager = new ActorManager(
        renderer.getActorsContainer(), level, enemyTextures, itemTextures, events,
        platformTextures, bossTextures, taniTextures,
      );

      camera = new PlatformerCamera(app, level, player);
      camera.snap();

      input = new KeyboardInput();
      input.attach();
      inputRef.current = input;

      initialized = true;
      sound.startBgm(currentStage);
      setStatus("playing");

      // Sprite A/B toggle (V key). Player only — NPCs keep v1 Graphics palette.
      let spriteVersion: "v1" | "v2" = "v1";
      const versionLabel = new Text({
        text: "Sprite: v1",
        style: {
          fontFamily: "monospace",
          fontSize: 14,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 3 },
        },
      });
      versionLabel.zIndex = 9999;
      const positionLabel = () => {
        versionLabel.x = app!.renderer.width - versionLabel.width - 8;
        versionLabel.y = 8;
      };
      positionLabel();
      app.stage.addChild(versionLabel);

      onVKey = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() !== "v") return;
        if (!charTexturesV2 || !playerRef.current) return;
        spriteVersion = spriteVersion === "v1" ? "v2" : "v1";
        playerRef.current.applyTextures(spriteVersion === "v1" ? charTexturesV1 : charTexturesV2);
        versionLabel.text = `Sprite: ${spriteVersion}`;
        positionLabel();
      };
      window.addEventListener("keydown", onVKey);

      // 5. Game loop
      let frameCount = 0;
      const deathLine = level.height * TILE_PF_SIZE + 80;

      // Single setLives functional update to avoid stale-closure bugs.
      const handleDeath = () => {
        const p = playerLocal;
        setLives((cur) => {
          if (cur <= 1) {
            // Out of lives — pin the player and show game-over.
            p.controlsLocked = true;
            p.vx = 0;
            p.vy = 0;
            setStatus("gameover");
            return 0;
          }
          const respawnAt = checkpointReachedRef.current
            ? {
                x: (level.checkpoints[0]?.x ?? level.spawn.x) * TILE_PF_SIZE + TILE_PF_SIZE / 2,
                y: (level.checkpoints[0]?.y ?? level.spawn.y) * TILE_PF_SIZE,
              }
            : spawnRef.current;
          p.respawn(respawnAt.x, respawnAt.y);
          p.hp = MAX_HP;
          setHp(MAX_HP);
          return cur - 1;
        });
      };

      app.ticker.add((ticker) => {
        if (!app || !renderer || !manager || !camera || !player || !input) return;
        const dt = Math.min(ticker.deltaMS / 1000, 1 / 30);

        if (!player.controlsLocked) {
          player.update(dt, level, input);
          manager.update(dt, player);
        } else {
          // Still apply gravity etc. while locked, so the character settles
          player.update(dt, level, input);
        }

        camera.update();
        renderer.update(camera.x, camera.y, app.screen.width, app.screen.height);

        // Mirror HP changes (the actor system may have damaged the player this frame).
        // Capture hp here — the setHp callback runs async and may execute after
        // cleanup nulls `player` during a stage transition.
        if (++frameCount % 4 === 0) {
          const currentHp = player.hp;
          setHp((cur) => (cur !== currentHp ? currentHp : cur));
        }

        // Checkpoint check
        if (!checkpointReachedRef.current && level.checkpoints.length > 0) {
          const cp = level.checkpoints[0];
          if (player.x >= cp.x * TILE_PF_SIZE) {
            checkpointReachedRef.current = true;
          }
        }

        // Goal check (overlap with any TILE_PF_FLAG_POLE)
        if (!goalReachedRef.current) {
          const b = player.bounds();
          const tx0 = Math.floor(b.left / TILE_PF_SIZE);
          const tx1 = Math.floor(b.right / TILE_PF_SIZE);
          const ty0 = Math.floor(b.top / TILE_PF_SIZE);
          const ty1 = Math.floor(b.bottom / TILE_PF_SIZE);
          outer: for (let ty = ty0; ty <= ty1; ty++) {
            for (let tx = tx0; tx <= tx1; tx++) {
              if (isGoalTile(level, tx, ty)) {
                triggerGoal();
                break outer;
              }
            }
          }
        }

        // Hazard tile (water) — instant kill, bypasses i-frames
        if (!goalReachedRef.current && !player.controlsLocked) {
          const b = player.bounds();
          if (aabbOverlapsHazard(level, b.left, b.top, b.right, b.bottom)) {
            player.kill();
          }
        }

        // Death (HP zero or fell off the map)
        if (!goalReachedRef.current
            && (player.hp <= 0 || player.y > deathLine)
            && !player.controlsLocked) {
          handleDeath();
        }
      });
    })().catch((e) => {
      console.error("[platformer] init error:", e);
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      cancelled = true;
      input?.detach();
      inputRef.current = null;
      if (onVKey) window.removeEventListener("keydown", onVKey);
      onVKey = null;
      sound.stopBgm();
      // If init never finished, the async block destroys its own app when it
      // resumes and sees `cancelled`. We only own teardown after `initialized`.
      if (!initialized) return;
      try {
        manager?.destroy();
        player?.destroy();
        renderer?.destroy();
        app?.destroy(true, { children: true });
      } catch (e) {
        console.warn("[platformer] cleanup error:", e);
      }
      manager = null;
      player = null;
      playerRef.current = null;
      renderer = null;
      app = null;
      appRef.current = null;
    };
    // Stage transitions trigger a full re-init via the currentStage dep.
    // visitId/triggerGoal are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {status !== "loading" && inputRef.current && (
        <TouchInput input={inputRef.current} />
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
