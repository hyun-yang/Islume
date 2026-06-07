import { type Application } from "pixi.js";
import { type LevelMap, TILE_PF_SIZE } from "@/lib/platformer/types";
import { type Player } from "./Player";

const LEAD_DISTANCE = 64;     // px — push camera in player's facing direction
const LERP = 0.12;
const PLAYER_SCREEN_X_RATIO = 0.4;
const PLAYER_SCREEN_Y_RATIO = 0.62;

// The camera owns (cameraX, cameraY) — the world-coord point that should
// align with the screen origin (top-left). worldContainer.x = -cameraX.
export class PlatformerCamera {
  x = 0;
  y = 0;

  constructor(private app: Application, private level: LevelMap, private player: Player) {}

  update(): void {
    const target = this.computeTarget();
    this.x += (target.x - this.x) * LERP;
    this.y += (target.y - this.y) * LERP;
    this.clamp();
  }

  snap(): void {
    const target = this.computeTarget();
    this.x = target.x;
    this.y = target.y;
    this.clamp();
  }

  private computeTarget(): { x: number; y: number } {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    return {
      x: this.player.x
         - screenW * PLAYER_SCREEN_X_RATIO
         + this.player.facing * LEAD_DISTANCE,
      y: this.player.y - screenH * PLAYER_SCREEN_Y_RATIO,
    };
  }

  private clamp(): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const levelW = this.level.width * TILE_PF_SIZE;
    const levelH = this.level.height * TILE_PF_SIZE;

    if (levelW <= screenW) {
      this.x = (levelW - screenW) / 2;
    } else {
      const maxX = levelW - screenW;
      if (this.x < 0) this.x = 0;
      else if (this.x > maxX) this.x = maxX;
    }

    if (levelH <= screenH) {
      // Level is shorter than the viewport — anchor it to the bottom of
      // the screen so the sky fills the area above.
      this.y = levelH - screenH;
    } else {
      const maxY = levelH - screenH;
      if (this.y < 0) this.y = 0;
      else if (this.y > maxY) this.y = maxY;
    }
  }
}
