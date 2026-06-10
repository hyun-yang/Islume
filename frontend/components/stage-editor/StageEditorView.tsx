"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";
import {
  useIslandStages,
  useSaveIslandStage,
  usePublishIslandStage,
  useUnpublishIslandStage,
  useDeleteIslandStage,
} from "@/hooks/useIslandStages";
import { validateLevel } from "@/lib/platformer/levelValidation";
import { TILE_PF_GROUND } from "@/lib/platformer/types";

import {
  EditorModel, newDefaultLevel, levelFromStageData,
  EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH,
} from "./editorState";
import type { EditorTool } from "./palette";
import EditorCanvas from "./EditorCanvas";
import EditorPalette from "./EditorPalette";

const SLOTS = [1, 2, 3] as const;

export default function StageEditorView() {
  const t = useT();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const setViewMode = useAppStore((s) => s.setViewMode);

  const stagesQuery = useIslandStages(selectedUserId);
  const save = useSaveIslandStage(selectedUserId);
  const publish = usePublishIslandStage(selectedUserId);
  const unpublish = useUnpublishIslandStage(selectedUserId);
  const deleteStage = useDeleteIslandStage(selectedUserId);

  const [slot, setSlot] = useState<number>(1);
  const [model, setModel] = useState<EditorModel | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [tool, setTool] = useState<EditorTool>({ kind: "tile", tile: TILE_PF_GROUND });
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const loadedSlotRef = useRef<number | null>(null);

  const stages = stagesQuery.data?.stages;
  const stage = stages?.find((s) => s.slot === slot);
  const defaultName = `${t("editor.defaultName")} ${slot}`;

  // Build the model when the slot changes (or on first data arrival). Saves
  // refetch the query, but loadedSlotRef keeps edits from being clobbered.
  useEffect(() => {
    if (!stages || loadedSlotRef.current === slot) return;
    const s = stages.find((st) => st.slot === slot);
    const level = s
      ? levelFromStageData(s.name, s.level_data)
      : newDefaultLevel(`${t("editor.defaultName")} ${slot}`);
    setModel(new EditorModel(level));
    setName(s?.name ?? `${t("editor.defaultName")} ${slot}`);
    setDirty(false);
    setVersion((v) => v + 1);
    loadedSlotRef.current = slot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, stages]);

  const markMutated = useCallback(() => {
    setVersion((v) => v + 1);
    setDirty(true);
  }, []);

  // Ctrl/Cmd+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !model) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        if (model.undo()) markMutated();
        e.preventDefault();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        if (model.redo()) markMutated();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [model, markMutated]);

  const validation = useMemo(() => {
    if (!model) return { ok: false, errors: [] as string[] };
    return validateLevel(model.toStageLevelData());
    // version drives recomputation after any model mutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, version]);

  const confirmDiscard = () =>
    !dirty || window.confirm(t("editor.discardConfirm"));

  const handleSlotSelect = (s: number) => {
    if (s === slot || !confirmDiscard()) return;
    setSlot(s);
  };

  const handleExit = () => {
    if (!confirmDiscard()) return;
    setViewMode("world");
  };

  const handleSave = () => {
    if (!model || !validation.ok || save.isPending) return;
    const finalName = name.trim() || defaultName;
    model.level.name = finalName;
    save.mutate(
      { slot, name: finalName, levelData: model.toStageLevelData() },
      { onSuccess: () => setDirty(false) },
    );
  };

  const handleDelete = () => {
    setConfirmingDelete(false);
    deleteStage.mutate(slot, {
      onSuccess: () => {
        const level = newDefaultLevel(defaultName);
        setModel(new EditorModel(level));
        setName(defaultName);
        setDirty(false);
        setVersion((v) => v + 1);
      },
    });
  };

  const handleResize = (newWidth: number) => {
    if (!model) return;
    if (model.resizeWidth(newWidth)) markMutated();
  };

  const mutationError =
    save.error?.message ?? publish.error?.message ??
    unpublish.error?.message ?? deleteStage.error?.message;

  const canPublish =
    !!stage && stage.cleared && !dirty && stage.status !== "published";

  if (!selectedUserId) return null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-700 shrink-0">
        <button
          onClick={handleExit}
          className="px-3 py-1.5 rounded bg-zinc-700 text-sm font-semibold hover:bg-zinc-600"
        >
          ← {t("editor.exit")}
        </button>

        <div className="flex items-center gap-1 ml-2">
          {SLOTS.map((s) => {
            const st = stages?.find((x) => x.slot === s);
            return (
              <button
                key={s}
                onClick={() => handleSlotSelect(s)}
                className={`px-3 py-1.5 rounded text-sm font-semibold border ${
                  s === slot
                    ? "bg-amber-500 text-zinc-900 border-amber-400"
                    : "bg-zinc-800 border-zinc-600 hover:bg-zinc-700"
                }`}
              >
                {s}
                {st && (
                  <span className="ml-1 text-xs">
                    {st.status === "published" ? "🟢" : st.cleared ? "⭐" : "📝"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setDirty(true); }}
          maxLength={64}
          placeholder={defaultName}
          className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm w-44"
        />

        <div className="flex items-center gap-1 text-sm">
          <span className="text-zinc-400">{t("editor.width")}</span>
          <button
            onClick={() => handleResize((model?.level.width ?? 64) - 10)}
            className="px-2 py-1 rounded bg-zinc-800 border border-zinc-600 hover:bg-zinc-700"
          >−</button>
          <span className="w-9 text-center tabular-nums">{model?.level.width ?? "–"}</span>
          <button
            onClick={() => handleResize((model?.level.width ?? 64) + 10)}
            className="px-2 py-1 rounded bg-zinc-800 border border-zinc-600 hover:bg-zinc-700"
          >+</button>
          <span className="text-zinc-500 text-xs">({EDITOR_MIN_WIDTH}–{EDITOR_MAX_WIDTH})</span>
        </div>

        <select
          value={model?.level.background ?? "beach"}
          onChange={(e) => {
            model?.setBackground(e.target.value as "beach" | "stream" | "forest");
            markMutated();
          }}
          className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm"
        >
          <option value="beach">{t("editor.bg.beach")}</option>
          <option value="stream">{t("editor.bg.stream")}</option>
          <option value="forest">{t("editor.bg.forest")}</option>
        </select>

        <div className="flex items-center gap-1">
          <button
            onClick={() => { if (model?.undo()) markMutated(); }}
            disabled={!model?.canUndo}
            title="Ctrl+Z"
            className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm hover:bg-zinc-700 disabled:opacity-40"
          >↩</button>
          <button
            onClick={() => { if (model?.redo()) markMutated(); }}
            disabled={!model?.canRedo}
            title="Ctrl+Y"
            className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm hover:bg-zinc-700 disabled:opacity-40"
          >↪</button>
        </div>

        <div className="flex-1" />

        {dirty && <span className="text-xs text-amber-400">{t("editor.unsaved")}</span>}

        <button
          onClick={handleSave}
          disabled={!validation.ok || save.isPending}
          className="px-3 py-1.5 rounded bg-emerald-600 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
        >
          {save.isPending ? t("common.saving") : t("editor.save")}
        </button>
        <button
          disabled
          title={t("editor.testSoon")}
          className="px-3 py-1.5 rounded bg-sky-700 text-sm font-semibold opacity-40 cursor-not-allowed"
        >
          ▶ {t("editor.test")}
        </button>
        {stage?.status === "published" ? (
          <button
            onClick={() => unpublish.mutate(slot)}
            disabled={unpublish.isPending}
            className="px-3 py-1.5 rounded bg-zinc-700 text-sm font-semibold hover:bg-zinc-600 disabled:opacity-40"
          >
            {t("editor.unpublish")}
          </button>
        ) : (
          <button
            onClick={() => publish.mutate(slot)}
            disabled={!canPublish || publish.isPending}
            title={!canPublish ? t("editor.clearToPublish") : undefined}
            className="px-3 py-1.5 rounded bg-amber-500 text-zinc-900 text-sm font-semibold hover:bg-amber-400 disabled:opacity-40"
          >
            {t("editor.publish")}
          </button>
        )}
        <button
          onClick={() => setConfirmingDelete(true)}
          disabled={!stage || deleteStage.isPending}
          className="px-3 py-1.5 rounded bg-rose-700 text-sm font-semibold hover:bg-rose-600 disabled:opacity-40"
        >
          {t("editor.delete")}
        </button>
      </div>

      {/* Validation / mutation feedback */}
      {(validation.errors.length > 0 || mutationError) && (
        <div className="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 text-xs space-x-3 shrink-0">
          {validation.errors.map((key) => (
            <span key={key} className="text-rose-400">⚠ {t(key)}</span>
          ))}
          {mutationError && <span className="text-rose-300">⚠ {mutationError}</span>}
        </div>
      )}

      {/* Workspace */}
      <div className="flex flex-1 min-h-0">
        <EditorPalette tool={tool} onToolChange={setTool} thumbs={thumbs} />
        <div className="flex-1 relative">
          {model ? (
            <EditorCanvas
              model={model}
              version={version}
              tool={tool}
              onMutate={markMutated}
              onThumbnails={setThumbs}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
              {t("editor.loading")}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-600 p-6 max-w-sm w-[90%] text-center">
            <div className="text-lg font-bold mb-2">{t("editor.deleteConfirmTitle")}</div>
            <div className="text-sm text-zinc-300 mb-5">{t("editor.deleteConfirmBody")}</div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg bg-rose-600 font-bold hover:bg-rose-500"
              >
                {t("editor.delete")}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-4 py-2 rounded-lg bg-zinc-700 font-bold hover:bg-zinc-600"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
