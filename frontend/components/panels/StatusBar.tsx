"use client";

import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";

export default function StatusBar() {
  const t = useT();
  const selectedUserName = useAppStore((s) => s.selectedUserName);
  const userPosition = useAppStore((s) => s.userPosition);
  const sessionStatus = useAppStore((s) => s.sessionStatus);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  if (!selectedUserName) return null;

  return (
    <div className="px-4 py-3 border-b border-zinc-200 text-xs text-zinc-500 space-y-1">
      <div>
        <span className="font-medium text-zinc-700">{selectedUserName}</span>
      </div>
      {userPosition && (
        <div>
          {t("status.position")}: {userPosition.latitude.toFixed(4)},{" "}
          {userPosition.longitude.toFixed(4)}
        </div>
      )}
      {sessionStatus !== "none" && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                sessionStatus === "active"
                  ? "bg-emerald-500"
                  : sessionStatus === "ended"
                    ? "bg-zinc-400"
                    : "bg-amber-500"
              }`}
            />
            {t("status.session")}: {sessionStatus}
          </div>
          {activeSessionId && (
            <button
              onClick={() => navigator.clipboard.writeText(activeSessionId)}
              className="text-zinc-400 hover:text-zinc-600 font-mono text-[10px] break-all text-left cursor-pointer"
              title={t("status.clickToCopy")}
            >
              {activeSessionId}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
