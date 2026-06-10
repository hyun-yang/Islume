"use client";

import { useEffect, useRef } from "react";
import { SessionWebSocket } from "@/lib/ws";
import { useAppStore } from "@/stores/appStore";
import type {
  DealFinalizedPayload,
  ToolCallEventPayload,
} from "@/lib/types";

export function useSessionStream(sessionId: string | null) {
  const wsRef = useRef<SessionWebSocket | null>(null);
  const addTurn = useAppStore((s) => s.addConversationTurn);
  const setSessionStatus = useAppStore((s) => s.setSessionStatus);
  const setAffinityCheck = useAppStore((s) => s.setAffinityCheck);
  const setFinalEvaluation = useAppStore((s) => s.setFinalEvaluation);
  const upsertToolCallEvent = useAppStore((s) => s.upsertToolCallEvent);
  const setDealFinalized = useAppStore((s) => s.setDealFinalized);

  useEffect(() => {
    if (!sessionId) return;

    const ws = new SessionWebSocket(
      sessionId,
      (event) => {
        if (event.event_type === "turn") {
          addTurn({
            turnNumber: event.turn_number,
            speakerAgentId: event.speaker_agent_id,
            speakerName: event.speaker_name,
            content: event.content,
            modelUsed: event.model_used,
          });
        } else if (event.event_type === "tool_call") {
          try {
            const payload: ToolCallEventPayload = JSON.parse(event.content);
            upsertToolCallEvent(payload);
            if (payload.status === "pending") {
              setSessionStatus("awaiting_owner_confirmation");
            } else if (payload.status === "user_confirmed") {
              setSessionStatus("active");
            }
          } catch {
            // malformed payload — ignore
          }
        } else if (event.event_type === "deal_finalized") {
          try {
            const payload: DealFinalizedPayload = JSON.parse(event.content);
            setDealFinalized(payload);
          } catch {
            // ignore parse errors
          }
        } else if (event.event_type === "affinity_check") {
          try {
            const data = JSON.parse(event.content);
            setAffinityCheck(data);
            setSessionStatus("awaiting_review");
          } catch {
            // ignore parse errors
          }
        } else if (event.event_type === "final_evaluation") {
          // Content-free marker — each owner fetches their private evaluation
          // via REST (the shared stream must not carry private verdicts).
          try {
            const data = JSON.parse(event.content);
            setFinalEvaluation({
              reason: data.reason ?? "max_turns",
              turnNumber: data.turn_number ?? null,
            });
            if (data.reason === "max_turns") setSessionStatus("awaiting_review");
          } catch {
            // ignore parse errors
          }
        } else if (event.event_type === "session_ended") {
          setSessionStatus("ended");
        }
      },
      (status) => {
        if (status === "connected") setSessionStatus("active");
        if (status === "ended") setSessionStatus("ended");
      },
    );

    ws.connect();
    wsRef.current = ws;

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [
    sessionId,
    addTurn,
    setSessionStatus,
    setAffinityCheck,
    setFinalEvaluation,
    upsertToolCallEvent,
    setDealFinalized,
  ]);
}
