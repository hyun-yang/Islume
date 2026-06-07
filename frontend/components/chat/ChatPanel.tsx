"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useChatRooms, useCreateChatRoom, useChatMessages } from "@/hooks/useChat";
import { getWsBaseUrl } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import type { ChatRoomResponse } from "@/lib/types";

interface ChatMsg {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

/** Display name of the other party in a (direct) room, from the server-supplied
 *  member_names map. Falls back to a short id when a name is missing. */
function otherMemberName(
  room: ChatRoomResponse,
  selfId: string | null,
): string {
  const otherId = room.members.find((m) => m !== selfId);
  if (!otherId) return room.name || "Direct Chat";
  return room.member_names?.[otherId] || otherId.substring(0, 8) + "...";
}

export default function ChatPanel() {
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const chatTarget = useAppStore((s) => s.chatTarget);
  const closeChat = useAppStore((s) => s.closeChat);
  const clearUnread = useAppStore((s) => s.clearUnread);
  const unreadByRoom = useAppStore((s) => s.unreadByRoom);
  const { data: rooms, isLoading } = useChatRooms();
  const createRoom = useCreateChatRoom();
  const t = useT();

  const [activeRoom, setActiveRoom] = useState<ChatRoomResponse | null>(null);

  // A chat target was picked (single-click on the map) → find-or-create the 1:1
  // room and open it. The backend dedupes, so this never spawns duplicates.
  useEffect(() => {
    if (!chatTarget || !selectedUserId) return;
    createRoom.mutate(
      { memberIds: [selectedUserId, chatTarget.userId], roomType: "direct" },
      { onSuccess: (room) => setActiveRoom(room) },
    );
    // createRoom.mutate is stable; re-run only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTarget, selectedUserId]);

  const handleBack = () => {
    setActiveRoom(null);
    closeChat();
  };

  if (activeRoom) {
    const title =
      chatTarget?.userName ?? otherMemberName(activeRoom, selectedUserId);
    return <ChatRoom room={activeRoom} title={title} onBack={handleBack} />;
  }

  // Resolving a freshly-picked target into a room — brief loading state.
  if (chatTarget) {
    return (
      <div className="p-4 text-sm text-zinc-400">
        {t("chat.openingChatWith")} {chatTarget.userName}...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{t("chat.chats")}</span>
      </div>

      {/* Conversation list (inbox) */}
      {isLoading ? (
        <div className="text-sm text-zinc-400">{t("common.loading")}</div>
      ) : rooms && rooms.length > 0 ? (
        rooms.map((room) => {
          const unread = unreadByRoom[room.id] ?? 0;
          return (
            <button
              key={room.id}
              onClick={() => {
                clearUnread(room.id);
                setActiveRoom(room);
              }}
              className="w-full text-left p-3 border border-zinc-200 rounded-lg hover:bg-zinc-50 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {otherMemberName(room, selectedUserId)}
                </div>
                <div className="text-xs text-zinc-400">
                  {room.room_type} &middot; {room.members.length} {t("chat.members")}
                </div>
              </div>
              {unread > 0 && (
                <span className="shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-blue-600 text-white text-xs font-medium">
                  {unread}
                </span>
              )}
            </button>
          );
        })
      ) : (
        <div className="text-xs text-zinc-400">
          {t("chat.noChatsYet")}
        </div>
      )}
    </div>
  );
}

function ChatRoom({
  room,
  title,
  onBack,
}: {
  room: ChatRoomResponse;
  title: string;
  onBack: () => void;
}) {
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const setOpenRoom = useAppStore((s) => s.setOpenRoom);
  const clearUnread = useAppStore((s) => s.clearUnread);
  const t = useT();
  const { data: initialMessages } = useChatMessages(room.id);
  const [liveMessages, setLiveMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef(new Set<string>());

  // Mark this room as open so incoming-message handlers skip its unread badge,
  // and clear any backlog the moment it's opened.
  useEffect(() => {
    setOpenRoom(room.id);
    clearUnread(room.id);
    return () => setOpenRoom(null);
  }, [room.id, setOpenRoom, clearUnread]);

  // Derive full message list from initial (REST) + live (WS)
  const messages = useMemo(() => {
    const base: ChatMsg[] = (initialMessages ?? []).map((m) => ({
      id: m.id,
      sender_id: m.sender_id,
      sender_name: m.sender_name || t("chat.unknown"),
      content: m.content,
      created_at: m.created_at,
    }));
    const baseIds = new Set(base.map((m) => m.id));
    return [...base, ...liveMessages.filter((m) => !baseIds.has(m.id))];
  }, [initialMessages, liveMessages, t]);

  // Connect WebSocket for live messages
  useEffect(() => {
    const baseUrl = getWsBaseUrl();
    const ws = new WebSocket(`${baseUrl}/ws/chat/${room.id}`);

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.event_type === "message" && !seenIdsRef.current.has(data.id)) {
        seenIdsRef.current.add(data.id);
        setLiveMessages((prev) => [...prev, {
          id: data.id,
          sender_id: data.sender_id,
          sender_name: data.sender_name,
          content: data.content,
          created_at: data.created_at,
        }]);
      }
    };

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [room.id]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !wsRef.current || !selectedUserId) return;
    wsRef.current.send(
      JSON.stringify({ sender_id: selectedUserId, content: input.trim() }),
    );
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-zinc-200 flex items-center gap-2">
        <button onClick={onBack} className="text-xs text-zinc-400 hover:text-zinc-600">
          &larr; {t("common.back")}
        </button>
        <span className="text-xs font-medium text-zinc-700">{title}</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg) => {
          const isSelf = msg.sender_id === selectedUserId;
          return (
            <div
              key={msg.id}
              className={`p-2 rounded-lg max-w-[80%] ${
                isSelf
                  ? "bg-blue-50 ml-auto border-r-3 border-blue-500"
                  : "bg-zinc-100 border-l-3 border-zinc-400"
              }`}
            >
              <div className="text-xs text-zinc-500 mb-0.5">
                {isSelf ? t("common.you") : msg.sender_name}
              </div>
              <div className="text-sm">{msg.content}</div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-zinc-200 flex gap-2">
        <input
          className="flex-1 px-3 py-1.5 border border-zinc-300 rounded text-sm"
          placeholder={t("chat.typeMessage")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button
          onClick={handleSend}
          className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          {t("common.send")}
        </button>
      </div>
    </div>
  );
}
