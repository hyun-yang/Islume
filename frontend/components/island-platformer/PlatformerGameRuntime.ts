// Platformer engine runtime — the Pixi init / game loop / cleanup extracted
// verbatim from IslandPlatformerView's main effect so the stage editor's
// test-play can reuse the exact same game behavior. The runtime owns run
// state (hp / shells / lives / goal / checkpoint) and mirrors changes to the
// host component through callbacks; React owns only presentation state.

import { Application, Text } from "pixi.js";

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

import { PlatformerRenderer } from "./PlatformerRenderer";
import { Player } from "./Player";
import { ActorManager, type ActorEvents } from "./ActorManager";
import { PlatformerCamera } from "./PlatformerCamera";
import { KeyboardInput } from "./input/KeyboardInput";

export const MAX_HP = 3;
export const START_LIVES = 3;
const SHELLS_PER_LIFE = 100;

interface PlatformerRunCallbacks {
  /** Init finished; the run is live. Delivers the input for TouchInput. */
  onReady(input: KeyboardInput): void;
  /** Goal flag reached — player already locked, bgm stopped. */
  onCleared(): void;
  /** Out of lives — player pinned in place. */
  onGameOver(): void;
  onHpChange(hp: number): void;
  onShellsChange(shells: number): void;
  onLivesChange(lives: number): void;
  /** Async init failed. */
  onError(message: string): void;
}

export interface PlatformerRunOptions {
  mount: HTMLElement;
  /** Raw level data — compiled via loadLevel() inside the async init so
   *  malformed data surfaces through onError, like any other init failure. */
  level: LevelData;
  bgmTrack: StageId;
  callbacks: PlatformerRunCallbacks;
  /** Carry-over from the previous stage; defaults to a fresh run. */
  initialShells?: number;
  initialLives?: number;
}

export interface PlatformerRun {
  /** Tear down Pixi + listeners. Safe to call before init completes. */
  destroy(): void;
  /**
   * Reset after game-over: spawn-point respawn, full hp, fresh lives/shells.
   * Returns false (no-op) if init hasn't completed yet.
   */
  retry(): boolean;
}

export function createPlatformerRun(opts: PlatformerRunOptions): PlatformerRun {
  const { mount, bgmTrack, callbacks } = opts;

  let cancelled = false;
  let app: Application | null = null;
  let renderer: PlatformerRenderer | null = null;
  let manager: ActorManager | null = null;
  let camera: PlatformerCamera | null = null;
  let player: Player | null = null;
  let input: KeyboardInput | null = null;
  let initialized = false;
  let onVKey: ((e: KeyboardEvent) => void) | null = null;

  // Run state (owned here, mirrored to the host via callbacks)
  let hp = MAX_HP;
  let shells = opts.initialShells ?? 0;
  let lives = opts.initialLives ?? START_LIVES;
  let goalReached = false;
  let checkpointReached = false;
  let spawnPx = { x: 0, y: 0 };

  const notifyHp = (next: number) => {
    if (next === hp) return;
    hp = next;
    callbacks.onHpChange(hp);
  };

  const triggerGoal = () => {
    if (goalReached || !player) return;
    goalReached = true;
    player.controlsLocked = true;
    player.vx = 0;
    sound.flag();
    sound.stopBgm();
    callbacks.onCleared();
  };

  (async () => {
    // 1. Load level
    const level: LevelMap = loadLevel(opts.level);

    // 2. Init Pixi
    app = new Application();
    await app.init({
      background: 0xa8d8ff,
      resizeTo: mount,
      antialias: false,
    });
    if (cancelled) {
      try { app.destroy(true, { children: true }); } catch { /* init may not be fully wired */ }
      return;
    }
    mount.appendChild(app.canvas);

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
    spawnPx = { x: spawnPxX, y: spawnPxY };

    player = new Player(spawnPxX, spawnPxY, charTexturesV1);
    renderer.getActorsContainer().addChild(player.container);

    // Local copy for the events closure (the outer `player` is nulled on destroy)
    const playerLocal = player;
    const events: ActorEvents = {
      onShellCollected: () => {
        sound.shell();
        shells += 1;
        if (shells >= SHELLS_PER_LIFE) {
          shells -= SHELLS_PER_LIFE;
          lives += 1;
          callbacks.onLivesChange(lives);
        }
        callbacks.onShellsChange(shells);
      },
      onHeartCollected: () => { sound.heart(); notifyHp(playerLocal.hp); },
      onPlayerDamaged:  () => { sound.damage(); notifyHp(playerLocal.hp); },
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

    initialized = true;
    sound.startBgm(bgmTrack);
    callbacks.onReady(input);

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
      if (!charTexturesV2) return;
      spriteVersion = spriteVersion === "v1" ? "v2" : "v1";
      playerLocal.applyTextures(spriteVersion === "v1" ? charTexturesV1 : charTexturesV2);
      versionLabel.text = `Sprite: ${spriteVersion}`;
      positionLabel();
    };
    window.addEventListener("keydown", onVKey);

    // 5. Game loop
    let frameCount = 0;
    const deathLine = level.height * TILE_PF_SIZE + 80;

    const handleDeath = () => {
      const p = playerLocal;
      if (lives <= 1) {
        // Out of lives — pin the player and show game-over.
        p.controlsLocked = true;
        p.vx = 0;
        p.vy = 0;
        lives = 0;
        callbacks.onLivesChange(lives);
        callbacks.onGameOver();
        return;
      }
      const respawnAt = checkpointReached
        ? {
            x: (level.checkpoints[0]?.x ?? level.spawn.x) * TILE_PF_SIZE + TILE_PF_SIZE / 2,
            y: (level.checkpoints[0]?.y ?? level.spawn.y) * TILE_PF_SIZE,
          }
        : spawnPx;
      p.respawn(respawnAt.x, respawnAt.y);
      p.hp = MAX_HP;
      notifyHp(MAX_HP);
      lives -= 1;
      callbacks.onLivesChange(lives);
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
      if (++frameCount % 4 === 0) {
        notifyHp(player.hp);
      }

      // Checkpoint check
      if (!checkpointReached && level.checkpoints.length > 0) {
        const cp = level.checkpoints[0];
        if (player.x >= cp.x * TILE_PF_SIZE) {
          checkpointReached = true;
        }
      }

      // Goal check (overlap with any TILE_PF_FLAG_POLE)
      if (!goalReached) {
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
      if (!goalReached && !player.controlsLocked) {
        const b = player.bounds();
        if (aabbOverlapsHazard(level, b.left, b.top, b.right, b.bottom)) {
          player.kill();
        }
      }

      // Death (HP zero or fell off the map)
      if (!goalReached
          && (player.hp <= 0 || player.y > deathLine)
          && !player.controlsLocked) {
        handleDeath();
      }
    });
  })().catch((e) => {
    console.error("[platformer] init error:", e);
    if (!cancelled) callbacks.onError(e instanceof Error ? e.message : String(e));
  });

  return {
    retry() {
      const p = player;
      if (!p) return false;
      p.respawn(spawnPx.x, spawnPx.y);
      p.hp = MAX_HP;
      notifyHp(MAX_HP);
      lives = START_LIVES;
      callbacks.onLivesChange(lives);
      shells = 0;
      callbacks.onShellsChange(shells);
      goalReached = false;
      checkpointReached = false;
      return true;
    },
    destroy() {
      cancelled = true;
      input?.detach();
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
      renderer = null;
      app = null;
    },
  };
}
