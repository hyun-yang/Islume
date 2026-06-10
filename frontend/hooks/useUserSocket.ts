"use client";

import { useEffect, useRef } from "react";
import type { Hand, Outcome } from "@/lib/visit/rps";

interface IncomingVisitEvent {
  visitId: string;
  visitorId: string;
  visitorName: string;
}

interface VisitArrivedEvent {
  visitId: string;
  visitorId: string;
  visitorName: string;
}

interface VisitEndedEvent {
  visitId: string;
}

interface DmReceivedEvent {
  visitId: string;
  senderId: string;
  senderName: string;
  preview: string;
}

interface RpsInviteEvent {
  visitId: string;
  roundId: string;
  wagerAmount: number;
  initiatorId: string;
  visitorId: string;
  hostId: string;
  visitorName: string;
  hostName: string;
}

interface RpsRevealEvent {
  visitId: string;
  roundId: string;
  visitorPick: Hand;
  hostPick: Hand;
  outcome: Outcome;
  winnerId?: string;
  balanceAfter?: number;
}

interface RpsCancelledEvent {
  visitId: string;
  roundId: string;
  reason: string;
  cancelledBy?: string;
}

interface PendingConfirmationEvent {
  toolCallId: string;
  plugin: string;
  toolName: string;
  sessionId: string;
  summary: string;
}

interface ChatReceivedEvent {
  roomId: string;
  senderId: string;
  senderName: string;
  preview: string;
}

interface EvaluationReadyEvent {
  sessionId: string;
  trigger: string;
  turnNumber: number;
  score: number;
  summary: string;
}

export interface UseUserSocketCallbacks {
  onIncomingVisit?: (e: IncomingVisitEvent) => void;
  onVisitArrived?: (e: VisitArrivedEvent) => void;
  onVisitEnded?: (e: VisitEndedEvent) => void;
  onDmReceived?: (e: DmReceivedEvent) => void;
  onRpsInvite?: (e: RpsInviteEvent) => void;
  onRpsReveal?: (e: RpsRevealEvent) => void;
  onRpsCancelled?: (e: RpsCancelledEvent) => void;
  onPendingConfirmation?: (e: PendingConfirmationEvent) => void;
  onChatReceived?: (e: ChatReceivedEvent) => void;
  onEvaluationReady?: (e: EvaluationReadyEvent) => void;
}

/**
 * Connects the logged-in user to their personal notification channel.
 * Receive-only — no client→server messages on this socket.
 */
export function useUserSocket(
  userId: string | null,
  callbacks: UseUserSocketCallbacks,
): void {
  const handlersRef = useRef(callbacks);
  useEffect(() => {
    handlersRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    if (!userId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.hostname}:8002/ws/user/${userId}`;
    const ws = new WebSocket(url);

    ws.onmessage = (ev) => {
      let msg: { type: string; data: Record<string, unknown> };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const h = handlersRef.current;
      const d = msg.data ?? {};
      const str = (k: string) => String(d[k] ?? "");
      switch (msg.type) {
        case "connected":
          return;
        case "visit:incoming":
          h.onIncomingVisit?.({
            visitId: str("visit_id"),
            visitorId: str("visitor_id"),
            visitorName: str("visitor_name"),
          });
          break;
        case "visit:arrived":
          h.onVisitArrived?.({
            visitId: str("visit_id"),
            visitorId: str("visitor_id"),
            visitorName: str("visitor_name"),
          });
          break;
        case "visit:ended":
          h.onVisitEnded?.({ visitId: str("visit_id") });
          break;
        case "dm:received":
          h.onDmReceived?.({
            visitId: str("visit_id"),
            senderId: str("sender_id"),
            senderName: str("sender_name"),
            preview: str("preview"),
          });
          break;
        case "rps:invite":
          h.onRpsInvite?.({
            visitId: str("visit_id"),
            roundId: str("round_id"),
            wagerAmount: Number(d.wager_amount ?? 0),
            initiatorId: str("initiator_id"),
            visitorId: str("visitor_id"),
            hostId: str("host_id"),
            visitorName: str("visitor_name"),
            hostName: str("host_name"),
          });
          break;
        case "rps:reveal": {
          const balanceAfter = d.balance_after !== undefined && d.balance_after !== null
            ? Number(d.balance_after)
            : undefined;
          h.onRpsReveal?.({
            visitId: str("visit_id"),
            roundId: str("round_id"),
            visitorPick: str("visitor_pick") as Hand,
            hostPick: str("host_pick") as Hand,
            outcome: str("outcome") as Outcome,
            winnerId: d.winner_id ? String(d.winner_id) : undefined,
            balanceAfter,
          });
          break;
        }
        case "rps:cancelled":
          h.onRpsCancelled?.({
            visitId: str("visit_id"),
            roundId: str("round_id"),
            reason: str("reason"),
            cancelledBy: d.cancelled_by ? String(d.cancelled_by) : undefined,
          });
          break;
        case "deal:pending_confirmation":
          h.onPendingConfirmation?.({
            toolCallId: str("tool_call_id"),
            plugin: str("plugin"),
            toolName: str("tool_name"),
            sessionId: str("session_id"),
            summary: str("summary"),
          });
          break;
        case "chat:received":
          h.onChatReceived?.({
            roomId: str("room_id"),
            senderId: str("sender_id"),
            senderName: str("sender_name"),
            preview: str("preview"),
          });
          break;
        case "evaluation:ready":
          h.onEvaluationReady?.({
            sessionId: str("session_id"),
            trigger: str("trigger"),
            turnNumber: Number(d.turn_number ?? 0),
            score: Number(d.score ?? 0),
            summary: str("summary"),
          });
          break;
      }
    };

    return () => {
      try { ws.close(); } catch { /* ignore */ }
    };
  }, [userId]);
}
