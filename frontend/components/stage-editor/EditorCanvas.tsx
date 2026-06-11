"use client";

// PixiJS paint surface for the stage editor. Reuses PlatformerRenderer's
// viewport-culled tile rendering by pointing it at a live LevelMap view of
// the editor model — painting writes into the shared Uint8Array and shows up
// on the next frame with no React involvement. Overlays (grid, spawn marker,
// actor ghosts, hover) are synced when the parent bumps `version`.

import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";

import {
  TILE_PF_SIZE, type ActorType, type LevelMap,
} from "@/lib/platformer/types";
import { generatePlatformerTileTextures } from "@/lib/platformer/tilesetTextures";
import { generatePlatformerCharacterTextures } from "@/lib/platformer/characterTextures";
import { generatePlatformerEnemyTextures } from "@/lib/platformer/enemyTextures";
import { generatePlatformerItemTextures } from "@/lib/platformer/itemTextures";
import { generatePlatformerPlatformTextures } from "@/lib/platformer/platformTextures";
import { generatePlatformerBossTextures } from "@/lib/platformer/bossTextures";
import { PlatformerRenderer } from "@/components/island-platformer/PlatformerRenderer";

import { EDITOR_HEIGHT, type EditorModel } from "./editorState";
import {
  PALETTE_TILES, PALETTE_ACTORS, tileThumbKey, actorThumbKey,
  type EditorTool,
} from "./palette";

const LEVEL_PX_H = EDITOR_HEIGHT * TILE_PF_SIZE;
const PAN_SPEED = 16; // px per frame while an arrow key is held

interface Props {
  model: EditorModel;
  /** Bumped by the parent after any model mutation — triggers overlay sync. */
  version: number;
  tool: EditorTool;
  /** The canvas mutated the model (paint/place); parent bumps version+dirty. */
  onMutate: () => void;
  /** Palette thumbnails (dataURLs), delivered once after texture generation. */
  onThumbnails: (thumbs: Record<string, string>) => void;
}

export default function EditorCanvas({ model, version, tool, onMutate, onThumbnails }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Live refs so tool changes / callbacks never re-run the Pixi init effect.
  const toolRef = useRef(tool);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  const onMutateRef = useRef(onMutate);
  useEffect(() => { onMutateRef.current = onMutate; }, [onMutate]);
  const onThumbnailsRef = useRef(onThumbnails);
  useEffect(() => { onThumbnailsRef.current = onThumbnails; }, [onThumbnails]);

  // Imperative handles shared between the init effect and the sync effect.
  const syncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let app: Application | null = null;
    let renderer: PlatformerRenderer | null = null;
    let initialized = false;
    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let onKeyUp: ((e: KeyboardEvent) => void) | null = null;

    (async () => {
      app = new Application();
      await app.init({ background: 0xa8d8ff, resizeTo: mount, antialias: false });
      if (cancelled) {
        try { app.destroy(true, { children: true }); } catch { /* init may not be fully wired */ }
        return;
      }
      mount.appendChild(app.canvas);

      // Textures (same generators as the game runtime)
      const tileTextures = generatePlatformerTileTextures(app.renderer);
      const taniTextures = generatePlatformerCharacterTextures(app.renderer, 0x42a5f5);
      const enemyTextures = generatePlatformerEnemyTextures(app.renderer);
      const itemTextures = generatePlatformerItemTextures(app.renderer);
      const platformTextures = generatePlatformerPlatformTextures(app.renderer);
      const bossTextures = generatePlatformerBossTextures(app.renderer);

      const actorTex: Record<ActorType, Texture> = {
        enemy_crab: enemyTextures.crab[0],
        enemy_starfish: enemyTextures.starfish[0],
        enemy_frog: enemyTextures.frog[0],
        platform_log: platformTextures.log[0],
        platform_lily: platformTextures.lily[0],
        whale: platformTextures.whale[0],
        enemy_bear_boss: bossTextures.bear[0],
        npc_tani: taniTextures.idle[0],
        item_shell: itemTextures.shell[0],
        item_heart: itemTextures.heart[0],
        item_banana: itemTextures.banana[0],
        item_pineapple: bossTextures.pineapple[0],
        block_coconut: bossTextures.coconutBlock[0],
      };

      // Live LevelMap view over the editor model: `tiles` shares the model's
      // Uint8Array, so paints appear next frame; sync() refreshes the
      // reference after resizeWidth/undo replace the array.
      const levelView: LevelMap = {
        id: "editor",
        name: model.level.name,
        background: model.level.background,
        width: model.level.width,
        height: EDITOR_HEIGHT,
        tile_size: TILE_PF_SIZE,
        spawn: model.level.spawn,
        goal: model.level.goal,
        tiles: model.level.tiles,
        actors: [],
        checkpoints: [],
      };

      renderer = new PlatformerRenderer(app, levelView, tileTextures);
      app.renderer.on("resize", () => renderer?.resize());

      const world = renderer.getWorldContainer();
      const gridGfx = new Graphics();
      gridGfx.zIndex = 5;
      world.addChild(gridGfx);

      const ghostContainer = new Container();
      ghostContainer.zIndex = 10;
      world.addChild(ghostContainer);

      const spawnMarker = new Container();
      spawnMarker.zIndex = 11;
      const spawnGfx = new Graphics();
      spawnGfx.circle(0, 0, 12).fill({ color: 0x22c55e, alpha: 0.85 });
      spawnMarker.addChild(spawnGfx);
      const spawnLabel = new Text({
        text: "S",
        style: { fontFamily: "monospace", fontSize: 14, fill: 0xffffff },
      });
      spawnLabel.anchor.set(0.5);
      spawnMarker.addChild(spawnLabel);
      world.addChild(spawnMarker);

      const hoverGfx = new Graphics();
      hoverGfx.zIndex = 12;
      hoverGfx.rect(0, 0, TILE_PF_SIZE, TILE_PF_SIZE).stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
      hoverGfx.visible = false;
      world.addChild(hoverGfx);

      world.sortableChildren = true;

      const drawGrid = () => {
        const w = model.level.width * TILE_PF_SIZE;
        gridGfx.clear();
        for (let x = 0; x <= model.level.width; x++) {
          gridGfx.moveTo(x * TILE_PF_SIZE, 0).lineTo(x * TILE_PF_SIZE, LEVEL_PX_H);
        }
        for (let y = 0; y <= EDITOR_HEIGHT; y++) {
          gridGfx.moveTo(0, y * TILE_PF_SIZE).lineTo(w, y * TILE_PF_SIZE);
        }
        gridGfx.stroke({ color: 0x000000, width: 1, alpha: 0.15 });
        // Out-of-level area marker on the right edge
        gridGfx.moveTo(w, 0).lineTo(w, LEVEL_PX_H).stroke({ color: 0xef4444, width: 2, alpha: 0.6 });
      };

      const syncOverlays = () => {
        levelView.width = model.level.width;
        levelView.tiles = model.level.tiles;
        levelView.background = model.level.background;
        renderer?.resize(); // redraw sky for background changes
        drawGrid();
        spawnMarker.x = (model.level.spawn.x + 0.5) * TILE_PF_SIZE;
        spawnMarker.y = (model.level.spawn.y + 0.5) * TILE_PF_SIZE;
        ghostContainer.removeChildren().forEach((c) => c.destroy());
        for (const a of model.level.actors) {
          const s = new Sprite(actorTex[a.type]);
          s.anchor.set(0.5, 1);
          s.x = (a.x + 0.5) * TILE_PF_SIZE;
          s.y = (a.y + 1) * TILE_PF_SIZE;
          ghostContainer.addChild(s);
        }
      };
      syncRef.current = syncOverlays;
      syncOverlays();

      // ---- Camera + input ----
      // The 16-tile strip is always zoomed to fill the viewport height, so
      // navigation is horizontal only: wheel scroll, Space/middle-drag pan,
      // or arrow keys. cam.x / zoom live here; the ticker clamps and applies.
      const cam = { x: 0 };
      let zoom = 1;
      const keys = new Set<string>();
      let painting = false;
      let panning = false;
      let spaceHeld = false;
      let lastPan = { x: 0, y: 0 };

      const canvas = app.canvas;

      const isFormTarget = (e: Event) =>
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      onKeyDown = (e: KeyboardEvent) => {
        if (isFormTarget(e)) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          keys.add(e.key);
          e.preventDefault();
        } else if (e.code === "Space") {
          spaceHeld = true;
          canvas.style.cursor = "grab";
          e.preventDefault();
        }
      };
      onKeyUp = (e: KeyboardEvent) => {
        keys.delete(e.key);
        if (e.code === "Space") {
          spaceHeld = false;
          canvas.style.cursor = "";
        }
      };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      const toTile = (e: PointerEvent): { x: number; y: number } => ({
        x: Math.floor((e.offsetX / zoom + cam.x) / TILE_PF_SIZE),
        y: Math.floor(e.offsetY / zoom / TILE_PF_SIZE),
      });

      const inLevel = (p: { x: number; y: number }) =>
        p.x >= 0 && p.x < model.level.width && p.y >= 0 && p.y < EDITOR_HEIGHT;

      const applyStrokeTool = (p: { x: number; y: number }) => {
        const t = toolRef.current;
        if (!inLevel(p)) return;
        let changed = false;
        if (t.kind === "tile") changed = model.setTile(p.x, p.y, t.tile);
        else if (t.kind === "eraser") changed = model.eraseAt(p.x, p.y);
        if (changed) onMutateRef.current();
      };

      canvas.addEventListener("pointerdown", (e) => {
        if (e.button === 1 || (e.button === 0 && spaceHeld)) {
          panning = true;
          lastPan = { x: e.clientX, y: e.clientY };
          e.preventDefault();
          return;
        }
        if (e.button !== 0) return;
        const p = toTile(e);
        if (!inLevel(p)) return;
        const t = toolRef.current;
        if (t.kind === "tile" || t.kind === "eraser") {
          model.beginStroke();
          painting = true;
          applyStrokeTool(p);
        } else {
          let changed = false;
          if (t.kind === "actor") changed = model.placeActor(t.actorType, p.x, p.y);
          else if (t.kind === "spawn") changed = model.placeSpawn(p.x, p.y);
          else if (t.kind === "goal") changed = model.placeGoal(p.x, p.y);
          if (changed) onMutateRef.current();
        }
      });

      canvas.addEventListener("pointermove", (e) => {
        if (panning) {
          cam.x -= (e.clientX - lastPan.x) / zoom;
          lastPan = { x: e.clientX, y: e.clientY };
          return;
        }
        const p = toTile(e);
        if (inLevel(p)) {
          hoverGfx.visible = true;
          hoverGfx.x = p.x * TILE_PF_SIZE;
          hoverGfx.y = p.y * TILE_PF_SIZE;
        } else {
          hoverGfx.visible = false;
        }
        if (painting) applyStrokeTool(p);
      });

      const endStroke = () => { painting = false; panning = false; };
      canvas.addEventListener("pointerup", endStroke);
      canvas.addEventListener("pointerleave", () => {
        endStroke();
        hoverGfx.visible = false;
      });
      // Middle-click autoscroll would fight the pan gesture
      canvas.addEventListener("auxclick", (e) => e.preventDefault());

      // Wheel (vertical or trackpad horizontal) scrolls along the level.
      canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          cam.x += d / zoom;
        },
        { passive: false },
      );

      initialized = true;

      app.ticker.add(() => {
        if (!app || !renderer) return;
        if (keys.has("ArrowLeft")) cam.x -= PAN_SPEED / zoom;
        if (keys.has("ArrowRight")) cam.x += PAN_SPEED / zoom;

        const screenW = app.screen.width;
        const screenH = app.screen.height;
        zoom = screenH / LEVEL_PX_H; // fit the 16-tile strip to the viewport
        const viewW = screenW / zoom; // visible width in world px
        const maxCamX = Math.max(0, model.level.width * TILE_PF_SIZE - viewW);
        cam.x = Math.max(0, Math.min(cam.x, maxCamX));
        renderer.update(cam.x, 0, viewW, LEVEL_PX_H);
        // renderer.update positions the world unscaled; re-apply with zoom.
        world.scale.set(zoom);
        world.x = -cam.x * zoom;
      });

      // ---- Palette thumbnails (one-time extraction) ----
      // Each await yields, so cleanup (slot switch, StrictMode re-mount) can
      // destroy the app mid-loop — re-check cancelled before touching it.
      const thumbs: Record<string, string> = {};
      for (const { tile } of PALETTE_TILES) {
        if (cancelled || !app) return;
        const tex = tileTextures.get(tile);
        if (tex) thumbs[tileThumbKey(tile)] = await app.renderer.extract.base64(tex);
      }
      for (const { type } of PALETTE_ACTORS) {
        if (cancelled || !app) return;
        thumbs[actorThumbKey(type)] = await app.renderer.extract.base64(actorTex[type]);
      }
      if (!cancelled) onThumbnailsRef.current(thumbs);
    })().catch((e) => {
      console.error("[stage-editor] canvas init error:", e);
    });

    return () => {
      cancelled = true;
      syncRef.current = null;
      if (onKeyDown) window.removeEventListener("keydown", onKeyDown);
      if (onKeyUp) window.removeEventListener("keyup", onKeyUp);
      if (!initialized) return;
      try {
        renderer?.destroy();
        app?.destroy(true, { children: true });
      } catch (e) {
        console.warn("[stage-editor] cleanup error:", e);
      }
      renderer = null;
      app = null;
    };
    // The model instance changing (slot load) tears down and rebuilds Pixi.
  }, [model]);

  // Overlay sync after any model mutation (paint, undo, resize, slot load).
  useEffect(() => {
    syncRef.current?.();
  }, [version]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
