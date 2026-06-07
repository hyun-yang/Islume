import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

const PLATFORMER_ITEM_FRAME_W = 24;
const PLATFORMER_ITEM_FRAME_H = 24;

const FW = PLATFORMER_ITEM_FRAME_W;
const FH = PLATFORMER_ITEM_FRAME_H;

export interface ItemTextureSet {
  shell: Texture[];     // 4 sparkle frames
  heart: Texture[];     // 1 frame
  banana: Texture[];    // 2 frames (gentle glow pulse)
}

export function generatePlatformerItemTextures(renderer: Renderer): ItemTextureSet {
  const shell: Texture[] = [];
  for (let f = 0; f < 4; f++) shell.push(drawShell(renderer, f));
  return {
    shell,
    heart: [drawHeart(renderer)],
    banana: [drawBanana(renderer, 0), drawBanana(renderer, 1)],
  };
}

function drawShell(renderer: Renderer, frame: number): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const cy = FH / 2;
  const sparkleAngle = (frame / 4) * Math.PI * 2;

  // Shell fan
  g.circle(cx, cy + 1, 8).fill(0xffe1a8);
  g.circle(cx, cy + 1, 7).fill(0xffd084);
  for (let i = -3; i <= 3; i++) {
    const a = (i / 3) * 0.6;
    const x1 = cx + Math.sin(a) * 3;
    const y1 = cy + 4;
    const x2 = cx + Math.sin(a) * 8;
    const y2 = cy - 4;
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 1, color: 0xc99a4f });
  }

  // Sparkle (moves around the shell)
  const sx = cx + Math.cos(sparkleAngle) * 9;
  const sy = cy + Math.sin(sparkleAngle) * 9 - 2;
  g.poly([
    sx, sy - 3,
    sx + 1, sy,
    sx + 4, sy + 1,
    sx + 1, sy + 2,
    sx, sy + 5,
    sx - 1, sy + 2,
    sx - 4, sy + 1,
    sx - 1, sy,
  ]).fill(0xffffff);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}

function drawBanana(renderer: Renderer, frame: number): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const cy = FH / 2;

  // Glow halo (gentler when frame=1)
  const haloAlpha = frame === 0 ? 0.35 : 0.18;
  g.circle(cx, cy, 11).fill({ color: 0xfff176, alpha: haloAlpha });
  // Curved body — drawn as overlapping circles forming a banana arc
  g.poly([
    cx - 8, cy + 4,
    cx - 6, cy - 4,
    cx + 2, cy - 6,
    cx + 8, cy - 2,
    cx + 9, cy + 2,
    cx + 4, cy + 5,
    cx - 4, cy + 6,
  ]).fill(0xfdd835);
  g.poly([
    cx - 7, cy + 3,
    cx - 5, cy - 3,
    cx + 1, cy - 5,
    cx + 7, cy - 1,
  ]).fill(0xfff59d);
  // Tips
  g.circle(cx - 8, cy + 4, 1.5).fill(0x6d4c41);
  g.circle(cx + 9, cy + 2, 1.5).fill(0x6d4c41);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}

function drawHeart(renderer: Renderer): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const cy = FH / 2;

  g.circle(cx - 4, cy - 2, 5).fill(0xff4d6d);
  g.circle(cx + 4, cy - 2, 5).fill(0xff4d6d);
  g.poly([cx - 8, cy, cx + 8, cy, cx, cy + 8]).fill(0xff4d6d);
  g.circle(cx - 4, cy - 3, 2).fill({ color: 0xffffff, alpha: 0.5 });
  // Stem
  g.rect(cx - 1, cy - 9, 2, 3).fill(0x4caf50);
  g.ellipse(cx + 3, cy - 8, 3, 2).fill(0x4caf50);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}
