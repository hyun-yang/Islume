import {
  Container,
  RenderTexture,
  Sprite,
  type Renderer,
  type Texture,
} from "pixi.js";

// PixiJS-standard atlas (TexturePacker "hash" format) frame entry.
interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: number; h: number };
  sourceSize: { w: number; h: number };
}

export interface AtlasJson {
  frames: Record<string, AtlasFrame>;
  meta: {
    image: string;
    format: "RGBA8888";
    size: { w: number; h: number };
    scale: "1";
  };
}

interface PackOptions {
  imageName: string;
  columns?: number;
  padding?: number;
}

interface PackedResult {
  png: Blob;
  atlas: AtlasJson;
  previewCanvas: HTMLCanvasElement;
}

/**
 * Compose `textures` into one packed sprite-sheet RenderTexture, extract it as
 * a PNG blob, and build a matching atlas JSON. Layout is row-major with a
 * fixed column count and per-row variable height (so 32x32 tiles and 64x56
 * bears can share an atlas without wasted space).
 */
export async function packAndExtract(
  renderer: Renderer,
  textures: Record<string, Texture>,
  options: PackOptions,
): Promise<PackedResult> {
  const columns = options.columns ?? 8;
  const padding = options.padding ?? 2;

  const entries = Object.entries(textures);
  if (entries.length === 0) {
    throw new Error(`packAndExtract: no textures to pack for ${options.imageName}`);
  }

  // Row-major layout: pack `columns` per row. Row height = max height in row.
  type Placement = { name: string; texture: Texture; x: number; y: number };
  const placements: Placement[] = [];
  let cursorX = padding;
  let cursorY = padding;
  let rowMaxH = 0;
  let totalW = 0;
  let totalH = 0;
  let colInRow = 0;

  for (const [name, texture] of entries) {
    if (colInRow === columns) {
      cursorX = padding;
      cursorY += rowMaxH + padding;
      rowMaxH = 0;
      colInRow = 0;
    }
    placements.push({ name, texture, x: cursorX, y: cursorY });
    cursorX += texture.width + padding;
    rowMaxH = Math.max(rowMaxH, texture.height);
    totalW = Math.max(totalW, cursorX);
    totalH = Math.max(totalH, cursorY + rowMaxH + padding);
    colInRow++;
  }

  const rt = RenderTexture.create({ width: totalW, height: totalH });
  const stage = new Container();
  for (const p of placements) {
    const sprite = new Sprite(p.texture);
    sprite.position.set(p.x, p.y);
    stage.addChild(sprite);
  }

  // clear: true gives transparent background, preserving alpha of source textures.
  renderer.render({ container: stage, target: rt, clear: true });

  const canvas = renderer.extract.canvas(rt) as HTMLCanvasElement;
  const png = await canvasToBlob(canvas);

  stage.destroy({ children: true });
  rt.destroy(true);

  const frames: Record<string, AtlasFrame> = {};
  for (const p of placements) {
    const w = p.texture.width;
    const h = p.texture.height;
    frames[p.name] = {
      frame: { x: p.x, y: p.y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
    };
  }

  const atlas: AtlasJson = {
    frames,
    meta: {
      image: options.imageName,
      format: "RGBA8888",
      size: { w: totalW, h: totalH },
      scale: "1",
    },
  };

  return { png, atlas, previewCanvas: canvas };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser actually completes the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}
