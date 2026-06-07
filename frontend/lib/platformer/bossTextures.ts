import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

// Stage 3 boss + interactive blocks + ending power-up.
// Bear is intentionally large (~64×56) so blocking the path reads clearly.

export const BEAR_W = 64;
export const BEAR_H = 56;
export const COCONUT_BLOCK_W = 32;
export const COCONUT_BLOCK_H = 32;
export const COCONUT_W = 14;
export const COCONUT_H = 14;
export const PINEAPPLE_W = 24;
export const PINEAPPLE_H = 24;

export interface BossTextureSet {
  bear: Texture[];           // 3 frames: sleeping, groggy, awake
  coconutBlock: Texture[];   // 2 frames: idle, bumped
  coconut: Texture[];        // 1 frame
  pineapple: Texture[];      // 4 frames (sparkle rotation)
}

export function generatePlatformerBossTextures(renderer: Renderer): BossTextureSet {
  return {
    bear: [drawBear(renderer, "sleeping"), drawBear(renderer, "groggy"), drawBear(renderer, "awake")],
    coconutBlock: [drawCoconutBlock(renderer, false), drawCoconutBlock(renderer, true)],
    coconut: [drawCoconut(renderer)],
    pineapple: [
      drawPineapple(renderer, 0),
      drawPineapple(renderer, 1),
      drawPineapple(renderer, 2),
      drawPineapple(renderer, 3),
    ],
  };
}

function drawBear(renderer: Renderer, state: "sleeping" | "groggy" | "awake"): Texture {
  const g = new Graphics();
  const cx = BEAR_W / 2;
  const feet = BEAR_H - 2;
  const baseColor = 0x6d4c41;
  const lightColor = 0x8d6e63;
  const bellyColor = 0xd7ccc8;

  if (state === "sleeping") {
    // Lying down: oval body across the ground, head on left
    g.ellipse(cx, feet - 8, 28, 12).fill(baseColor);
    g.ellipse(cx, feet - 10, 26, 9).fill(lightColor);
    g.ellipse(cx, feet - 6, 18, 6).fill(bellyColor);
    // Head sticks out at left
    g.circle(cx - 22, feet - 9, 11).fill(baseColor);
    g.circle(cx - 22, feet - 9, 9).fill(lightColor);
    // Snout
    g.ellipse(cx - 30, feet - 9, 4, 3).fill(0xefebe9);
    g.circle(cx - 32, feet - 9, 1.2).fill(0x222222);
    // Closed eye + Z's
    g.rect(cx - 26, feet - 11, 4, 1).fill(0x222222);
    g.rect(cx - 8, feet - 26, 4, 1).fill(0x222222);
    g.rect(cx - 5, feet - 22, 4, 1).fill(0x222222);
    // Ear (just the tip visible)
    g.circle(cx - 18, feet - 18, 4).fill(baseColor);
    g.circle(cx - 18, feet - 18, 2).fill(0x4e342e);
    // Paws
    g.ellipse(cx + 14, feet - 2, 6, 3).fill(baseColor);
    g.ellipse(cx + 24, feet - 2, 6, 3).fill(baseColor);
  } else if (state === "groggy") {
    // Sitting up, holding head
    g.ellipse(cx, feet - 16, 24, 16).fill(baseColor);
    g.ellipse(cx, feet - 18, 22, 13).fill(lightColor);
    g.ellipse(cx, feet - 14, 16, 8).fill(bellyColor);
    // Head with stars
    g.circle(cx, feet - 36, 14).fill(baseColor);
    g.circle(cx, feet - 36, 12).fill(lightColor);
    g.ellipse(cx, feet - 32, 6, 4).fill(0xefebe9);
    g.circle(cx, feet - 33, 1.2).fill(0x222222);
    // Ears
    g.circle(cx - 11, feet - 47, 4).fill(baseColor);
    g.circle(cx + 11, feet - 47, 4).fill(baseColor);
    // Dazed eyes (X X)
    g.rect(cx - 7, feet - 39, 4, 1).fill(0x222222);
    g.rect(cx - 5, feet - 41, 1, 4).fill(0x222222);
    g.rect(cx + 3, feet - 39, 4, 1).fill(0x222222);
    g.rect(cx + 5, feet - 41, 1, 4).fill(0x222222);
    // Stars around head
    g.poly([cx - 18, feet - 50, cx - 16, feet - 48, cx - 14, feet - 50, cx - 16, feet - 52]).fill(0xffeb3b);
    g.poly([cx + 18, feet - 50, cx + 16, feet - 48, cx + 14, feet - 50, cx + 16, feet - 52]).fill(0xffeb3b);
    // Paw on head
    g.ellipse(cx + 8, feet - 42, 5, 4).fill(baseColor);
    // Legs
    g.ellipse(cx - 10, feet - 2, 6, 3).fill(baseColor);
    g.ellipse(cx + 10, feet - 2, 6, 3).fill(baseColor);
  } else {
    // Awake — standing, paws raised, mouth open
    g.ellipse(cx, feet - 20, 22, 18).fill(baseColor);
    g.ellipse(cx, feet - 22, 20, 14).fill(lightColor);
    g.ellipse(cx, feet - 18, 14, 8).fill(bellyColor);
    g.circle(cx, feet - 44, 13).fill(baseColor);
    g.circle(cx, feet - 44, 11).fill(lightColor);
    g.ellipse(cx, feet - 40, 6, 4).fill(0xefebe9);
    g.circle(cx, feet - 41, 1.2).fill(0x222222);
    g.circle(cx - 11, feet - 54, 4).fill(baseColor);
    g.circle(cx + 11, feet - 54, 4).fill(baseColor);
    g.circle(cx - 5, feet - 47, 1.5).fill(0x222222);
    g.circle(cx + 5, feet - 47, 1.5).fill(0x222222);
    g.ellipse(cx, feet - 36, 5, 2).fill(0x222222);
    // Paws raised
    g.ellipse(cx - 16, feet - 30, 5, 4).fill(baseColor);
    g.ellipse(cx + 16, feet - 30, 5, 4).fill(baseColor);
    g.ellipse(cx - 10, feet - 2, 6, 3).fill(baseColor);
    g.ellipse(cx + 10, feet - 2, 6, 3).fill(baseColor);
  }

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, BEAR_W, BEAR_H),
  });
  g.destroy();
  return texture;
}

function drawCoconutBlock(renderer: Renderer, bumped: boolean): Texture {
  const g = new Graphics();
  const s = COCONUT_BLOCK_W;
  // Trunk (palm-like with bands)
  g.rect(0, 0, s, s).fill(0x6d4c41);
  g.rect(0, 0, s, s).stroke({ width: 1, color: 0x4e342e });
  for (let i = 4; i < s; i += 6) {
    g.rect(2, i, s - 4, 1).fill({ color: 0x4e342e, alpha: 0.5 });
  }
  // Coconut bundles on top corners
  if (!bumped) {
    g.circle(8, 7, 4).fill(0x6d4c41);
    g.circle(s - 8, 7, 4).fill(0x6d4c41);
    g.circle(8, 7, 2).fill(0x4e342e);
    g.circle(s - 8, 7, 2).fill(0x4e342e);
  }
  // "?" mark in center
  g.rect(s / 2 - 1, 12, 2, 2).fill(0xffeb3b);
  g.rect(s / 2 - 1, 16, 2, 6).fill(0xffeb3b);
  g.rect(s / 2 - 1, 24, 2, 2).fill(0xffeb3b);
  // Highlight
  g.rect(0, 0, s, 2).fill({ color: 0xffffff, alpha: bumped ? 0.05 : 0.18 });

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, s, s),
  });
  g.destroy();
  return texture;
}

function drawCoconut(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(COCONUT_W / 2, COCONUT_H / 2, COCONUT_W / 2 - 1).fill(0x6d4c41);
  g.circle(COCONUT_W / 2, COCONUT_H / 2, COCONUT_W / 2 - 2).fill(0x8d6e63);
  // Three "eyes" of a coconut
  g.circle(COCONUT_W / 2 - 2, COCONUT_H / 2 - 1, 1).fill(0x4e342e);
  g.circle(COCONUT_W / 2 + 2, COCONUT_H / 2 - 1, 1).fill(0x4e342e);
  g.circle(COCONUT_W / 2,     COCONUT_H / 2 + 2, 1).fill(0x4e342e);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, COCONUT_W, COCONUT_H),
  });
  g.destroy();
  return texture;
}

function drawPineapple(renderer: Renderer, frame: number): Texture {
  const g = new Graphics();
  const cx = PINEAPPLE_W / 2;
  const cy = PINEAPPLE_H / 2 + 1;
  const sparkleAngle = (frame / 4) * Math.PI * 2;

  // Glow halo
  g.circle(cx, cy, 12).fill({ color: 0xfff59d, alpha: 0.35 });

  // Pineapple body (oval golden + cross-hatch)
  g.ellipse(cx, cy + 1, 7, 9).fill(0xffb300);
  g.ellipse(cx, cy + 1, 6, 8).fill(0xffd54f);
  for (let i = -2; i <= 2; i++) {
    const yy = cy - 4 + i * 3;
    g.rect(cx - 5, yy, 10, 1).fill({ color: 0xb27600, alpha: 0.5 });
  }
  // Crown leaves
  g.poly([cx - 5, cy - 8, cx - 2, cy - 14, cx, cy - 9]).fill(0x4caf50);
  g.poly([cx, cy - 9, cx + 2, cy - 14, cx + 5, cy - 8]).fill(0x4caf50);
  g.poly([cx - 2, cy - 9, cx, cy - 13, cx + 2, cy - 9]).fill(0x66bb6a);

  // Sparkle (rotates around)
  const sx = cx + Math.cos(sparkleAngle) * 10;
  const sy = cy + Math.sin(sparkleAngle) * 10;
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
    target: g, frame: new Rectangle(0, 0, PINEAPPLE_W, PINEAPPLE_H),
  });
  g.destroy();
  return texture;
}
