import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

// Moving / interactive platforms and projectiles for Stage 2.
// Logs and lily pads are wider than tiles, drawn as standalone sprites.

export const LOG_W = 80;
export const LOG_H = 22;
export const LILY_W = 44;
export const LILY_H = 20;
export const WHALE_W = 64;
export const WHALE_H = 36;
export const DROP_W = 14;
export const DROP_H = 18;

export interface PlatformTextureSet {
  log: Texture[];           // 1 frame
  lily: Texture[];          // 1 frame
  whale: Texture[];         // 2 frames (idle / spout)
  waterDrop: Texture[];     // 1 frame
}

export function generatePlatformerPlatformTextures(renderer: Renderer): PlatformTextureSet {
  return {
    log: [drawLog(renderer)],
    lily: [drawLily(renderer)],
    whale: [drawWhale(renderer, 0), drawWhale(renderer, 1)],
    waterDrop: [drawDrop(renderer)],
  };
}

function drawLog(renderer: Renderer): Texture {
  const g = new Graphics();
  // Body
  g.roundRect(0, 0, LOG_W, LOG_H, 6).fill(0x8a5a3b);
  g.roundRect(2, 2, LOG_W - 4, LOG_H - 4, 5).fill(0xa9764f);
  // Bark stripes
  for (let i = 12; i < LOG_W - 6; i += 14) {
    g.rect(i, 4, 1, LOG_H - 8).fill({ color: 0x5d3b21, alpha: 0.4 });
  }
  // End rings
  g.circle(7, LOG_H / 2, 5).fill(0xc69876);
  g.circle(7, LOG_H / 2, 3).fill(0xa9764f);
  g.circle(7, LOG_H / 2, 1).fill(0x5d3b21);
  g.circle(LOG_W - 7, LOG_H / 2, 5).fill(0xc69876);
  g.circle(LOG_W - 7, LOG_H / 2, 3).fill(0xa9764f);
  g.circle(LOG_W - 7, LOG_H / 2, 1).fill(0x5d3b21);
  // Top highlight
  g.rect(8, 2, LOG_W - 16, 2).fill({ color: 0xffffff, alpha: 0.18 });

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, LOG_W, LOG_H),
  });
  g.destroy();
  return texture;
}

function drawLily(renderer: Renderer): Texture {
  const g = new Graphics();
  // Pad ellipse
  g.ellipse(LILY_W / 2, LILY_H / 2 + 3, LILY_W / 2 - 1, 6).fill(0x2e7d32);
  g.ellipse(LILY_W / 2, LILY_H / 2 + 1, LILY_W / 2 - 2, 5).fill(0x4caf50);
  // Notch (lily pad characteristic V cutout)
  g.poly([
    LILY_W / 2 - 4, LILY_H / 2 - 2,
    LILY_W / 2, LILY_H / 2 + 4,
    LILY_W / 2 + 4, LILY_H / 2 - 2,
  ]).fill(0x2c8fc9);
  // Flower
  g.circle(LILY_W / 2 + 8, LILY_H / 2 - 2, 4).fill(0xf48fb1);
  g.circle(LILY_W / 2 + 8, LILY_H / 2 - 2, 2).fill(0xffeb3b);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, LILY_W, LILY_H),
  });
  g.destroy();
  return texture;
}

function drawWhale(renderer: Renderer, frame: number): Texture {
  const g = new Graphics();
  const cx = WHALE_W / 2;
  const cy = WHALE_H * 0.6;

  // Body
  g.ellipse(cx, cy, 28, 14).fill(0x546e7a);
  g.ellipse(cx, cy + 2, 26, 10).fill(0x90a4ae);
  // Belly
  g.ellipse(cx, cy + 6, 20, 6).fill(0xeceff1);
  // Tail
  g.poly([cx + 26, cy - 2, cx + 32, cy - 6, cx + 28, cy + 6]).fill(0x546e7a);
  // Eye
  g.circle(cx - 14, cy - 2, 2).fill(0x222222);
  g.circle(cx - 13, cy - 3, 1).fill(0xffffff);
  // Mouth
  g.rect(cx - 22, cy + 4, 6, 1).fill(0x222222);
  // Spout
  if (frame === 1) {
    g.circle(cx, cy - 16, 3).fill({ color: 0xa8d8ff, alpha: 0.8 });
    g.circle(cx + 3, cy - 12, 2).fill({ color: 0xa8d8ff, alpha: 0.6 });
    g.circle(cx - 3, cy - 12, 2).fill({ color: 0xa8d8ff, alpha: 0.6 });
  } else {
    g.rect(cx - 1, cy - 16, 2, 4).fill({ color: 0xa8d8ff, alpha: 0.5 });
  }

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, WHALE_W, WHALE_H),
  });
  g.destroy();
  return texture;
}

function drawDrop(renderer: Renderer): Texture {
  const g = new Graphics();
  const cx = DROP_W / 2;
  // Teardrop: triangle on top, circle on bottom
  g.poly([cx, 1, cx - 5, DROP_H - 7, cx + 5, DROP_H - 7]).fill(0x2c8fc9);
  g.circle(cx, DROP_H - 6, 5).fill(0x2c8fc9);
  g.circle(cx - 1, DROP_H - 7, 1.5).fill({ color: 0xffffff, alpha: 0.7 });

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, DROP_W, DROP_H),
  });
  g.destroy();
  return texture;
}
