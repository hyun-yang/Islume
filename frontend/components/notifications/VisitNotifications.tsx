"use client";

import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";

const TOAST_TTL_MS = 6000;

const KIND_STYLES: Record<string, { bg: string; icon: string }> = {
  incoming: { bg: "from-amber-200 to-orange-200 border-amber-400 text-amber-900", icon: "🌴" },
  arrived:  { bg: "from-emerald-200 to-teal-200 border-emerald-400 text-emerald-900", icon: "🏠" },
  ended:    { bg: "from-zinc-200 to-zinc-300 border-zinc-400 text-zinc-700", icon: "👋" },
  dm:       { bg: "from-sky-200 to-indigo-200 border-sky-400 text-sky-900", icon: "💬" },
  chat:     { bg: "from-blue-200 to-cyan-200 border-blue-400 text-blue-900", icon: "✉️" },
};

function describe(
  toast: { kind: string; visitorName?: string; preview?: string },
  t: (key: string) => string,
): string {
  const who = toast.visitorName ?? t("notif.someone");
  switch (toast.kind) {
    case "incoming": return `${who} ${t("notif.exploringYourIsland")}`;
    case "arrived":  return `${who} ${t("notif.arrivedAtCabin")}`;
    case "ended":    return t("notif.visitEnded");
    case "dm":       return `${who}: ${toast.preview ?? ""}`;
    case "chat":     return `${who}: ${toast.preview ?? ""}`;
    default:         return "";
  }
}

export default function VisitNotifications() {
  const t = useT();
  const toasts = useAppStore((s) => s.visitToasts);
  const dismiss = useAppStore((s) => s.dismissVisitToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => dismiss(toast.id), TOAST_TTL_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const style = KIND_STYLES[toast.kind] ?? KIND_STYLES.incoming;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto bg-gradient-to-r ${style.bg} rounded-xl shadow-lg border-2 px-4 py-2 max-w-sm flex items-center gap-3 animate-in slide-in-from-right`}
          >
            <span className="text-2xl">{style.icon}</span>
            <div className="flex-1 text-sm font-medium">{describe(toast, t)}</div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-zinc-600 hover:text-zinc-900 text-lg leading-none"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
