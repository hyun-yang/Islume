"use client";

import { useEffect, useRef, useState } from "react";
import { Application, type Renderer, type Texture } from "pixi.js";

import {
  generatePlatformerTileTextures,
} from "@/lib/platformer/tilesetTextures";
import {
  generatePlatformerCharacterTextures,
  type CharacterTextureSet,
} from "@/lib/platformer/characterTextures";
import {
  generatePlatformerEnemyTextures,
  type EnemyTextureSet,
} from "@/lib/platformer/enemyTextures";
import {
  generatePlatformerItemTextures,
  type ItemTextureSet,
} from "@/lib/platformer/itemTextures";
import {
  generatePlatformerPlatformTextures,
  type PlatformTextureSet,
} from "@/lib/platformer/platformTextures";
import {
  generatePlatformerBossTextures,
  type BossTextureSet,
} from "@/lib/platformer/bossTextures";
import {
  TILE_PF_GROUND, TILE_PF_GROUND_INNER, TILE_PF_PLATFORM,
  TILE_PF_BRICK, TILE_PF_WATER, TILE_PF_SAND, TILE_PF_ROCK,
  TILE_PF_FLAG_POLE, TILE_PF_FLAG_TOP,
  TILE_PF_CLOUD, TILE_PF_BUSH,
} from "@/lib/platformer/types";

import {
  packAndExtract,
  downloadBlob,
  downloadJson,
  type AtlasJson,
} from "@/lib/platformer/extractAtlas";

const TILE_NAMES: Record<number, string> = {
  [TILE_PF_GROUND]: "ground",
  [TILE_PF_GROUND_INNER]: "ground-inner",
  [TILE_PF_PLATFORM]: "platform",
  [TILE_PF_BRICK]: "brick",
  [TILE_PF_WATER]: "water",
  [TILE_PF_SAND]: "sand",
  [TILE_PF_ROCK]: "rock",
  [TILE_PF_FLAG_POLE]: "flag-pole",
  [TILE_PF_FLAG_TOP]: "flag-top",
  [TILE_PF_CLOUD]: "cloud",
  [TILE_PF_BUSH]: "bush",
};

interface CategoryResult {
  name: string;
  pngFilename: string;
  jsonFilename: string;
  pngBlob: Blob;
  atlasJson: AtlasJson;
  frameCount: number;
  size: { w: number; h: number };
  previewUrl: string;
}

export default function ExtractTexturesPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const [status, setStatus] = useState<"booting" | "ready" | "extracting" | "done" | "error">("booting");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CategoryResult[]>([]);

  useEffect(() => {
    let disposed = false;
    const app = new Application();
    appRef.current = app;

    (async () => {
      try {
        await app.init({
          width: 1,
          height: 1,
          backgroundAlpha: 0,
          autoStart: false,
          preference: "webgpu",
        });
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        if (containerRef.current) {
          // Mount the (1×1) canvas just so we can see the WebGL/WebGPU context exists.
          containerRef.current.appendChild(app.canvas as HTMLCanvasElement);
        }
        setStatus("ready");
      } catch (e) {
        setError(String(e));
        setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  async function handleExtract() {
    const app = appRef.current;
    if (!app) return;
    setStatus("extracting");
    setError(null);
    setResults([]);

    try {
      const renderer = app.renderer as Renderer;

      const tileMap = generatePlatformerTileTextures(renderer);
      const tilesInput: Record<string, Texture> = {};
      for (const [id, tex] of tileMap.entries()) {
        const name = TILE_NAMES[id] ?? `tile-${id}`;
        tilesInput[name] = tex;
      }

      const chars = generatePlatformerCharacterTextures(renderer);
      const enemies = generatePlatformerEnemyTextures(renderer);
      const items = generatePlatformerItemTextures(renderer);
      const platforms = generatePlatformerPlatformTextures(renderer);
      const bosses = generatePlatformerBossTextures(renderer);

      const categories: { input: Record<string, Texture>; filename: string }[] = [
        { input: tilesInput, filename: "tiles" },
        { input: characterMap(chars), filename: "characters" },
        { input: enemyMap(enemies), filename: "enemies" },
        { input: itemMap(items), filename: "items" },
        { input: platformMap(platforms), filename: "platforms" },
        { input: bossMap(bosses), filename: "bosses" },
      ];

      // Phase 1: extract everything first (no downloads yet), so results are
      // always available in-memory for per-card re-download.
      const collected: CategoryResult[] = [];
      for (const cat of categories) {
        const imageName = `${cat.filename}.png`;
        const { png, atlas, previewCanvas } = await packAndExtract(renderer, cat.input, {
          imageName,
          columns: 8,
          padding: 2,
        });
        collected.push({
          name: cat.filename,
          pngFilename: imageName,
          jsonFilename: `${cat.filename}.json`,
          pngBlob: png,
          atlasJson: atlas,
          frameCount: Object.keys(cat.input).length,
          size: atlas.meta.size,
          previewUrl: previewCanvas.toDataURL("image/png"),
        });
      }
      setResults(collected);

      // Phase 2: trigger downloads with wider spacing. Chrome's
      // "multiple-download" auto-block triggers ~5-6 downloads/sec from one
      // origin; 350ms between every file (PNG and JSON alike) stays under that.
      for (const r of collected) {
        downloadBlob(r.pngBlob, r.pngFilename);
        await new Promise((res) => setTimeout(res, 350));
        downloadJson(r.atlasJson, r.jsonFilename);
        await new Promise((res) => setTimeout(res, 350));
      }

      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#222" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>Platformer Texture Extractor</h1>
      <p style={{ marginTop: 8, fontSize: 13, color: "#555" }}>
        Generates the 6 procedural texture categories, packs each as a sprite-sheet PNG +
        TexturePacker-style JSON atlas, and triggers downloads (12 files total).
      </p>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleExtract}
          disabled={status !== "ready" && status !== "done"}
          style={{
            padding: "8px 16px",
            background: status === "extracting" ? "#888" : "#1976d2",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: status === "extracting" ? "wait" : "pointer",
          }}
        >
          {status === "extracting" ? "Extracting..." : "Extract All"}
        </button>
        <span style={{ fontSize: 12, color: "#666" }}>Status: {status}</span>
      </div>

      {error && (
        <pre style={{ marginTop: 12, padding: 12, background: "#fee", color: "#900", fontSize: 12 }}>
          {error}
        </pre>
      )}

      <div ref={containerRef} style={{ display: "none" }} />

      {results.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Previews</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 12 }}>
            {results.map((r) => (
              <div key={r.name} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{r.pngFilename}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  {r.frameCount} frames · {r.size.w}×{r.size.h}px
                </div>
                <div
                  style={{
                    marginTop: 8,
                    background:
                      "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px",
                    padding: 4,
                    borderRadius: 4,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.previewUrl}
                    alt={r.name}
                    style={{ display: "block", maxWidth: "100%", imageRendering: "pixelated" }}
                  />
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <button
                    onClick={() => downloadBlob(r.pngBlob, r.pngFilename)}
                    style={btnSmStyle}
                  >
                    PNG
                  </button>
                  <button
                    onClick={() => downloadJson(r.atlasJson, r.jsonFilename)}
                    style={btnSmStyle}
                  >
                    JSON
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

const btnSmStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  background: "#fff",
  border: "1px solid #bbb",
  borderRadius: 4,
  cursor: "pointer",
};

function characterMap(set: CharacterTextureSet): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  for (const state of ["idle", "run", "jump", "fall", "hurt"] as const) {
    set[state].forEach((tex, i) => {
      out[`${state}-${i}`] = tex;
    });
  }
  return out;
}

function enemyMap(set: EnemyTextureSet): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  set.crab.forEach((tex, i) => { out[`crab-${i}`] = tex; });
  set.starfish.forEach((tex, i) => { out[`starfish-${i}`] = tex; });
  set.frog.forEach((tex, i) => { out[`frog-${i}`] = tex; });
  return out;
}

function itemMap(set: ItemTextureSet): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  set.shell.forEach((tex, i) => { out[`shell-${i}`] = tex; });
  set.heart.forEach((tex, i) => { out[`heart-${i}`] = tex; });
  set.banana.forEach((tex, i) => { out[`banana-${i}`] = tex; });
  return out;
}

function platformMap(set: PlatformTextureSet): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  set.log.forEach((tex, i) => { out[`log-${i}`] = tex; });
  set.lily.forEach((tex, i) => { out[`lily-${i}`] = tex; });
  set.whale.forEach((tex, i) => { out[`whale-${i}`] = tex; });
  set.waterDrop.forEach((tex, i) => { out[`water-drop-${i}`] = tex; });
  return out;
}

function bossMap(set: BossTextureSet): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  set.bear.forEach((tex, i) => { out[`bear-${i}`] = tex; });
  set.coconutBlock.forEach((tex, i) => { out[`coconut-block-${i}`] = tex; });
  set.coconut.forEach((tex, i) => { out[`coconut-${i}`] = tex; });
  set.pineapple.forEach((tex, i) => { out[`pineapple-${i}`] = tex; });
  return out;
}
