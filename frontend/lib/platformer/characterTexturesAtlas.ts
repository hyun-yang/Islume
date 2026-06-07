import { Assets, Rectangle, Texture } from "pixi.js";
import type { CharacterTextureSet } from "./characterTextures";

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}
interface AtlasJson {
  frames: Record<string, AtlasFrame>;
  meta: { image: string; size: { w: number; h: number } };
}

// Load a packed character spritesheet (TexturePacker JSON Hash format) and
// produce a CharacterTextureSet shaped identically to the runtime Graphics
// generator in characterTextures.ts. Caller can swap a Player's textures via
// Player.applyTextures() with the returned set.
export async function loadPlatformerCharacterTexturesFromAtlas(
  pngUrl = "/sprites/characters_v2.png",
  jsonUrl = "/sprites/characters_v2.json",
): Promise<CharacterTextureSet> {
  const [baseTexture, atlasJson] = await Promise.all([
    Assets.load<Texture>(pngUrl),
    fetch(jsonUrl).then((r) => r.json() as Promise<AtlasJson>),
  ]);

  const source = baseTexture.source;
  source.scaleMode = "nearest";

  const sub = (name: string): Texture => {
    const f = atlasJson.frames[name];
    if (!f) throw new Error(`Atlas frame '${name}' missing in ${jsonUrl}`);
    return new Texture({
      source,
      frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h),
    });
  };

  return {
    idle: [sub("idle-0")],
    run:  [sub("run-0"), sub("run-1"), sub("run-2")],
    jump: [sub("jump-0")],
    fall: [sub("fall-0")],
    hurt: [sub("hurt-0")],
  };
}
