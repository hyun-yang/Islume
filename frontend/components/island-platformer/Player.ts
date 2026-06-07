import { Container, Sprite, type Texture } from "pixi.js";
import { type LevelMap, TILE_PF_SIZE } from "@/lib/platformer/types";
import {
  type CharacterTextureSet,
  type AnimState,
} from "@/lib/platformer/characterTextures";
import { KeyboardInput } from "./input/KeyboardInput";
import { moveX, moveY, bodyAABB, type AABB } from "./Physics";
import { sound } from "@/lib/platformer/audio";

export const PLAYER_W = 22;
export const PLAYER_H = 36;

const GRAVITY = 1800;        // px/s²
const MAX_FALL = 720;
const RUN_ACCEL = 1400;
const RUN_MAX = 220;
const RUN_FRICTION = 1200;
const JUMP_VELOCITY = -680;
const JUMP_CUT = 0.45;
const COYOTE_TIME = 0.09;     // sec
const JUMP_BUFFER = 0.10;
const RUN_FRAME_TIME = 0.10;
const STOMP_BOUNCE_VY = -380;
const HURT_KNOCKBACK_VY = -300;
const HURT_KNOCKBACK_VX = 200;
const I_FRAME = 1.2;          // sec invincibility after damage
const RESPAWN_I_FRAME = 1.5;

export class Player {
  // Bottom-center coordinates (pixels).
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  facing: -1 | 1 = 1;
  grounded = false;
  state: AnimState = "idle";
  hp = 3;
  iframeTimer = 0;
  boostTimer = 0;            // banana: speed/jump bonus while > 0
  invincibilityTimer = 0;    // pineapple: smash enemies on touch while > 0
  controlsLocked = false;

  private coyote = 0;
  private buffer = 0;
  private animTime = 0;
  private textures: CharacterTextureSet;

  sprite: Sprite;
  container: Container;

  constructor(spawnPxX: number, spawnPxY: number, textures: CharacterTextureSet) {
    this.x = spawnPxX;
    this.y = spawnPxY;
    this.textures = textures;
    this.sprite = new Sprite(textures.idle[0]);
    this.sprite.anchor.set(0.5, 1);
    this.container = new Container();
    this.container.label = "player";
    this.container.zIndex = 1000;
    this.container.addChild(this.sprite);
    this.syncSprite();
  }

  respawn(spawnPxX: number, spawnPxY: number): void {
    this.x = spawnPxX;
    this.y = spawnPxY;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.iframeTimer = RESPAWN_I_FRAME;
    this.state = "idle";
    this.coyote = 0;
    this.buffer = 0;
    this.controlsLocked = false;
  }

  // Returns true if damage was applied (false = i-frame absorbed).
  damage(): boolean {
    if (this.iframeTimer > 0) return false;
    this.hp = Math.max(0, this.hp - 1);
    this.iframeTimer = I_FRAME;
    this.vy = HURT_KNOCKBACK_VY;
    this.vx = -this.facing * HURT_KNOCKBACK_VX;
    return true;
  }

  heal(): void {
    this.hp = Math.min(3, this.hp + 1);
  }

  stompBounce(): void {
    this.vy = STOMP_BOUNCE_VY;
    this.grounded = false;
  }

  isInvincible(): boolean {
    return this.iframeTimer > 0;
  }

  // Hazard / scripted death — bypass i-frames.
  kill(): void {
    this.hp = 0;
    this.iframeTimer = 0;
  }

  applyBoost(seconds: number): void {
    if (seconds > this.boostTimer) this.boostTimer = seconds;
  }

  applyInvincibility(seconds: number): void {
    if (seconds > this.invincibilityTimer) this.invincibilityTimer = seconds;
  }

  isBoosted(): boolean { return this.boostTimer > 0; }
  canSmashEnemies(): boolean { return this.invincibilityTimer > 0; }

  // Snap to the top of a moving platform (lily/log) and treat as grounded.
  landOnPlatform(topY: number): void {
    this.y = topY - 0.01;
    if (this.vy > 0) this.vy = 0;
    this.grounded = true;
    this.coyote = 0;
  }

  // External motion (carry from a moving platform). Collision-aware.
  shiftBy(dx: number, dy: number, level: LevelMap): void {
    if (dx !== 0) moveX(this, dx, level, PLAYER_W, PLAYER_H);
    if (dy !== 0) moveY(this, dy, level, PLAYER_W, PLAYER_H);
  }

  // Trampoline (whale): hard upward kick.
  trampoline(vy: number): void {
    this.vy = vy;
    this.grounded = false;
  }

  update(dt: number, level: LevelMap, input: KeyboardInput): void {
    if (this.controlsLocked) {
      input = lockedInputProxy;
    }

    const speedMul = this.boostTimer > 0 ? 1.5 : 1;
    const jumpMul  = this.boostTimer > 0 ? 1.15 : 1;
    const maxSpeed = RUN_MAX * speedMul;

    // Horizontal input
    let dir = 0;
    if (input.left) dir -= 1;
    if (input.right) dir += 1;
    if (dir !== 0) {
      this.facing = dir > 0 ? 1 : -1;
      this.vx += dir * RUN_ACCEL * speedMul * dt;
      if (this.vx > maxSpeed) this.vx = maxSpeed;
      if (this.vx < -maxSpeed) this.vx = -maxSpeed;
    } else {
      const f = RUN_FRICTION * dt;
      if (this.vx > 0) this.vx = Math.max(0, this.vx - f);
      else if (this.vx < 0) this.vx = Math.min(0, this.vx + f);
    }

    // Jump
    if (input.consumeJumpPressed()) this.buffer = JUMP_BUFFER;
    if (this.buffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vy = JUMP_VELOCITY * jumpMul;
      this.buffer = 0;
      this.coyote = 0;
      this.grounded = false;
      sound.jump();
    }
    if (input.consumeJumpReleased() && this.vy < 0) this.vy *= JUMP_CUT;

    // Gravity
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    // Move (per-axis sweep)
    if (moveX(this, this.vx * dt, level, PLAYER_W, PLAYER_H)) {
      this.vx = 0;
    }
    const wasGrounded = this.grounded;
    this.grounded = false;
    if (moveY(this, this.vy * dt, level, PLAYER_W, PLAYER_H)) {
      if (this.vy > 0) this.grounded = true;
      this.vy = 0;
    }

    if (wasGrounded && !this.grounded && this.coyote <= 0) {
      this.coyote = COYOTE_TIME;
    }
    if (this.coyote > 0) this.coyote -= dt;
    if (this.buffer > 0) this.buffer -= dt;
    if (this.iframeTimer > 0) this.iframeTimer -= dt;
    if (this.boostTimer > 0) this.boostTimer -= dt;
    if (this.invincibilityTimer > 0) this.invincibilityTimer -= dt;

    // Animation state
    if (!this.grounded) {
      this.state = this.vy < 0 ? "jump" : "fall";
    } else if (Math.abs(this.vx) > 8) {
      this.state = "run";
    } else {
      this.state = "idle";
    }

    this.animTime += dt;
    this.syncSprite();
  }

  private syncSprite(): void {
    let frames: Texture[];
    switch (this.state) {
      case "run":  frames = this.textures.run; break;
      case "jump": frames = this.textures.jump; break;
      case "fall": frames = this.textures.fall; break;
      case "hurt": frames = this.textures.hurt; break;
      default:     frames = this.textures.idle;
    }
    const idx = frames.length > 1
      ? Math.floor(this.animTime / RUN_FRAME_TIME) % frames.length
      : 0;
    this.sprite.texture = frames[idx];
    this.sprite.scale.x = this.facing === 1 ? 1 : -1;
    this.sprite.x = this.x;
    this.sprite.y = this.y;
    let alpha = 1;
    if (this.iframeTimer > 0 && Math.floor(this.iframeTimer * 20) % 2 === 0) alpha = 0.45;
    this.sprite.alpha = alpha;
    // Pineapple invincibility: rainbow tint cycling
    if (this.invincibilityTimer > 0) {
      const hue = (this.animTime * 6) % 1;
      const r = Math.floor(255 * Math.abs(Math.sin(hue * Math.PI * 2)));
      const g = Math.floor(255 * Math.abs(Math.sin((hue + 0.33) * Math.PI * 2)));
      const b = Math.floor(255 * Math.abs(Math.sin((hue + 0.67) * Math.PI * 2)));
      this.sprite.tint = (r << 16) | (g << 8) | b;
    } else {
      this.sprite.tint = 0xffffff;
    }
  }

  bounds(): AABB {
    return bodyAABB(this, PLAYER_W, PLAYER_H);
  }

  // Convenience: bottom-center tile coords (for goal/checkpoint queries)
  tileX(): number { return Math.floor(this.x / TILE_PF_SIZE); }
  tileY(): number { return Math.floor((this.y - 0.01) / TILE_PF_SIZE); }

  // Swap the texture set live (e.g. A/B between Graphics-generated and PNG atlas).
  // Frame indices stay in sync because both sets share the same shape.
  applyTextures(set: CharacterTextureSet): void {
    this.textures = set;
    this.syncSprite();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// A KeyboardInput that always reports zero (used while controls are locked).
const lockedInputProxy = ((): KeyboardInput => {
  const k = new KeyboardInput();
  k.setEnabled(false);
  // Override consume methods to always return false; setEnabled(false) already
  // forces left/right/jumpHeld to false.
  k.consumeJumpPressed = () => false;
  k.consumeJumpReleased = () => false;
  return k;
})();
