"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { useSessionStream } from "@/hooks/useSessionStream";
import { useSessionTurns } from "@/hooks/useSession";
import { cancelSession, respondToAffinity } from "@/lib/api";
import { useT } from "@/lib/i18n";
import ToolCallCard from "@/components/session/ToolCallCard";
import type { ConversationTurn, ToolCallEventPayload } from "@/lib/types";

type TimelineItem =
  | { kind: "turn"; turnNumber: number; turn: ReturnType<typeof useAppStore.getState>["conversationTurns"][number] }
  | { kind: "tool_call"; turnNumber: number; payload: ToolCallEventPayload };

export default function ConversationViewer() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionStatus = useAppStore((s) => s.sessionStatus);
  const conversationTurns = useAppStore((s) => s.conversationTurns);
  const toolCallEvents = useAppStore((s) => s.toolCallEvents);
  const dealFinalized = useAppStore((s) => s.dealFinalized);
  const affinityCheck = useAppStore((s) => s.affinityCheck);
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const clearSession = useAppStore((s) => s.clearSession);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const setAffinityCheck = useAppStore((s) => s.setAffinityCheck);

  const t = useT();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useSessionStream(activeSessionId);

  // Durable history (Postgres) + live turns (WS store), merged and deduped by
  // turn number. The WS replay is empty for a finished session whose Redis
  // stream was cleared (e.g. on restart); Postgres always has the turns, so the
  // conversation stays viewable. Live turns override history of the same number.
  const { data: historyTurns } = useSessionTurns(activeSessionId);
  const mergedTurns = useMemo<ConversationTurn[]>(() => {
    const byNumber = new Map<number, ConversationTurn>();
    for (const t of historyTurns ?? []) byNumber.set(t.turnNumber, t);
    for (const t of conversationTurns) byNumber.set(t.turnNumber, t);
    return Array.from(byNumber.values()).sort(
      (a, b) => a.turnNumber - b.turnNumber,
    );
  }, [historyTurns, conversationTurns]);

  // The conversation lives at the bottom of a long single-scroll sidebar, below
  // wallet/profile/agent/control/session panels. Picking a session loads its
  // turns correctly, but they render below the fold and look "empty" — so pull
  // the panel into view whenever the selected session changes.
  useEffect(() => {
    if (activeSessionId && rootRef.current) {
      rootRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSessionId]);

  // Cancellable = the conversation is still running (active or paused for a
  // review/owner-confirmation). Ended/completed sessions can't be cancelled.
  const canCancel =
    sessionStatus === "active" ||
    sessionStatus === "awaiting_review" ||
    sessionStatus === "awaiting_owner_confirmation";

  const cancelMutation = useMutation({
    mutationFn: () => cancelSession(activeSessionId!, selectedUserId!),
    onSuccess: () => {
      setSessionStatus("ended");
      setAffinityCheck(null);
      queryClient.invalidateQueries({ queryKey: ["sessions", selectedUserId] });
    },
  });

  // Merge turns + tool_call events into one ordered timeline. Tool calls land
  // immediately AFTER their turn (same turn_number, but pushed last).
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = mergedTurns.map((t) => ({
      kind: "turn" as const,
      turnNumber: t.turnNumber,
      turn: t,
    }));
    for (const e of toolCallEvents) {
      items.push({
        kind: "tool_call" as const,
        // status events without a turn number anchor to the latest turn we've seen
        turnNumber:
          mergedTurns.length > 0
            ? mergedTurns[mergedTurns.length - 1].turnNumber
            : 0,
        payload: e,
      });
    }
    return items;
  }, [mergedTurns, toolCallEvents]);

  const affinityMutation = useMutation({
    mutationFn: (action: "continue" | "end") =>
      respondToAffinity(activeSessionId!, selectedUserId!, action),
    onSuccess: (result) => {
      if (result.status === "resumed") {
        setSessionStatus("active");
        setAffinityCheck(null);
      } else if (result.status === "ended") {
        setSessionStatus("ended");
        setAffinityCheck(null);
      }
      // "waiting" — keep showing the card
    },
  });

  // Auto-scroll on new turns
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedTurns, affinityCheck]);

  // Track first speaker for alternating colors
  const firstSpeaker = mergedTurns[0]?.speakerAgentId ?? null;

  return (
    <div ref={rootRef} className="flex flex-col max-h-[60vh]">
      <div className="px-4 py-2 border-b border-zinc-200 flex items-center justify-between shrink-0">
        <span className="text-xs font-medium text-zinc-700">{t("session.conversation")}</span>
        {canCancel && (
          <button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-50"
          >
            {cancelMutation.isPending ? t("session.cancelling") : t("session.cancelConversation")}
          </button>
        )}
        {sessionStatus === "ended" && (
          <button
            onClick={clearSession}
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            {t("common.close")}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {timeline.map((item, idx) => {
          if (item.kind === "turn") {
            const turn = item.turn;
            const isA = turn.speakerAgentId === firstSpeaker;
            return (
              <div
                key={`turn-${turn.turnNumber}`}
                className={`p-3 rounded-lg ${
                  isA
                    ? "bg-emerald-50 border-l-3 border-emerald-700"
                    : "bg-pink-50 border-l-3 border-pink-700"
                }`}
              >
                <div
                  className={`text-xs font-semibold mb-1 ${
                    isA ? "text-emerald-700" : "text-pink-700"
                  }`}
                >
                  {turn.speakerName} &middot; {t("session.turn")} {turn.turnNumber}
                  {turn.modelUsed && (
                    <span className="text-zinc-400 font-normal ml-1">[{turn.modelUsed}]</span>
                  )}
                </div>
                {turn.content && (
                  <div className="text-sm text-zinc-800 leading-relaxed">
                    {turn.content}
                  </div>
                )}
              </div>
            );
          }
          // tool_call card
          return (
            <ToolCallCard
              key={`tc-${item.payload.tool_call_id}-${idx}`}
              payload={item.payload}
            />
          );
        })}

        {/* Deal finalized card */}
        {dealFinalized && (
          <div className="p-4 rounded-lg bg-emerald-50 border-2 border-emerald-400">
            <div className="text-xs uppercase tracking-wide text-emerald-700 mb-1">
              🤝 {t("session.dealFinalized")}
            </div>
            <div className="text-sm font-semibold text-emerald-900">
              {dealFinalized.summary}
            </div>
            {dealFinalized.item_name && (
              <div className="text-xs text-zinc-600 mt-1">
                {dealFinalized.item_name} · {dealFinalized.amount}{" "}
                {dealFinalized.currency}
              </div>
            )}
          </div>
        )}

        {/* Awaiting-owner-confirmation hint */}
        {sessionStatus === "awaiting_owner_confirmation" && (
          <div className="text-xs text-amber-700 text-center py-2 font-medium">
            {t("session.waitingOwnerApproval")}
          </div>
        )}

        {/* Affinity check card */}
        {affinityCheck && sessionStatus === "awaiting_review" && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 space-y-3">
            <div className="text-xs font-semibold text-amber-700">
              {t("session.affinityCheck")}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold text-amber-700">
                {affinityCheck.score}
              </div>
              <div className="text-sm text-zinc-600">
                {affinityCheck.summary}
              </div>
            </div>
            <div className="text-xs text-zinc-500">
              {t("session.llmRecommends")}{" "}
              <span className="font-medium">
                {affinityCheck.recommendation}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => affinityMutation.mutate("continue")}
                disabled={affinityMutation.isPending}
                className="flex-1 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("session.continue")}
              </button>
              <button
                onClick={() => affinityMutation.mutate("end")}
                disabled={affinityMutation.isPending}
                className="flex-1 py-2 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-50"
              >
                {t("session.endConversation")}
              </button>
            </div>
          </div>
        )}

        {sessionStatus === "active" && mergedTurns.length > 0 && !affinityCheck && (
          <div className="text-xs text-zinc-400 text-center py-2">
            {t("session.waitingNextTurn")}
          </div>
        )}

        {sessionStatus === "ended" && (
          <div className="text-xs text-amber-600 text-center py-2 font-medium">
            {t("session.sessionEnded")}
          </div>
        )}
      </div>
    </div>
  );
}
