import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
import {
  TILE_PF_SIZE,
  TILE_PF_GROUND, TILE_PF_GROUND_INNER, TILE_PF_PLATFORM,
  TILE_PF_BRICK, TILE_PF_WATER, TILE_PF_SAND, TILE_PF_ROCK,
  TILE_PF_FLAG_POLE, TILE_PF_FLAG_TOP,
  TILE_PF_CLOUD, TILE_PF_BUSH,
} from "./types";

export function generatePlatformerTileTextures(renderer: Renderer): Map<number, Texture> {
  const textures = new Map<number, Texture>();
  const s = TILE_PF_SIZE;
  const ids = [
    TILE_PF_GROUND, TILE_PF_GROUND_INNER, TILE_PF_PLATFORM,
    TILE_PF_BRICK, TILE_PF_WATER, TILE_PF_SAND, TILE_PF_ROCK,
    TILE_PF_FLAG_POLE, TILE_PF_FLAG_TOP,
    TILE_PF_CLOUD, TILE_PF_BUSH,
  ];

  for (const id of ids) {
    const g = new Graphics();
    drawTile(g, id, s);
    textures.set(id, renderer.generateTexture({
      target: g,
      frame: new Rectangle(0, 0, s, s),
    }));
    g.destroy();
  }

  return textures;
}

function drawTile(g: Graphics, id: number, s: number): void {
  switch (id) {
    case TILE_PF_GROUND: {
      g.rect(0, 0, s, s).fill(0x8d5a36);
      g.rect(0, 0, s, 9).fill(0x4caf50);
      g.circle(6, 8, 3).fill(0x4caf50);
      g.circle(16, 9, 4).fill(0x66bb6a);
      g.circle(25, 8, 3).fill(0x4caf50);
      g.circle(8, 22, 2).fill(0xa37044);
      g.circle(22, 26, 2).fill(0xa37044);
      g.rect(0, 0, s, 1).fill({ color: 0x000000, alpha: 0.1 });
      g.rect(0, 0, 1, s).fill({ color: 0x000000, alpha: 0.05 });
      break;
    }
    case TILE_PF_GROUND_INNER: {
      g.rect(0, 0, s, s).fill(0x8d5a36);
      g.circle(8, 10, 2).fill(0xa37044);
      g.circle(20, 16, 2).fill(0xa37044);
      g.circle(12, 24, 2).fill(0xa37044);
      g.circle(26, 26, 2).fill(0x6d4628);
      break;
    }
    case TILE_PF_PLATFORM: {
      g.rect(0, 0, s, 10).fill(0x8d5a36);
      g.rect(0, 0, s, 4).fill(0x4caf50);
      g.rect(0, 9, s, 1).fill({ color: 0x000000, alpha: 0.2 });
      break;
    }
    case TILE_PF_BRICK: {
      g.rect(0, 0, s, s).fill(0xb35f3a);
      g.rect(0, 15, s, 2).fill(0x6e3b21);
      g.rect(15, 0, 2, 15).fill(0x6e3b21);
      g.rect(7, 17, 2, 15).fill(0x6e3b21);
      g.rect(23, 17, 2, 15).fill(0x6e3b21);
      g.rect(0, 0, s, 1).fill({ color: 0xffffff, alpha: 0.12 });
      break;
    }
    case TILE_PF_WATER: {
      g.rect(0, 0, s, s).fill(0x2c8fc9);
      g.rect(2, 4, 8, 2).fill({ color: 0xffffff, alpha: 0.4 });
      g.rect(18, 8, 10, 2).fill({ color: 0xffffff, alpha: 0.3 });
      g.rect(6, 18, 12, 2).fill({ color: 0xffffff, alpha: 0.25 });
      break;
    }
    case TILE_PF_SAND: {
      g.rect(0, 0, s, s).fill(0xf3d28d);
      g.circle(8, 12, 2).fill(0xe7c373);
      g.circle(20, 22, 2).fill(0xe7c373);
      g.circle(14, 6, 1).fill(0xd9b65f);
      break;
    }
    case TILE_PF_ROCK: {
      g.rect(0, 0, s, s).fill(0x6d6d6d);
      g.roundRect(4, 4, 24, 24, 6).fill(0x8a8a8a);
      g.circle(12, 12, 3).fill(0xa0a0a0);
      g.circle(22, 18, 2).fill(0xa0a0a0);
      break;
    }
    case TILE_PF_FLAG_POLE: {
      g.rect(s / 2 - 2, 0, 4, s).fill(0xb0b0b0);
      g.rect(s / 2 - 1, 0, 1, s).fill(0xe0e0e0);
      break;
    }
    case TILE_PF_FLAG_TOP: {
      g.rect(s / 2 - 2, 6, 4, s - 6).fill(0xb0b0b0);
      g.circle(s / 2, 6, 5).fill(0xffd54f);
      g.poly([s / 2 + 1, 8, s - 2, 14, s / 2 + 1, 20]).fill(0xe53935);
      break;
    }
    case TILE_PF_CLOUD: {
      g.circle(10, 18, 7).fill(0xffffff);
      g.circle(20, 16, 8).fill(0xffffff);
      g.circle(15, 22, 6).fill(0xffffff);
      g.circle(24, 22, 5).fill(0xffffff);
      g.circle(6, 22, 4).fill(0xffffff);
      break;
    }
    case TILE_PF_BUSH: {
      g.circle(10, 24, 8).fill(0x4a8f3e);
      g.circle(22, 26, 7).fill(0x4a8f3e);
      g.circle(16, 22, 9).fill(0x66bb6a);
      g.circle(13, 23, 3).fill({ color: 0xffffff, alpha: 0.2 });
      break;
    }
  }
}
