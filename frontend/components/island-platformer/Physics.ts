import { type LevelMap, TILE_PF_SIZE, SOLID_PF_TILES } from "@/lib/platformer/types";

const TILE = TILE_PF_SIZE;
const EPS = 0.01;

// Movable body: AABB whose origin is bottom-center.
// `x` = horizontal center, `y` = bottom edge (in pixels).
export interface MovableBody {
  x: number;
  y: number;
}

export interface AABB {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function isSolidAt(level: LevelMap, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= level.width) return true;       // map sides are walls
  if (ty < 0) return false;                            // open sky
  if (ty >= level.height) return false;                // death pit (engine handles)
  return SOLID_PF_TILES.has(level.tiles[ty * level.width + tx]);
}

// Move horizontally. Returns true if a wall blocked the movement.
export function moveX(
  body: MovableBody, dx: number, level: LevelMap, w: number, h: number,
): boolean {
  if (dx === 0) return false;
  const newX = body.x + dx;
  const halfW = w / 2;
  const top    = body.y - h + EPS;
  const bottom = body.y - EPS;
  const ty0 = Math.floor(top / TILE);
  const ty1 = Math.floor(bottom / TILE);

  if (dx > 0) {
    const tx = Math.floor((newX + halfW - EPS) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isSolidAt(level, tx, ty)) {
        body.x = tx * TILE - halfW - EPS;
        return true;
      }
    }
  } else {
    const tx = Math.floor((newX - halfW) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isSolidAt(level, tx, ty)) {
        body.x = (tx + 1) * TILE + halfW + EPS;
        return true;
      }
    }
  }
  body.x = newX;
  return false;
}

// Move vertically. Returns true if a tile blocked the movement.
// Caller infers floor vs ceiling from sign of dy.
export function moveY(
  body: MovableBody, dy: number, level: LevelMap, w: number, h: number,
): boolean {
  if (dy === 0) return false;
  const newY = body.y + dy;
  const halfW = w / 2;
  const left  = body.x - halfW + EPS;
  const right = body.x + halfW - EPS;
  const tx0 = Math.floor(left / TILE);
  const tx1 = Math.floor(right / TILE);

  if (dy > 0) {
    const ty = Math.floor((newY - EPS) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolidAt(level, tx, ty)) {
        body.y = ty * TILE - EPS;
        return true;
      }
    }
  } else {
    const ty = Math.floor((newY - h) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolidAt(level, tx, ty)) {
        body.y = (ty + 1) * TILE + h + EPS;
        return true;
      }
    }
  }
  body.y = newY;
  return false;
}

export function bodyAABB(body: MovableBody, w: number, h: number): AABB {
  return {
    left: body.x - w / 2,
    right: body.x + w / 2,
    top: body.y - h,
    bottom: body.y,
  };
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Returns true if `player` is landing on top of `enemy` this frame.
// Uses player.vy > 0 (falling) and a small overlap window.
export function isStomp(playerVy: number, playerBottom: number, enemyTop: number): boolean {
  return playerVy > 0 && playerBottom - enemyTop <= 14;
}
