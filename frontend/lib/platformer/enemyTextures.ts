import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";

const PLATFORMER_ENEMY_FRAME_W = 32;
const PLATFORMER_ENEMY_FRAME_H = 32;

const FW = PLATFORMER_ENEMY_FRAME_W;
const FH = PLATFORMER_ENEMY_FRAME_H;

export interface EnemyTextureSet {
  crab: Texture[];        // 2 walk frames
  starfish: Texture[];    // 1 frame
  frog: Texture[];        // 3 frames: idle, blink, mouth-open
}

export function generatePlatformerEnemyTextures(renderer: Renderer): EnemyTextureSet {
  return {
    crab: [drawCrab(renderer, 0), drawCrab(renderer, 1)],
    starfish: [drawStarfish(renderer)],
    frog: [drawFrog(renderer, "idle"), drawFrog(renderer, "blink"), drawFrog(renderer, "spit")],
  };
}

function drawCrab(renderer: Renderer, frame: number): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const feet = FH - 2;
  const phase = frame === 0 ? 1 : -1;

  // 3 legs per side, alternating phase
  const legColor = 0xc1331a;
  for (let i = 0; i < 3; i++) {
    const dx = -10 + i * 4;
    const ph = i % 2 === 0 ? 0 : phase;
    g.rect(cx + dx, feet - 5 + ph, 2, 5).fill(legColor);
    g.rect(cx - dx - 2, feet - 5 - ph, 2, 5).fill(legColor);
  }

  // Body
  g.ellipse(cx, feet - 9, 12, 7).fill(0xe04830);
  g.ellipse(cx, feet - 10, 10, 5).fill(0xff6b4e);

  // Claws
  g.circle(cx - 13, feet - 9, 4).fill(0xe04830);
  g.circle(cx + 13, feet - 9, 4).fill(0xe04830);
  g.rect(cx - 16, feet - 11, 6, 2).fill(0xff6b4e);
  g.rect(cx + 10, feet - 11, 6, 2).fill(0xff6b4e);

  // Eyes on stalks
  g.rect(cx - 4, feet - 17, 1, 4).fill(0xe04830);
  g.rect(cx + 3, feet - 17, 1, 4).fill(0xe04830);
  g.circle(cx - 4, feet - 18, 2).fill(0xffffff);
  g.circle(cx + 4, feet - 18, 2).fill(0xffffff);
  g.circle(cx - 4, feet - 18, 1).fill(0x222222);
  g.circle(cx + 4, feet - 18, 1).fill(0x222222);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}

function drawFrog(renderer: Renderer, state: "idle" | "blink" | "spit"): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const feet = FH - 2;

  // Body
  g.ellipse(cx, feet - 8, 14, 9).fill(0x4caf50);
  g.ellipse(cx, feet - 9, 12, 6).fill(0x6fc973);
  // Belly
  g.ellipse(cx, feet - 6, 8, 4).fill(0xfff59d);

  // Legs
  g.roundRect(cx - 12, feet - 5, 5, 4, 2).fill(0x4caf50);
  g.roundRect(cx + 7, feet - 5, 5, 4, 2).fill(0x4caf50);

  // Eyes (bumps on top of head)
  const eyeY = feet - 16;
  g.circle(cx - 5, eyeY, 4).fill(0x4caf50);
  g.circle(cx + 5, eyeY, 4).fill(0x4caf50);
  if (state === "blink") {
    g.rect(cx - 7, eyeY, 4, 1).fill(0x222222);
    g.rect(cx + 3, eyeY, 4, 1).fill(0x222222);
  } else {
    g.circle(cx - 5, eyeY, 2.5).fill(0xffffff);
    g.circle(cx + 5, eyeY, 2.5).fill(0xffffff);
    g.circle(cx - 5, eyeY, 1.4).fill(0x222222);
    g.circle(cx + 5, eyeY, 1.4).fill(0x222222);
  }

  // Mouth
  if (state === "spit") {
    g.ellipse(cx, feet - 9, 5, 3).fill(0x222222);
    g.circle(cx + 2, feet - 9, 1.5).fill(0x81d4fa);
  } else {
    g.rect(cx - 4, feet - 9, 8, 1).fill(0x224422);
  }

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}

function drawStarfish(renderer: Renderer): Texture {
  const g = new Graphics();
  const cx = FW / 2;
  const cy = FH / 2 + 4;

  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 12 : 5;
    pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  g.poly(pts).fill(0xffa550);
  g.circle(cx, cy, 4).fill(0xffd17a);
  g.circle(cx - 3, cy, 1.2).fill(0x333333);
  g.circle(cx + 3, cy, 1.2).fill(0x333333);
  g.rect(cx - 2, cy + 3, 4, 1).fill(0x333333);

  const texture = renderer.generateTexture({
    target: g, frame: new Rectangle(0, 0, FW, FH),
  });
  g.destroy();
  return texture;
}
