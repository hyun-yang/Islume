"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserSessions } from "@/hooks/useSessions";
import { cancelSession } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAppStore } from "@/stores/appStore";
import type { SessionSummary } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-zinc-100 text-zinc-600",
  awaiting_review: "bg-amber-100 text-amber-700",
  awaiting_owner_confirmation: "bg-amber-100 text-amber-700",
  ended_by_user: "bg-red-100 text-red-600",
  cancelled: "bg-orange-100 text-orange-600",
};

// Sessions that are still running and can therefore be cancelled.
const CANCELLABLE = new Set([
  "active",
  "awaiting_review",
  "awaiting_owner_confirmation",
]);

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[status] ?? "bg-zinc-100 text-zinc-500"}`}>
      {label}
    </span>
  );
}

export default function SessionListPanel() {
  const { data: sessions, isLoading } = useUserSessions();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const queryClient = useQueryClient();
  const t = useT();

  const cancelMutation = useMutation({
    mutationFn: (sessionId: string) => cancelSession(sessionId, selectedUserId!),
    onSuccess: (_result, sessionId) => {
      // If the cancelled chat is the one being viewed, flip it to ended now;
      // the session_ended stream event would do the same, this is just snappy.
      if (sessionId === activeSessionId) setSessionStatus("ended");
      queryClient.invalidateQueries({ queryKey: ["sessions", selectedUserId] });
    },
  });

  const handleSelect = (session: SessionSummary) => {
    setActiveSession(session.session_id);
    if (session.status === "awaiting_review") {
      setSessionStatus("awaiting_review");
    } else if (
      session.status === "completed" ||
      session.status === "ended_by_user" ||
      session.status === "cancelled"
    ) {
      setSessionStatus("ended");
    }
  };

  if (isLoading) {
    return <p className="text-xs text-zinc-400 p-4">{t("session.loadingSessions")}</p>;
  }

  if (!sessions || sessions.length === 0) {
    return <p className="text-xs text-zinc-400 p-4">{t("session.noSessions")}</p>;
  }

  return (
    <div className="p-3">
      <div className="text-xs font-medium text-zinc-500 mb-2">
        {t("session.sessions")} ({sessions.length})
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {sessions.map((s) => {
          const isActive = activeSessionId === s.session_id;
          const canCancel = CANCELLABLE.has(s.status);
          return (
            <div key={s.session_id} className="flex items-stretch gap-1">
              <button
                onClick={() => handleSelect(s)}
                className={`flex-1 text-left p-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-50 border border-indigo-300"
                    : "bg-zinc-50 hover:bg-zinc-100 border border-transparent"
                }`}
              >
                <div className="flex justify-between items-center mb-0.5">
                  <span className="font-medium text-zinc-800 text-xs">
                    {s.partner_name} ({s.partner_agent_name})
                  </span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="text-[11px] text-zinc-500">
                  {s.my_agent_name} {t("session.vs")} {s.partner_agent_name} &middot; {s.turn_count}/{s.max_turns} {t("session.turns")}
                </div>
              </button>
              {canCancel && (
                <button
                  onClick={() => cancelMutation.mutate(s.session_id)}
                  disabled={cancelMutation.isPending}
                  title={t("session.cancelThisConversation")}
                  aria-label={`${t("session.cancelConversationWith")} ${s.partner_name}`}
                  className="px-2 rounded-lg text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
