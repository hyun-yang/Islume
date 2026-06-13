// Runtime-generated placeholder textures for puzzle pieces, following the
// lib/platformer texture pattern (Graphics → renderer.generateTexture with an
// explicit frame Rectangle). Swap with Assets.load() when real spritesheets
// are available.

import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
import { PUZZLE_CELL_SIZE, type PuzzlePieceType } from "./types";

const CELL = PUZZLE_CELL_SIZE;
const C = CELL / 2; // piece center

export interface PuzzleTextureSet {
  pieces: Record<PuzzlePieceType, Texture>;
  cellBgLight: Texture;
  cellBgDark: Texture;
  selection: Texture;
  sparkle: Texture;
}

export function generatePuzzlePieceTextures(renderer: Renderer): PuzzleTextureSet {
  return {
    pieces: {
      shell: drawShell(renderer),
      starfish: drawStarfish(renderer),
      banana: drawBanana(renderer),
      pineapple: drawPineapple(renderer),
      coconut: drawCoconut(renderer),
      heart: drawHeart(renderer),
    },
    cellBgLight: drawCellBg(renderer, 0xfdf6e3, 0.55),
    cellBgDark: drawCellBg(renderer, 0xe8dcc0, 0.55),
    selection: drawSelection(renderer),
    sparkle: drawSparkle(renderer),
  };
}

function toTexture(renderer: Renderer, g: Graphics): Texture {
  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, CELL, CELL),
  });
  g.destroy();
  return texture;
}

function drawCellBg(renderer: Renderer, color: number, alpha: number): Texture {
  const g = new Graphics();
  g.roundRect(1, 1, CELL - 2, CELL - 2, 6).fill({ color, alpha });
  return toTexture(renderer, g);
}

function drawSelection(renderer: Renderer): Texture {
  const g = new Graphics();
  g.roundRect(2, 2, CELL - 4, CELL - 4, 8)
    .stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
  g.roundRect(4, 4, CELL - 8, CELL - 8, 6)
    .stroke({ width: 2, color: 0xffc107, alpha: 0.9 });
  return toTexture(renderer, g);
}

function drawSparkle(renderer: Renderer): Texture {
  const g = new Graphics();
  g.poly([
    C, C - 6,
    C + 2, C - 2,
    C + 6, C,
    C + 2, C + 2,
    C, C + 6,
    C - 2, C + 2,
    C - 6, C,
    C - 2, C - 2,
  ]).fill(0xffffff);
  return toTexture(renderer, g);
}

function drawShell(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(C, C + 2, 16).fill(0xffe1a8);
  g.circle(C, C + 2, 14).fill(0xffd084);
  // Fan ribs
  for (let i = -3; i <= 3; i++) {
    const a = (i / 3) * 0.6;
    g.moveTo(C + Math.sin(a) * 6, C + 10)
      .lineTo(C + Math.sin(a) * 15, C - 7)
      .stroke({ width: 2, color: 0xc99a4f });
  }
  g.circle(C, C + 11, 4).fill(0xc99a4f);
  g.circle(C - 5, C - 4, 3).fill({ color: 0xffffff, alpha: 0.5 });
  return toTexture(renderer, g);
}

function drawStarfish(renderer: Renderer): Texture {
  const g = new Graphics();
  const points: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 18 : 8;
    points.push(C + Math.cos(a) * r, C + Math.sin(a) * r);
  }
  g.poly(points).fill(0xff7043);
  g.circle(C, C, 6).fill(0xffab91);
  g.circle(C - 2, C - 1, 1.5).fill(0x5d4037);
  g.circle(C + 2, C - 1, 1.5).fill(0x5d4037);
  return toTexture(renderer, g);
}

function drawBanana(renderer: Renderer): Texture {
  const g = new Graphics();
  g.poly([
    C - 15, C + 8,
    C - 11, C - 8,
    C + 4, C - 12,
    C + 15, C - 4,
    C + 17, C + 4,
    C + 8, C + 10,
    C - 7, C + 12,
  ]).fill(0xfdd835);
  g.poly([
    C - 13, C + 6,
    C - 9, C - 6,
    C + 2, C - 10,
    C + 13, C - 2,
  ]).fill(0xfff59d);
  g.circle(C - 15, C + 8, 2.5).fill(0x6d4c41);
  g.circle(C + 17, C + 4, 2.5).fill(0x6d4c41);
  return toTexture(renderer, g);
}

function drawPineapple(renderer: Renderer): Texture {
  const g = new Graphics();
  // Crown
  g.poly([C - 8, C - 6, C - 5, C - 19, C - 2, C - 7]).fill(0x43a047);
  g.poly([C - 3, C - 7, C, C - 21, C + 3, C - 7]).fill(0x66bb6a);
  g.poly([C + 2, C - 7, C + 5, C - 19, C + 8, C - 6]).fill(0x43a047);
  // Body
  g.ellipse(C, C + 5, 13, 14).fill(0xffb300);
  // Crosshatch
  for (let i = -2; i <= 2; i++) {
    g.moveTo(C - 13, C + 5 + i * 6 - 6).lineTo(C + 13, C + 5 + i * 6 + 6)
      .stroke({ width: 1.5, color: 0xef8f00, alpha: 0.8 });
    g.moveTo(C + 13, C + 5 + i * 6 - 6).lineTo(C - 13, C + 5 + i * 6 + 6)
      .stroke({ width: 1.5, color: 0xef8f00, alpha: 0.8 });
  }
  return toTexture(renderer, g);
}

function drawCoconut(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(C, C, 16).fill(0x795548);
  g.circle(C - 4, C - 4, 10).fill({ color: 0x8d6e63, alpha: 0.7 });
  // Germination pores
  g.circle(C - 4, C - 3, 2).fill(0x4e342e);
  g.circle(C + 4, C - 3, 2).fill(0x4e342e);
  g.circle(C, C + 4, 2).fill(0x4e342e);
  // Fiber strokes
  g.moveTo(C - 12, C + 8).lineTo(C - 4, C + 13).stroke({ width: 1.5, color: 0x5d4037 });
  g.moveTo(C + 4, C + 13).lineTo(C + 12, C + 8).stroke({ width: 1.5, color: 0x5d4037 });
  return toTexture(renderer, g);
}

function drawHeart(renderer: Renderer): Texture {
  const g = new Graphics();
  g.circle(C - 7, C - 4, 9).fill(0xff4d6d);
  g.circle(C + 7, C - 4, 9).fill(0xff4d6d);
  g.poly([C - 15, C - 1, C + 15, C - 1, C, C + 15]).fill(0xff4d6d);
  g.circle(C - 7, C - 6, 3.5).fill({ color: 0xffffff, alpha: 0.5 });
  return toTexture(renderer, g);
}
