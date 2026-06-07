"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useVisitSocket } from "@/hooks/useVisitSocket";
import { fetchVisitMessages } from "@/lib/api";
import type { DMMessage } from "@/lib/types";
import VisitChatPanel from "@/components/island/VisitChatPanel";

export default function HostChatContainer() {
  const host = useAppStore((s) => s.hostActiveVisit);
  const hostId = useAppStore((s) => s.selectedUserId);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [typingPeers, setTypingPeers] = useState<Set<string>>(new Set());
  const seenIdsRef = useRef<Set<string>>(new Set());

  const socket = useVisitSocket({
    visitId: host?.visitId ?? null,
    onMessage: (m) => {
      if (seenIdsRef.current.has(m.id)) return;
      seenIdsRef.current.add(m.id);
      setMessages((prev) => [...prev, m]);
    },
    onTyping: (sender, isTyping) => {
      setTypingPeers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(sender);
        else next.delete(sender);
        return next;
      });
    },
    // Lifecycle is owned by user-channel onVisitEnded; do not mutate store here.
    onLeave: () => {},
  });

  // visitId change → reset all in-memory state, then fetch history.
  useEffect(() => {
    setMessages([]);
    setTypingPeers(new Set());
    seenIdsRef.current = new Set();

    if (!host?.visitId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchVisitMessages(host.visitId);
        if (cancelled) return;
        // Merge with anything live-received during the fetch (rare but possible).
        setMessages((prev) => {
          const merged = [...res.messages];
          for (const m of res.messages) seenIdsRef.current.add(m.id);
          for (const m of prev) {
            if (!seenIdsRef.current.has(m.id)) {
              merged.push(m);
              seenIdsRef.current.add(m.id);
            }
          }
          merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
          return merged;
        });
      } catch (e) {
        console.warn("[HostChat] history fetch failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host?.visitId]);

  if (!host || !hostId) return null;

  return (
    <VisitChatPanel
      socket={socket}
      senderId={hostId}
      locked={false}
      messages={messages}
      typingPeers={typingPeers}
    />
  );
}
