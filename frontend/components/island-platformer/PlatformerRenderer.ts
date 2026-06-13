import { Application, Container, Graphics, type Texture } from "pixi.js";
import { type LevelMap, TILE_PF_EMPTY } from "@/lib/platformer/types";
import { SpritePool } from "@/lib/game-core/SpritePool";

// Stage layout
//   stage
//   ├── bgContainer    (sky; fixed to screen)
//   └── worldContainer (translated by -camera each frame)
//         ├── tilesContainer  (viewport-culled sprite pool)
//         └── actorsContainer (sortableChildren for z-order)
export class PlatformerRenderer {
  private app: Application;
  private level: LevelMap;
  private tileTextures: Map<number, Texture>;

  private bgContainer: Container;
  private worldContainer: Container;
  private tilesContainer: Container;
  private actorsContainer: Container;

  private tilePool: SpritePool;
  private skyGfx: Graphics;

  constructor(app: Application, level: LevelMap, tileTextures: Map<number, Texture>) {
    this.app = app;
    this.level = level;
    this.tileTextures = tileTextures;

    this.bgContainer = new Container();
    this.bgContainer.label = "bg";
    app.stage.addChild(this.bgContainer);

    this.worldContainer = new Container();
    this.worldContainer.label = "world";
    app.stage.addChild(this.worldContainer);

    this.tilesContainer = new Container();
    this.tilesContainer.label = "tiles";
    this.worldContainer.addChild(this.tilesContainer);

    this.actorsContainer = new Container();
    this.actorsContainer.label = "actors";
    this.actorsContainer.sortableChildren = true;
    this.worldContainer.addChild(this.actorsContainer);

    this.tilePool = new SpritePool(this.tilesContainer);

    this.skyGfx = new Graphics();
    this.bgContainer.addChild(this.skyGfx);
    this.drawSky();
  }

  private drawSky(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const g = this.skyGfx;
    g.clear();
    switch (this.level.background) {
      case "stream":
        g.rect(0, 0, w, h).fill(0xb3e5fc);
        g.rect(0, h - 110, w, 110).fill(0x81d4fa);
        break;
      case "forest":
        g.rect(0, 0, w, h).fill(0x9ec5dc);
        g.rect(0, h - 80, w, 80).fill(0x6b8e7a);
        break;
      case "beach":
      default:
        g.rect(0, 0, w, h).fill(0xa8d8ff);
        g.rect(0, h - 80, w, 80).fill(0xfff3c4);
    }
  }

  resize(): void {
    this.drawSky();
  }

  setCamera(cameraX: number, cameraY: number): void {
    this.worldContainer.x = -cameraX;
    this.worldContainer.y = -cameraY;
  }

  // cameraX/Y is the world coord that aligns with the screen origin (top-left).
  update(cameraX: number, cameraY: number, screenW: number, screenH: number): void {
    this.setCamera(cameraX, cameraY);

    const tile = this.level.tile_size;
    const x0 = Math.max(0, Math.floor(cameraX / tile) - 1);
    const y0 = Math.max(0, Math.floor(cameraY / tile) - 1);
    const x1 = Math.min(this.level.width, Math.ceil((cameraX + screenW) / tile) + 1);
    const y1 = Math.min(this.level.height, Math.ceil((cameraY + screenH) / tile) + 1);

    this.tilePool.releaseAll();
    for (let y = y0; y < y1; y++) {
      const rowStart = y * this.level.width;
      for (let x = x0; x < x1; x++) {
        const id = this.level.tiles[rowStart + x];
        if (id === TILE_PF_EMPTY) continue;
        const tex = this.tileTextures.get(id);
        if (!tex) continue;
        const s = this.tilePool.acquire();
        s.texture = tex;
        s.x = x * tile;
        s.y = y * tile;
      }
    }
  }

  getActorsContainer(): Container { return this.actorsContainer; }
  getWorldContainer(): Container { return this.worldContainer; }

  destroy(): void {
    this.tilePool.destroy();
    this.skyGfx.destroy();
    this.bgContainer.destroy({ children: true });
    this.worldContainer.destroy({ children: true });
  }
}
