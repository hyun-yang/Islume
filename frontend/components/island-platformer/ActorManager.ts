import { Container, Sprite, type Texture } from "pixi.js";
import {
  type LevelMap, type Actor as ActorData,
  TILE_PF_SIZE, SOLID_PF_TILES,
} from "@/lib/platformer/types";
import { type EnemyTextureSet } from "@/lib/platformer/enemyTextures";
import { type ItemTextureSet } from "@/lib/platformer/itemTextures";
import {
  type PlatformTextureSet,
  LOG_W, LOG_H, LILY_W, LILY_H, WHALE_W, WHALE_H, DROP_W, DROP_H,
} from "@/lib/platformer/platformTextures";
import {
  type BossTextureSet,
  BEAR_W, BEAR_H,
  COCONUT_BLOCK_W, COCONUT_BLOCK_H,
  COCONUT_W, COCONUT_H,
  PINEAPPLE_W, PINEAPPLE_H,
} from "@/lib/platformer/bossTextures";
import {
  type CharacterTextureSet,
  PLATFORMER_CHAR_FRAME_W,
  PLATFORMER_CHAR_FRAME_H,
} from "@/lib/platformer/characterTextures";
import { type Player, PLAYER_W, PLAYER_H } from "./Player";
import {
  moveX as physicsMoveX,
  bodyAABB, aabbOverlap, isStomp, type AABB,
} from "./Physics";
import { sound } from "@/lib/platformer/audio";

const TILE = TILE_PF_SIZE;

const CRAB_W = 24;
const CRAB_H = 18;
const CRAB_SPEED = 60;
const CRAB_FRAME_TIME = 0.18;

const STARFISH_W = 22;
const STARFISH_H = 22;
const STARFISH_HOP_VY = -260;
const STARFISH_GRAVITY = 1400;

const SHELL_W = 18;
const SHELL_H = 18;
const SHELL_FRAME_TIME = 0.12;

const HEART_W = 20;
const HEART_H = 20;

const BANANA_W = 20;
const BANANA_H = 20;
const BANANA_DURATION_S = 6;

const FROG_W = 24;
const FROG_H = 22;
const FROG_FIRE_INTERVAL = 2.4;
const FROG_PROJECTILE_VX = 220;
const FROG_PROJECTILE_LIFE = 2.5;

const LOG_SPEED = 60;          // px/s, default
const LILY_SINK_VY = 30;       // px/s
const LILY_SINK_LIMIT = 64;    // px below origin before despawn
const WHALE_HOP_INTERVAL = 2.0;
const WHALE_HOP_AMPLITUDE = 80; // peak height above resting
const WHALE_TRAMPOLINE_VY = -780;

const PINEAPPLE_DURATION_S = 8;
const COCONUT_BUMP_VY = 150;       // initial outward velocity of falling coconut
const COCONUT_GRAVITY = 1400;
const COCONUT_BLOCK_BUMP_COOLDOWN = 0.5;
const BEAR_GROGGY_S = 1.4;          // duration of dazed state
const BEAR_MOVE_SPEED = 90;         // px/s when walking aside
const BEAR_MOVE_DISTANCE = 100;     // total horizontal distance the bear retreats

export interface ActorEvents {
  onShellCollected: () => void;
  onHeartCollected: () => void;
  onPlayerDamaged: () => void;
  onEnemyStomped: () => void;
  onBananaCollected?: () => void;
  onPineappleCollected?: () => void;
  onBossCleared?: () => void;
}

abstract class BaseActor {
  x: number;
  y: number;
  sprite: Sprite;
  dead = false;
  fadeTimer = 0;
  // True for actors that act as ride-on surfaces (Log, LilyPad, Whale).
  // Such actors don't damage the player on touch and supply per-frame deltas
  // via lastDx / lastDy that platformPass applies to the player when riding.
  isPlatform = false;
  lastDx = 0;
  lastDy = 0;

  protected constructor(x: number, y: number, sprite: Sprite) {
    this.x = x;
    this.y = y;
    this.sprite = sprite;
  }

  abstract update(dt: number, level: LevelMap): void;
  abstract onPlayerCollide(player: Player, events: ActorEvents): void;
  abstract bounds(): AABB;

  canRemove(): boolean {
    return this.dead && this.fadeTimer >= 0.3;
  }

  protected updateFadeOnDeath(dt: number): boolean {
    if (!this.dead) return false;
    this.fadeTimer += dt;
    this.sprite.alpha = Math.max(0, 1 - this.fadeTimer * 4);
    return true;
  }

  destroy(): void {
    this.sprite.destroy();
  }

  // Common path for enemies: pineapple-invincibility smashes them outright.
  // Returns true if the contact was already resolved.
  protected smashCheck(player: Player, events: ActorEvents): boolean {
    if (player.canSmashEnemies()) {
      this.dead = true;
      this.fadeTimer = 0;
      events.onEnemyStomped();
      return true;
    }
    return false;
  }
}

// ----- Crab: walks left/right, stomp-defeatable -----
class Crab extends BaseActor {
  private vx: number;
  private walkRange: [number, number];
  private textures: Texture[];
  private animTime = 0;

  constructor(x: number, y: number, walkRange: [number, number], textures: Texture[]) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 100;
    super(x, y, sprite);
    this.walkRange = walkRange;
    this.textures = textures;
    this.vx = -CRAB_SPEED;
  }

  update(dt: number, level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;

    physicsMoveX(this, this.vx * dt, level, CRAB_W, CRAB_H);

    // Walk-range bounds (in tile coords)
    const tileX = this.x / TILE;
    if (tileX <= this.walkRange[0] + 0.2 && this.vx < 0) this.vx = CRAB_SPEED;
    else if (tileX >= this.walkRange[1] + 0.8 && this.vx > 0) this.vx = -CRAB_SPEED;

    // Edge detection: avoid walking off cliffs
    const aheadX = this.x + Math.sign(this.vx) * (CRAB_W / 2 + 2);
    const aheadTx = Math.floor(aheadX / TILE);
    const belowTy = Math.floor((this.y + 4) / TILE);
    if (!tileSolid(level, aheadTx, belowTy)) {
      this.vx = -this.vx;
    }

    this.animTime += dt;
    const idx = Math.floor(this.animTime / CRAB_FRAME_TIME) % this.textures.length;
    this.sprite.texture = this.textures[idx];
    this.sprite.scale.x = this.vx >= 0 ? 1 : -1;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    if (this.smashCheck(player, events)) return;
    const top = this.y - CRAB_H;
    const pb = player.bounds();
    if (isStomp(player.vy, pb.bottom, top)) {
      this.dead = true;
      this.fadeTimer = 0;
      player.stompBounce();
      events.onEnemyStomped();
    } else if (!player.isInvincible()) {
      if (player.damage()) events.onPlayerDamaged();
    }
  }

  bounds(): AABB {
    return bodyAABB(this, CRAB_W, CRAB_H);
  }
}

// ----- Starfish: stationary, hops at a fixed interval -----
class Starfish extends BaseActor {
  private baseY: number;
  private vy = 0;
  private jumpInterval: number;
  private jumpTimer: number;
  private texture: Texture;

  constructor(x: number, y: number, jumpIntervalMs: number, texture: Texture) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 100;
    super(x, y, sprite);
    this.baseY = y;
    this.jumpInterval = jumpIntervalMs / 1000;
    this.jumpTimer = Math.random() * this.jumpInterval; // staggered
    this.texture = texture;
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;

    if (this.y < this.baseY) {
      this.vy += STARFISH_GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y >= this.baseY) {
        this.y = this.baseY;
        this.vy = 0;
      }
    } else {
      this.jumpTimer += dt;
      if (this.jumpTimer >= this.jumpInterval) {
        this.jumpTimer = 0;
        this.vy = STARFISH_HOP_VY;
        this.y -= 1;
      }
    }

    this.sprite.x = this.x;
    this.sprite.y = this.y;
    this.sprite.rotation = (this.baseY - this.y) * 0.02;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    if (this.smashCheck(player, events)) return;
    const top = this.y - STARFISH_H;
    const pb = player.bounds();
    if (isStomp(player.vy, pb.bottom, top)) {
      this.dead = true;
      this.fadeTimer = 0;
      player.stompBounce();
      events.onEnemyStomped();
    } else if (!player.isInvincible()) {
      if (player.damage()) events.onPlayerDamaged();
    }
  }

  bounds(): AABB {
    return bodyAABB(this, STARFISH_W, STARFISH_H);
  }
}

// ----- Shell (collectible coin) -----
class Shell extends BaseActor {
  private textures: Texture[];
  private animTime = 0;

  constructor(x: number, y: number, textures: Texture[]) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 50;
    super(x, y, sprite);
    this.textures = textures;
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) {
      this.sprite.y -= dt * 60;     // gentle rise on collect
      return;
    }
    this.animTime += dt;
    const idx = Math.floor(this.animTime / SHELL_FRAME_TIME) % this.textures.length;
    this.sprite.texture = this.textures[idx];
    // Subtle bob
    this.sprite.y = this.y + Math.sin(this.animTime * 4) * 1.5;
    this.sprite.x = this.x;
  }

  onPlayerCollide(_player: Player, events: ActorEvents): void {
    if (this.dead) return;
    this.dead = true;
    this.fadeTimer = 0;
    events.onShellCollected();
  }

  bounds(): AABB {
    return {
      left: this.x - SHELL_W / 2,
      right: this.x + SHELL_W / 2,
      top: this.y - SHELL_H / 2,
      bottom: this.y + SHELL_H / 2,
    };
  }
}

// ----- Heart fruit (heal +1) -----
class HeartFruit extends BaseActor {
  private animTime = 0;

  constructor(x: number, y: number, texture: Texture) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 50;
    super(x, y, sprite);
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) {
      this.sprite.y -= dt * 60;
      return;
    }
    this.animTime += dt;
    this.sprite.y = this.y + Math.sin(this.animTime * 3) * 2;
    this.sprite.x = this.x;
    this.sprite.scale.set(1 + Math.sin(this.animTime * 6) * 0.05);
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    this.dead = true;
    this.fadeTimer = 0;
    player.heal();
    events.onHeartCollected();
  }

  bounds(): AABB {
    return {
      left: this.x - HEART_W / 2,
      right: this.x + HEART_W / 2,
      top: this.y - HEART_H / 2,
      bottom: this.y + HEART_H / 2,
    };
  }
}

function tileSolid(level: LevelMap, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= level.width || ty < 0 || ty >= level.height) return false;
  return SOLID_PF_TILES.has(level.tiles[ty * level.width + tx]);
}

// ----- Bear (boss): blocks the path until knocked out by a falling coconut -----
type BearState = "sleeping" | "groggy" | "moving" | "cleared";

class Bear extends BaseActor {
  state: BearState = "sleeping";
  private textures: Texture[];
  private timer = 0;
  private originX: number;

  constructor(x: number, y: number, textures: Texture[]) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 90;
    super(x, y, sprite);
    this.textures = textures;
    this.originX = x;
  }

  hitByCoconut(): boolean {
    if (this.state !== "sleeping") return false;
    this.state = "groggy";
    this.timer = BEAR_GROGGY_S;
    this.sprite.texture = this.textures[1];
    this.sprite.scale.x = 1; // face forward
    return true;
  }

  isBlocking(): boolean {
    return this.state !== "cleared";
  }

  update(dt: number, _level: LevelMap): void {
    if (this.dead) return;

    if (this.state === "groggy") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "moving";
        this.sprite.texture = this.textures[2];
      }
    } else if (this.state === "moving") {
      this.x -= BEAR_MOVE_SPEED * dt;
      if (this.originX - this.x >= BEAR_MOVE_DISTANCE) {
        this.state = "cleared";
        this.sprite.alpha = 0.6;
      }
    }

    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    if (this.state === "cleared") return;
    // Player nudged into the bear from the side — apply contact damage for
    // sleeping/groggy/moving alike (boss cannot be stomped or smashed).
    if (!player.isInvincible() && !player.canSmashEnemies()) {
      if (player.damage()) events.onPlayerDamaged();
    }
  }

  bounds(): AABB {
    return {
      left:   this.x - BEAR_W / 2,
      right:  this.x + BEAR_W / 2,
      top:    this.y - BEAR_H,
      bottom: this.y,
    };
  }
}

// ----- Coconut block: bumpable from below, drops a coconut -----
class CoconutBlock extends BaseActor {
  private textures: Texture[];
  private cooldown = 0;
  private bumpAnim = 0;
  private spawnCoconut: (x: number, y: number) => void;
  private bumpedOnce = false;

  constructor(
    x: number, y: number, textures: Texture[],
    spawn: (x: number, y: number) => void,
  ) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 80;
    super(x, y, sprite);
    this.isPlatform = true;
    this.textures = textures;
    this.spawnCoconut = spawn;
  }

  bump(): void {
    if (this.cooldown > 0 || this.bumpedOnce) return;
    this.cooldown = COCONUT_BLOCK_BUMP_COOLDOWN;
    this.bumpAnim = 0.18;
    this.bumpedOnce = true;
    this.sprite.texture = this.textures[1];
    this.spawnCoconut(this.x, this.y - COCONUT_BLOCK_H);
    sound.bump();
  }

  update(dt: number, _level: LevelMap): void {
    if (this.dead) return;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.bumpAnim > 0) {
      this.bumpAnim -= dt;
      this.sprite.y = this.y + Math.sin((1 - this.bumpAnim / 0.18) * Math.PI) * -4;
    } else {
      this.sprite.y = this.y;
    }
    this.sprite.x = this.x;
  }

  onPlayerCollide(_player: Player, _events: ActorEvents): void { /* solid */ }

  bounds(): AABB {
    return {
      left:   this.x - COCONUT_BLOCK_W / 2,
      right:  this.x + COCONUT_BLOCK_W / 2,
      top:    this.y - COCONUT_BLOCK_H,
      bottom: this.y,
    };
  }
}

// ----- Coconut: falling projectile that wakes the boss -----
class Coconut extends BaseActor {
  private vy = COCONUT_BUMP_VY;
  private vx = 0;
  private getBear: () => Bear | null;

  constructor(x: number, y: number, texture: Texture, getBear: () => Bear | null) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 95;
    super(x, y, sprite);
    this.getBear = getBear;
    // Drift toward the bear so the coconut reliably lands on the head.
    const bear = getBear();
    if (bear) {
      const dx = bear.x - x;
      this.vx = dx === 0 ? 0 : Math.sign(dx) * 80;
    }
  }

  update(dt: number, level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;
    this.vy += COCONUT_GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
    this.sprite.rotation += dt * 4;

    // Bear collision (head shot)
    const bear = this.getBear();
    if (bear && bear.state === "sleeping") {
      const head = {
        left: bear.x - BEAR_W / 2 - 6,
        right: bear.x - BEAR_W / 2 + 16, // head is on the bear's left side while sleeping
        top: bear.y - BEAR_H + 4,
        bottom: bear.y - BEAR_H + 18,
      };
      const cb = this.bounds();
      if (aabbOverlap(cb, head)) {
        bear.hitByCoconut();
        this.dead = true;
        this.fadeTimer = 0;
        return;
      }
    }

    // Ground collision — despawn quietly
    const tx = Math.floor(this.x / TILE);
    const ty = Math.floor(this.y / TILE);
    if (tileSolid(level, tx, ty)) {
      this.dead = true;
      this.fadeTimer = 0;
    }
    // Off-bottom safety
    if (this.y > level.height * TILE + 40) {
      this.dead = true;
      this.fadeTimer = 0;
    }
  }

  onPlayerCollide(_player: Player, _events: ActorEvents): void { /* harmless */ }

  bounds(): AABB {
    return {
      left:   this.x - COCONUT_W / 2,
      right:  this.x + COCONUT_W / 2,
      top:    this.y - COCONUT_H / 2,
      bottom: this.y + COCONUT_H / 2,
    };
  }
}

// ----- Pineapple power-up (invincibility) -----
class Pineapple extends BaseActor {
  private textures: Texture[];
  private animTime = 0;

  constructor(x: number, y: number, textures: Texture[]) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 50;
    super(x, y, sprite);
    this.textures = textures;
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) {
      this.sprite.y -= dt * 60;
      return;
    }
    this.animTime += dt;
    const idx = Math.floor(this.animTime * 6) % this.textures.length;
    this.sprite.texture = this.textures[idx];
    this.sprite.y = this.y + Math.sin(this.animTime * 3) * 2;
    this.sprite.x = this.x;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    this.dead = true;
    this.fadeTimer = 0;
    player.applyInvincibility(PINEAPPLE_DURATION_S);
    events.onPineappleCollected?.();
  }

  bounds(): AABB {
    return {
      left:   this.x - PINEAPPLE_W / 2,
      right:  this.x + PINEAPPLE_W / 2,
      top:    this.y - PINEAPPLE_H / 2,
      bottom: this.y + PINEAPPLE_H / 2,
    };
  }
}

// ----- Tani NPC: visual-only end-of-stage character -----
class TaniNPC extends BaseActor {
  constructor(x: number, y: number, textures: CharacterTextureSet) {
    const sprite = new Sprite(textures.idle[0]);
    sprite.anchor.set(0.5, 1);
    sprite.scale.x = -1;  // face left toward incoming player
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 90;
    super(x, y, sprite);
  }

  update(_dt: number, _level: LevelMap): void {
    if (this.dead) return;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  onPlayerCollide(_player: Player, _events: ActorEvents): void { /* visual */ }

  bounds(): AABB {
    return {
      left:   this.x - PLATFORMER_CHAR_FRAME_W / 2,
      right:  this.x + PLATFORMER_CHAR_FRAME_W / 2,
      top:    this.y - PLATFORMER_CHAR_FRAME_H,
      bottom: this.y,
    };
  }
}

// ----- Frog: stationary, fires water-drop projectiles -----
class Frog extends BaseActor {
  private textures: Texture[];
  private fireTimer: number;
  private projectileTexture: Texture;
  private spawn: (x: number, y: number, vx: number) => void;
  private animTime = 0;
  private facing: -1 | 1;

  constructor(
    x: number, y: number, textures: Texture[],
    projectileTexture: Texture, facing: -1 | 1,
    spawn: (x: number, y: number, vx: number) => void,
  ) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 100;
    sprite.scale.x = facing;
    super(x, y, sprite);
    this.textures = textures;
    this.projectileTexture = projectileTexture;
    this.spawn = spawn;
    this.facing = facing;
    this.fireTimer = FROG_FIRE_INTERVAL * (0.5 + Math.random() * 0.5);
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;

    this.animTime += dt;
    this.fireTimer -= dt;

    let texIdx = 0;
    // Brief "spit" frame around firing, then settle to idle/blink.
    if (this.fireTimer < 0.15 && this.fireTimer > -0.05) {
      texIdx = 2; // mouth open
    } else if (Math.floor(this.animTime * 1.3) % 4 === 0) {
      texIdx = 1; // blink
    } else {
      texIdx = 0; // idle
    }
    this.sprite.texture = this.textures[texIdx];

    if (this.fireTimer <= 0) {
      this.fireTimer = FROG_FIRE_INTERVAL;
      this.spawn(
        this.x + this.facing * 10,
        this.y - FROG_H / 2,
        this.facing * FROG_PROJECTILE_VX,
      );
    }
    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    if (this.smashCheck(player, events)) return;
    const top = this.y - FROG_H;
    const pb = player.bounds();
    if (isStomp(player.vy, pb.bottom, top)) {
      this.dead = true;
      this.fadeTimer = 0;
      player.stompBounce();
      events.onEnemyStomped();
    } else if (!player.isInvincible()) {
      if (player.damage()) events.onPlayerDamaged();
    }
  }

  bounds(): AABB {
    return bodyAABB(this, FROG_W, FROG_H);
  }
}

// ----- Projectile (water drop) -----
class Projectile extends BaseActor {
  private vx: number;
  private life: number;

  constructor(x: number, y: number, vx: number, texture: Texture) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 110;
    super(x, y, sprite);
    this.vx = vx;
    this.life = FROG_PROJECTILE_LIFE;
  }

  update(dt: number, level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;

    this.life -= dt;
    if (this.life <= 0) { this.dead = true; this.fadeTimer = 0; return; }

    this.x += this.vx * dt;
    // Despawn on wall hit
    const tx = Math.floor(this.x / TILE);
    const ty = Math.floor(this.y / TILE);
    if (tileSolid(level, tx, ty)) { this.dead = true; this.fadeTimer = 0; return; }

    this.sprite.x = this.x;
    this.sprite.y = this.y;
    this.sprite.rotation += dt * 8;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    if (!player.isInvincible()) {
      if (player.damage()) events.onPlayerDamaged();
    }
    this.dead = true;
    this.fadeTimer = 0;
  }

  bounds(): AABB {
    return {
      left:   this.x - DROP_W / 2,
      right:  this.x + DROP_W / 2,
      top:    this.y - DROP_H / 2,
      bottom: this.y + DROP_H / 2,
    };
  }
}

// ----- Log: horizontal moving platform -----
class Log extends BaseActor {
  private vx: number;
  private bounds_: [number, number]; // pixel bounds [minX, maxX] for bobbing

  constructor(x: number, y: number, range: [number, number], texture: Texture) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 80;
    super(x, y, sprite);
    this.isPlatform = true;
    this.vx = LOG_SPEED;
    this.bounds_ = [range[0] * TILE, range[1] * TILE];
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;
    const prevX = this.x;
    this.x += this.vx * dt;
    if (this.x < this.bounds_[0]) { this.x = this.bounds_[0]; this.vx = -this.vx; }
    else if (this.x > this.bounds_[1]) { this.x = this.bounds_[1]; this.vx = -this.vx; }
    this.lastDx = this.x - prevX;
    this.lastDy = 0;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  onPlayerCollide(_player: Player, _events: ActorEvents): void {
    // Logs are ride-on surfaces handled in platformPass; touching from the side
    // does no damage. Intentionally empty.
  }

  bounds(): AABB {
    return {
      left:   this.x - LOG_W / 2,
      right:  this.x + LOG_W / 2,
      top:    this.y - LOG_H,
      bottom: this.y,
    };
  }
}

// ----- LilyPad: sinks while ridden, despawns at limit -----
class LilyPad extends BaseActor {
  private texture: Texture;
  private originY: number;
  private sinking = false;
  private sunkAmount = 0;

  constructor(x: number, y: number, texture: Texture) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 80;
    super(x, y, sprite);
    this.isPlatform = true;
    this.texture = texture;
    this.originY = y;
  }

  setSinking(sinking: boolean): void { this.sinking = sinking; }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;
    const prevY = this.y;
    if (this.sinking) {
      this.y += LILY_SINK_VY * dt;
      this.sunkAmount = this.y - this.originY;
      if (this.sunkAmount >= LILY_SINK_LIMIT) {
        this.dead = true;
        this.fadeTimer = 0;
      }
    } else if (this.y > this.originY) {
      // Slowly bob back when not ridden (gentle).
      this.y = Math.max(this.originY, this.y - LILY_SINK_VY * 0.3 * dt);
      this.sunkAmount = Math.max(0, this.y - this.originY);
    }
    this.lastDx = 0;
    this.lastDy = this.y - prevY;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
    // Reset sinking each frame; platformPass re-asserts it when player is on top.
    this.sinking = false;
  }

  onPlayerCollide(_player: Player, _events: ActorEvents): void { /* ride-on */ }

  bounds(): AABB {
    return {
      left:   this.x - LILY_W / 2,
      right:  this.x + LILY_W / 2,
      top:    this.y - LILY_H,
      bottom: this.y,
    };
  }
}

// ----- Whale: periodic vertical hop, trampolines player on contact -----
class Whale extends BaseActor {
  private textures: Texture[];
  private restY: number;
  private vy = 0;
  private hopTimer: number;
  private trampolined = false;

  constructor(x: number, y: number, textures: Texture[], hopIntervalMs: number) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 1);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 80;
    super(x, y, sprite);
    this.isPlatform = true;
    this.textures = textures;
    this.restY = y;
    this.hopTimer = hopIntervalMs / 1000 * (0.4 + Math.random() * 0.6);
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) return;
    const prevY = this.y;

    if (this.y < this.restY) {
      this.vy += 1600 * dt; // gravity-like return
      this.y += this.vy * dt;
      if (this.y >= this.restY) {
        this.y = this.restY;
        this.vy = 0;
        this.trampolined = false;
      }
    } else {
      this.hopTimer -= dt;
      if (this.hopTimer <= 0) {
        this.hopTimer = WHALE_HOP_INTERVAL + (Math.random() - 0.5) * 0.6;
        this.vy = -Math.sqrt(2 * 1600 * WHALE_HOP_AMPLITUDE);
        this.y -= 1;
      }
    }

    this.lastDx = 0;
    this.lastDy = this.y - prevY;
    this.sprite.texture = this.textures[this.vy < 0 ? 1 : 0];
    this.sprite.x = this.x;
    this.sprite.y = this.y;
  }

  // Bounce the player upward when they land on the whale during ascent.
  tryTrampoline(player: Player, prevPlayerBottom: number): boolean {
    if (this.trampolined) return false;
    const top = this.y - WHALE_H;
    if (this.vy < 0
        && player.vy >= 0
        && prevPlayerBottom <= top + 6
        && player.bounds().bottom >= top - 6) {
      const pb = player.bounds();
      const myBounds = this.bounds();
      if (pb.right > myBounds.left + 4 && pb.left < myBounds.right - 4) {
        player.trampoline(WHALE_TRAMPOLINE_VY);
        this.trampolined = true;
        return true;
      }
    }
    return false;
  }

  onPlayerCollide(_player: Player, _events: ActorEvents): void { /* ride-on */ }

  bounds(): AABB {
    return {
      left:   this.x - WHALE_W / 2,
      right:  this.x + WHALE_W / 2,
      top:    this.y - WHALE_H,
      bottom: this.y,
    };
  }
}

// ----- Banana: speed/jump boost -----
class Banana extends BaseActor {
  private textures: Texture[];
  private animTime = 0;

  constructor(x: number, y: number, textures: Texture[]) {
    const sprite = new Sprite(textures[0]);
    sprite.anchor.set(0.5, 0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.zIndex = 50;
    super(x, y, sprite);
    this.textures = textures;
  }

  update(dt: number, _level: LevelMap): void {
    if (this.updateFadeOnDeath(dt)) {
      this.sprite.y -= dt * 60;
      return;
    }
    this.animTime += dt;
    const idx = Math.floor(this.animTime * 4) % this.textures.length;
    this.sprite.texture = this.textures[idx];
    this.sprite.y = this.y + Math.sin(this.animTime * 3) * 2;
    this.sprite.x = this.x;
  }

  onPlayerCollide(player: Player, events: ActorEvents): void {
    if (this.dead) return;
    this.dead = true;
    this.fadeTimer = 0;
    player.applyBoost(BANANA_DURATION_S);
    events.onBananaCollected?.();
  }

  bounds(): AABB {
    return {
      left:   this.x - BANANA_W / 2,
      right:  this.x + BANANA_W / 2,
      top:    this.y - BANANA_H / 2,
      bottom: this.y + BANANA_H / 2,
    };
  }
}

// ----- Manager -----

export class ActorManager {
  private actors: BaseActor[] = [];
  private container: Container;
  private level: LevelMap;
  private events: ActorEvents;
  private platformTex: PlatformTextureSet | null;
  private bossTex: BossTextureSet | null;
  private bossClearedAnnounced = false;
  private prevPlayerBounds: AABB | null = null;

  constructor(
    container: Container,
    level: LevelMap,
    enemyTex: EnemyTextureSet,
    itemTex: ItemTextureSet,
    events: ActorEvents,
    platformTex?: PlatformTextureSet,
    bossTex?: BossTextureSet,
    taniTex?: CharacterTextureSet,
  ) {
    this.container = container;
    this.level = level;
    this.events = events;
    this.platformTex = platformTex ?? null;
    this.bossTex = bossTex ?? null;

    const spawnProjectile = (x: number, y: number, vx: number) => {
      if (!this.platformTex) return;
      const p = new Projectile(x, y, vx, this.platformTex.waterDrop[0]);
      this.actors.push(p);
      this.container.addChild(p.sprite);
    };
    const spawnCoconut = (x: number, y: number) => {
      if (!this.bossTex) return;
      const findBear = (): Bear | null => {
        for (const a of this.actors) if (a instanceof Bear) return a;
        return null;
      };
      const c = new Coconut(x, y, this.bossTex.coconut[0], findBear);
      this.actors.push(c);
      this.container.addChild(c.sprite);
    };

    for (const data of level.actors) {
      const actor = this.createActor(
        data, enemyTex, itemTex, spawnProjectile, spawnCoconut, taniTex,
      );
      if (!actor) continue;
      this.actors.push(actor);
      container.addChild(actor.sprite);
    }
  }

  update(dt: number, player: Player): void {
    // Use the player's bounds from the END of the previous manager.update
    // (= start of this frame, before player.update moved the body) so the
    // platform/bump passes can detect transitions like "was above last frame,
    // now overlapping this frame".
    const prev = this.prevPlayerBounds ?? player.bounds();
    const prevPlayerBottom = prev.bottom;
    const prevPlayerTop = prev.top;
    for (const a of this.actors) a.update(dt, this.level);
    this.platformPass(player, prevPlayerBottom);
    this.bumpPass(player, prevPlayerTop);
    this.bearWallPass(player);
    this.checkCollisions(player);
    this.announceBossClear();
    this.cull();
    this.prevPlayerBounds = player.bounds();
  }

  private bumpPass(player: Player, prevPlayerTop: number): void {
    if (player.vy >= 0) return;
    const pb = player.bounds();
    for (const a of this.actors) {
      if (!(a instanceof CoconutBlock)) continue;
      const ab = a.bounds();
      if (pb.right <= ab.left + 2 || pb.left >= ab.right - 2) continue;
      if (prevPlayerTop >= ab.bottom - 2 && pb.top <= ab.bottom + 2) {
        player.y = ab.bottom + PLAYER_H + 0.01;
        player.vy = 100;
        a.bump();
      }
    }
  }

  private bearWallPass(player: Player): void {
    for (const a of this.actors) {
      if (!(a instanceof Bear)) continue;
      if (!a.isBlocking()) continue;
      const pb = player.bounds();
      const ab = a.bounds();
      // Boss is a tall vertical wall — even at jump apex the player can't
      // pass over until the bear is cleared. Wall ceiling is 144 px (4.5
      // tiles) above the bear's bottom — higher than max jump apex (~128 px).
      const wallTop = ab.bottom - 144;
      if (pb.right <= ab.left || pb.left >= ab.right) continue;
      if (pb.bottom < wallTop) continue;
      if (player.x < (ab.left + ab.right) / 2) {
        player.x = ab.left - PLAYER_W / 2 - 0.5;
        if (player.vx > 0) player.vx = 0;
      } else {
        player.x = ab.right + PLAYER_W / 2 + 0.5;
        if (player.vx < 0) player.vx = 0;
      }
    }
  }

  private announceBossClear(): void {
    if (this.bossClearedAnnounced) return;
    for (const a of this.actors) {
      if (a instanceof Bear && a.state === "cleared") {
        this.bossClearedAnnounced = true;
        this.events.onBossCleared?.();
        return;
      }
    }
  }

  // Resolve player vs ride-on platforms. Sets player onto the platform's
  // top edge if landing, applies the platform's per-frame delta as carry.
  private platformPass(player: Player, prevPlayerBottom: number): void {
    const pb = player.bounds();
    for (const a of this.actors) {
      if (a.dead || !a.isPlatform) continue;
      const ab = a.bounds();
      // Horizontal overlap (with small inset so edges don't snap)
      if (pb.right <= ab.left + 2 || pb.left >= ab.right - 2) continue;

      // Whale is its own thing — trampolines instead of carrying.
      if (a instanceof Whale) {
        a.tryTrampoline(player, prevPlayerBottom);
        continue;
      }

      const platformTop = ab.top;
      const wasAbove = prevPlayerBottom <= platformTop + 4;
      const overlapsTop = pb.bottom >= platformTop - 2 && pb.bottom <= platformTop + 8;
      if (!wasAbove || !overlapsTop || player.vy < -1) continue;

      // Snap onto platform
      player.landOnPlatform(platformTop);
      // Carry by platform's frame delta
      player.shiftBy(a.lastDx, a.lastDy, this.level);

      if (a instanceof LilyPad) a.setSinking(true);
    }
  }

  private checkCollisions(player: Player): void {
    const pb = player.bounds();
    for (const a of this.actors) {
      if (a.dead) continue;
      if (a.isPlatform) continue; // platforms don't deal damage
      if (!aabbOverlap(pb, a.bounds())) continue;
      a.onPlayerCollide(player, this.events);
    }
  }

  private cull(): void {
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      if (a.canRemove()) {
        a.destroy();
        this.actors.splice(i, 1);
      }
    }
  }

  destroy(): void {
    for (const a of this.actors) a.destroy();
    this.actors = [];
  }

  private createActor(
    data: ActorData,
    enemyTex: EnemyTextureSet,
    itemTex: ItemTextureSet,
    spawnProjectile: (x: number, y: number, vx: number) => void,
    spawnCoconut: (x: number, y: number) => void,
    taniTex: CharacterTextureSet | undefined,
  ): BaseActor | null {
    const tileCenterX = data.x * TILE + TILE / 2;
    const groundY = data.y * TILE;
    const tileCenterY = data.y * TILE + TILE / 2;
    const platformTex = this.platformTex;
    const bossTex = this.bossTex;

    switch (data.type) {
      case "enemy_crab":
        return new Crab(
          tileCenterX, groundY,
          data.walk_range ?? [data.x - 2, data.x + 2],
          enemyTex.crab,
        );
      case "enemy_starfish":
        return new Starfish(
          tileCenterX, groundY,
          data.jump_interval_ms ?? 1800,
          enemyTex.starfish[0],
        );
      case "enemy_frog": {
        if (!platformTex) return null;
        const facing: -1 | 1 = (data.walk_range && data.walk_range[0] > data.x) ? 1 : -1;
        return new Frog(
          tileCenterX, groundY, enemyTex.frog,
          platformTex.waterDrop[0], facing, spawnProjectile,
        );
      }
      case "platform_log": {
        if (!platformTex) return null;
        return new Log(
          tileCenterX, groundY,
          data.walk_range ?? [data.x - 4, data.x + 4],
          platformTex.log[0],
        );
      }
      case "platform_lily": {
        if (!platformTex) return null;
        return new LilyPad(tileCenterX, groundY, platformTex.lily[0]);
      }
      case "whale": {
        if (!platformTex) return null;
        return new Whale(
          tileCenterX, groundY, platformTex.whale,
          data.jump_interval_ms ?? 2000,
        );
      }
      case "item_shell":
        return new Shell(tileCenterX, tileCenterY, itemTex.shell);
      case "item_heart":
        return new HeartFruit(tileCenterX, tileCenterY, itemTex.heart[0]);
      case "item_banana":
        return new Banana(tileCenterX, tileCenterY, itemTex.banana);
      case "item_pineapple":
        if (!bossTex) return null;
        return new Pineapple(tileCenterX, tileCenterY, bossTex.pineapple);
      case "block_coconut":
        if (!bossTex) return null;
        return new CoconutBlock(tileCenterX, groundY, bossTex.coconutBlock, spawnCoconut);
      case "enemy_bear_boss":
        if (!bossTex) return null;
        return new Bear(tileCenterX, groundY, bossTex.bear);
      case "npc_tani":
        if (!taniTex) return null;
        return new TaniNPC(tileCenterX, groundY, taniTex);
      default:
        return null;
    }
  }
}
