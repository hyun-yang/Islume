"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlugins } from "@/lib/api";
import type { AttachedPlugin, BarteringPolicy } from "@/lib/types";
import BarteringPolicyForm, {
  BARTERING_EMPTY_POLICY,
} from "./BarteringPolicyForm";
import { useT } from "@/lib/i18n";

interface Props {
  value: AttachedPlugin[];
  onChange: (next: AttachedPlugin[]) => void;
}

function findEntry(list: AttachedPlugin[], id: string): AttachedPlugin | undefined {
  return list.find((e) => e.plugin === id);
}

export default function AgentPluginsSection({ value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(value.length > 0);
  const { data: plugins, isPending, error } = useQuery({
    queryKey: ["plugins"],
    queryFn: fetchPlugins,
  });

  useEffect(() => {
    if (value.length > 0) setOpen(true);
  }, [value.length]);

  const toggle = (pluginId: string) => {
    const existing = findEntry(value, pluginId);
    if (existing) {
      onChange(value.filter((e) => e.plugin !== pluginId));
    } else {
      // Bartering is the only plugin with a typed form today.
      const emptyPolicy =
        pluginId === "bartering" ? BARTERING_EMPTY_POLICY : {};
      onChange([
        ...value,
        { plugin: pluginId, policy: { ...emptyPolicy } as Record<string, unknown> },
      ]);
    }
  };

  const updatePolicy = (pluginId: string, nextPolicy: Record<string, unknown>) => {
    onChange(
      value.map((e) =>
        e.plugin === pluginId ? { ...e, policy: nextPolicy } : e,
      ),
    );
  };

  return (
    <div className="border-t border-zinc-200 pt-3 mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-xs font-semibold text-zinc-700 hover:text-zinc-900"
      >
        <span>🧩 {t("plugin.plugins")} {value.length > 0 && <span className="text-zinc-400 font-normal">({value.length})</span>}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {isPending && (
            <div className="text-xs text-zinc-400">{t("plugin.loading")}</div>
          )}
          {error && (
            <div className="text-xs text-red-600">{t("plugin.loadError")}</div>
          )}
          {plugins?.map((p) => {
            const attached = findEntry(value, p.id);
            return (
              <div key={p.id} className="rounded border border-zinc-200 p-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(attached)}
                    onChange={() => toggle(p.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-zinc-800">{p.id}</div>
                    <div className="text-[11px] text-zinc-500">{p.description}</div>
                  </div>
                </label>
                {attached && p.id === "bartering" && (
                  <div className="mt-2 pl-5">
                    <BarteringPolicyForm
                      value={attached.policy as unknown as BarteringPolicy}
                      onChange={(next) =>
                        updatePolicy(p.id, next as unknown as Record<string, unknown>)
                      }
                    />
                  </div>
                )}
                {attached && p.id !== "bartering" && (
                  <div className="mt-2 pl-5 text-xs text-zinc-500">
                    {t("plugin.noForm")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
