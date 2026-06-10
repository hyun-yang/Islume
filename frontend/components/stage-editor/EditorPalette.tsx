"use client";

import { useT } from "@/lib/i18n";
import {
  PALETTE_TILES, PALETTE_ACTORS, tileThumbKey, actorThumbKey,
  type EditorTool,
} from "./palette";

interface Props {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  /** dataURL thumbnails keyed by tileThumbKey/actorThumbKey; may be empty while loading. */
  thumbs: Record<string, string>;
}

function PaletteButton({
  selected, label, thumb, fallback, onClick,
}: {
  selected: boolean;
  label: string;
  thumb?: string;
  fallback: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl shrink-0 border-2 transition-colors ${
        selected
          ? "border-amber-400 bg-zinc-700"
          : "border-transparent bg-zinc-800 hover:bg-zinc-700"
      }`}
    >
      {thumb ? (
        // Runtime-extracted Pixi texture, not a static asset
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt={label} className="max-w-9 max-h-9 [image-rendering:pixelated]" />
      ) : (
        <span>{fallback}</span>
      )}
    </button>
  );
}

export default function EditorPalette({ tool, onToolChange, thumbs }: Props) {
  const t = useT();

  return (
    <div className="w-40 shrink-0 bg-zinc-900 border-r border-zinc-700 overflow-y-auto p-3 space-y-4">
      <div>
        <div className="text-xs font-semibold text-zinc-400 uppercase mb-2">
          {t("editor.section.tools")}
        </div>
        <div className="flex flex-wrap gap-2">
          <PaletteButton
            selected={tool.kind === "spawn"}
            label={t("editor.tool.spawn")}
            fallback="🚩"
            onClick={() => onToolChange({ kind: "spawn" })}
          />
          <PaletteButton
            selected={tool.kind === "goal"}
            label={t("editor.tool.goal")}
            fallback="🏁"
            onClick={() => onToolChange({ kind: "goal" })}
          />
          <PaletteButton
            selected={tool.kind === "eraser"}
            label={t("editor.tool.eraser")}
            fallback="🧹"
            onClick={() => onToolChange({ kind: "eraser" })}
          />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-zinc-400 uppercase mb-2">
          {t("editor.section.tiles")}
        </div>
        <div className="flex flex-wrap gap-2">
          {PALETTE_TILES.map(({ tile, labelKey }) => (
            <PaletteButton
              key={tile}
              selected={tool.kind === "tile" && tool.tile === tile}
              label={t(labelKey)}
              thumb={thumbs[tileThumbKey(tile)]}
              fallback="▦"
              onClick={() => onToolChange({ kind: "tile", tile })}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-zinc-400 uppercase mb-2">
          {t("editor.section.actors")}
        </div>
        <div className="flex flex-wrap gap-2">
          {PALETTE_ACTORS.map(({ type, labelKey }) => (
            <PaletteButton
              key={type}
              selected={tool.kind === "actor" && tool.actorType === type}
              label={t(labelKey)}
              thumb={thumbs[actorThumbKey(type)]}
              fallback="👾"
              onClick={() => onToolChange({ kind: "actor", actorType: type })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
