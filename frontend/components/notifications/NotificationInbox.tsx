"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { fetchNotifications, markNotificationsRead } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { useT } from "@/lib/i18n";

const TYPE_LABEL_KEYS: Record<string, string> = {
  "deal:pending_confirmation": "inbox.pendingConfirmation",
  "deal:expired": "inbox.dealExpired",
  "evaluation:ready": "inbox.evaluationReady",
};

function summarize(n: NotificationItem): string {
  const p = n.payload;
  if (typeof p.summary === "string" && p.summary) return p.summary;
  if (typeof p.tool_name === "string" && p.tool_name) {
    return `${p.plugin ?? ""} · ${p.tool_name}`;
  }
  return "";
}

export default function NotificationInbox() {
  const t = useT();
  const queryClient = useQueryClient();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", selectedUserId],
    queryFn: () => fetchNotifications(selectedUserId!),
    enabled: !!selectedUserId,
    refetchInterval: 30_000,
  });

  if (!selectedUserId) return null;

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      await markNotificationsRead(selectedUserId);
      queryClient.invalidateQueries({ queryKey: ["notifications", selectedUserId] });
    }
  };

  const openSession = (n: NotificationItem) => {
    if (n.session_id) {
      setActiveSession(n.session_id);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-zinc-100 transition-colors"
        title={t("inbox.title")}
      >
        <span className="text-base">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-[70] w-80 max-h-96 overflow-y-auto bg-white rounded-xl shadow-2xl border border-zinc-200">
          <div className="px-4 py-2.5 border-b border-zinc-200 font-semibold text-sm text-zinc-800">
            {t("inbox.title")}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-400 text-center">
              {t("inbox.empty")}
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => openSession(n)}
                className={`w-full text-left px-4 py-2.5 border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                  n.read_at ? "" : "bg-sky-50/60"
                } ${n.session_id ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-700">
                    {t(TYPE_LABEL_KEYS[n.type] ?? "inbox.notification")}
                  </span>
                  <span className="text-[10px] text-zinc-400 shrink-0">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                {summarize(n) && (
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">
                    {summarize(n)}
                  </div>
                )}
                {n.session_id && (
                  <div className="text-[10px] text-sky-600 mt-0.5">
                    {t("inbox.openConversation")}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
