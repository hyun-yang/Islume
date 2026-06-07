"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { DMMessage } from "@/lib/types";

interface VisitSocketEvent {
  type: string;
  data: Record<string, unknown>;
}

interface Move3DData {
  x: number;
  y: number;
  z?: number;
  rot_y?: number;
  anim?: string;
}

interface BlockChange {
  x: number;
  y: number;
  z: number;
  block: number;
}

export interface UseVisitSocketOptions {
  visitId: string | null;
  onConnected?: (data: Record<string, unknown>) => void;
  onMove?: (x: number, y: number) => void;
  onMove3D?: (data: Move3DData) => void;
  onArrive?: () => void;
  onLeave?: () => void;
  onMessage?: (msg: DMMessage) => void;
  onTyping?: (senderId: string, isTyping: boolean) => void;
  onBlockUpdate?: (changes: BlockChange[]) => void;
}

export interface VisitSocket {
  connected: boolean;
  send: (event: VisitSocketEvent) => void;
  sendMove: (x: number, y: number) => void;
  sendMove3D: (x: number, y: number, z: number, rotY: number, anim?: string) => void;
  sendArrive: () => void;
  sendLeave: () => void;
  sendMessage: (senderId: string, content: string) => void;
  sendTyping: (senderId: string, isTyping: boolean) => void;
  sendBlockUpdate: (changes: BlockChange[]) => void;
}

export function useVisitSocket(opts: UseVisitSocketOptions): VisitSocket {
  const { visitId } = opts;
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(opts);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    handlersRef.current = opts;
  }, [opts]);

  useEffect(() => {
    if (!visitId) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // Gateway WS runs on port 8002 directly (Next rewrites don't proxy WS)
    const url = `${proto}://${window.location.hostname}:8002/ws/visit/${visitId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as VisitSocketEvent;
        const { type, data } = msg;
        const h = handlersRef.current;
        if (type === "connected") {
          h.onConnected?.(data);
        } else if (type === "visit:move") {
          const x = Number(data.x);
          const y = Number(data.y);
          if (!Number.isNaN(x) && !Number.isNaN(y)) h.onMove?.(x, y);
          if (h.onMove3D) {
            h.onMove3D({
              x,
              y,
              z: data.z !== undefined ? Number(data.z) : undefined,
              rot_y: data.rot_y !== undefined ? Number(data.rot_y) : undefined,
              anim: data.anim !== undefined ? String(data.anim) : undefined,
            });
          }
        } else if (type === "visit:arrive") {
          h.onArrive?.();
        } else if (type === "visit:leave") {
          h.onLeave?.();
        } else if (type === "dm:message") {
          h.onMessage?.({
            id: String(data.id ?? ""),
            visit_session_id: String(data.visit_session_id ?? visitId),
            sender_id: String(data.sender_id ?? ""),
            sender_name: String(data.sender_name ?? ""),
            content: String(data.content ?? ""),
            created_at: String(data.created_at ?? ""),
          });
        } else if (type === "island:block_update") {
          try {
            const changes = typeof data.changes === "string"
              ? JSON.parse(data.changes as string)
              : data.changes;
            if (Array.isArray(changes)) h.onBlockUpdate?.(changes);
          } catch { /* ignore parse errors */ }
        } else if (type === "dm:typing") {
          h.onTyping?.(
            String(data.sender_id ?? ""),
            String(data.is_typing) === "1" || data.is_typing === true,
          );
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [visitId]);

  const send = useCallback((event: VisitSocketEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  }, []);

  const sendMove = useCallback(
    (x: number, y: number) => send({ type: "visit:move", data: { x, y } }),
    [send],
  );
  const sendMove3D = useCallback(
    (x: number, y: number, z: number, rotY: number, anim?: string) =>
      send({ type: "visit:move", data: { x, y, z, rot_y: rotY, anim: anim ?? "idle" } }),
    [send],
  );
  const sendArrive = useCallback(
    () => send({ type: "visit:arrive", data: {} }),
    [send],
  );
  const sendLeave = useCallback(
    () => send({ type: "visit:leave", data: {} }),
    [send],
  );
  const sendMessage = useCallback(
    (senderId: string, content: string) =>
      send({ type: "dm:message", data: { sender_id: senderId, content } }),
    [send],
  );
  const sendTyping = useCallback(
    (senderId: string, isTyping: boolean) =>
      send({
        type: "dm:typing",
        data: { sender_id: senderId, is_typing: isTyping },
      }),
    [send],
  );
  const sendBlockUpdate = useCallback(
    (changes: BlockChange[]) =>
      send({ type: "island:block_update", data: { changes } }),
    [send],
  );

  return useMemo(
    () => ({
      connected,
      send,
      sendMove,
      sendMove3D,
      sendArrive,
      sendLeave,
      sendMessage,
      sendTyping,
      sendBlockUpdate,
    }),
    [connected, send, sendMove, sendMove3D, sendArrive, sendLeave, sendMessage, sendTyping, sendBlockUpdate],
  );
}
