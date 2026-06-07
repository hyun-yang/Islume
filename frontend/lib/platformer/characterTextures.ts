import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

export type AnimState = "idle" | "run" | "jump" | "fall" | "hurt";

export interface CharacterTextureSet {
  idle: Texture[];     // 1 frame
  run: Texture[];      // 3 frames
  jump: Texture[];     // 1 frame
  fall: Texture[];     // 1 frame
  hurt: Texture[];     // 1 frame
}

export const PLATFORMER_CHAR_FRAME_W = 32;
export const PLATFORMER_CHAR_FRAME_H = 40;

const FW = PLATFORMER_CHAR_FRAME_W;
const FH = PLATFORMER_CHAR_FRAME_H;

// Generate right-facing character textures. Left-facing is the same texture
// rendered with sprite.scale.x = -1.
export function generatePlatformerCharacterTextures(
  renderer: Renderer,
  bodyColor = 0xff7a4e,
): CharacterTextureSet {
  return {
    idle: [makeFrame(renderer, "idle", 0, bodyColor)],
    run: [
      makeFrame(renderer, "run", 0, bodyColor),
      makeFrame(renderer, "run", 1, bodyColor),
      makeFrame(renderer, "run", 2, bodyColor),
    ],
    jump: [makeFrame(renderer, "jump", 0, bodyColor)],
    fall: [makeFrame(renderer, "fall", 0, bodyColor)],
    hurt: [makeFrame(renderer, "hurt", 0, bodyColor)],
  };
}

function makeFrame(
  renderer: Renderer,
  state: AnimState,
  frame: number,
  body: number,
): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const feet = FH - 2;

  let bob = 0;
  let leftLegX = 0, leftLegY = 0, rightLegX = 0, rightLegY = 0;
  let armRaise = 0;

  if (state === "run") {
    bob = frame === 1 ? -1 : 0;
    if (frame === 0) { leftLegX = -3; rightLegX = 3; }
    else if (frame === 2) { leftLegX = 3; rightLegX = -3; }
    armRaise = 2;
  } else if (state === "jump") {
    bob = -1;
    leftLegX = -1; rightLegX = 1;
    leftLegY = -2; rightLegY = -2;
    armRaise = 4;
  } else if (state === "fall") {
    bob = 1;
    leftLegX = -2; rightLegX = 2;
    leftLegY = 1; rightLegY = 1;
    armRaise = -3;
  }

  // Shadow under feet
  g.ellipse(cx, feet, 9, 3).fill({ color: 0x000000, alpha: 0.18 });

  // Legs
  const legColor = 0x3e2a1f;
  g.rect(cx - 5 + leftLegX, feet - 6 + leftLegY, 4, 6).fill(legColor);
  g.rect(cx + 1 + rightLegX, feet - 6 + rightLegY, 4, 6).fill(legColor);

  // Body
  const bodyTop = feet - 22 + bob;
  g.roundRect(cx - 7, bodyTop, 14, 16, 4).fill(body);
  g.rect(cx - 7, bodyTop + 13, 14, 2).fill({ color: 0x000000, alpha: 0.18 });

  // Arms
  g.roundRect(cx - 9, bodyTop + 4, 3, 8 + armRaise, 1.5).fill(body);
  g.roundRect(cx + 6, bodyTop + 4, 3, 8 - armRaise, 1.5).fill(body);

  // Head
  const headY = bodyTop - 7;
  g.circle(cx, headY, 8).fill(0xffd1a8);
  // Sun hat
  g.ellipse(cx, headY - 4, 12, 2).fill(0xffeb3b);
  g.ellipse(cx, headY - 5, 6, 3).fill(0xfdd835);
  // Eyes
  if (state === "hurt") {
    g.rect(cx + 2, headY - 1, 3, 1).fill(0x333333);
    g.rect(cx + 5, headY + 1, 3, 1).fill(0x333333);
  } else {
    g.circle(cx + 3, headY - 0.5, 1.5).fill(0x222222);
    g.circle(cx + 6, headY - 0.5, 1.5).fill(0x222222);
  }

  const texture = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}
