"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { respondToToolCall } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function PendingConfirmationToast() {
  const t = useT();
  const pending = useAppStore((s) => s.pendingConfirmations);
  const dismiss = useAppStore((s) => s.dismissPendingConfirmation);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  if (pending.length === 0 || !selectedUserId) return null;

  const respond = async (
    sessionId: string,
    toolCallId: string,
    action: "approve" | "reject",
  ) => {
    setBusyIds((prev) => new Set(prev).add(toolCallId));
    try {
      await respondToToolCall(sessionId, toolCallId, selectedUserId, action);
    } finally {
      dismiss(toolCallId);
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(toolCallId);
        return next;
      });
    }
  };

  return (
    <div className="fixed top-24 right-4 z-[60] pointer-events-auto space-y-2 max-w-sm">
      {pending.map((n) => {
        const busy = busyIds.has(n.tool_call_id);
        return (
          <div
            key={n.tool_call_id}
            className="bg-gradient-to-b from-amber-50 to-amber-100 rounded-xl shadow-2xl border-2 border-amber-400 p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🤝</span>
              <div className="font-bold text-amber-900">{t("notif.agentNeedsApproval")}</div>
            </div>
            <div className="text-xs text-zinc-500 mb-1">
              {n.plugin} · {n.tool_name}
            </div>
            <div className="text-sm text-zinc-700 mb-3">{n.summary}</div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => respond(n.session_id, n.tool_call_id, "reject")}
                disabled={busy}
                className="px-3 py-1.5 rounded-md bg-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-300 disabled:opacity-50"
              >
                {t("notif.reject")}
              </button>
              <button
                onClick={() => respond(n.session_id, n.tool_call_id, "approve")}
                disabled={busy}
                className="px-3 py-1.5 rounded-md bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-50"
              >
                {t("notif.approve")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
