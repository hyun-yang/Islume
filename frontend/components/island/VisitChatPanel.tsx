"use client";

import { useEffect, useRef, useState } from "react";
import type { DMMessage } from "@/lib/types";
import type { VisitSocket } from "@/hooks/useVisitSocket";
import { useT } from "@/lib/i18n";

interface Props {
  senderId: string;
  socket: VisitSocket;
  locked: boolean;
  messages: DMMessage[];
  typingPeers: Set<string>;
  onPlayGame?: () => void;
}

export default function VisitChatPanel({
  senderId,
  socket,
  locked,
  messages,
  typingPeers,
  onPlayGame,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!locked) setOpen(true);
  }, [locked]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !senderId || locked) return;
    socket.sendMessage(senderId, text);
    setInput("");
    socket.sendTyping(senderId, false);
  };

  const handleInputChange = (v: string) => {
    setInput(v);
    if (!senderId) return;
    socket.sendTyping(senderId, v.length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.sendTyping(senderId, false);
    }, 2000);
  };

  const visibleTyping = Array.from(typingPeers).filter((p) => p && p !== senderId);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => !locked && setOpen(true)}
          disabled={locked}
          title={locked ? t("visit.findHouseToUnlock") : t("visit.openChat")}
          className={`absolute bottom-4 right-4 px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
            locked
              ? "bg-zinc-700/70 text-zinc-300 cursor-not-allowed"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {locked ? `💬 ${t("visit.chatLocked")}` : `💬 ${t("visit.chat")}`}
        </button>
      )}

      {open && (
        <div className="absolute bottom-4 right-4 w-[340px] h-[400px] bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 bg-zinc-50">
            <div className="text-sm font-semibold text-zinc-800">{t("visit.directChat")}</div>
            <div className="flex items-center gap-2">
              {onPlayGame && !locked && (
                <button
                  onClick={onPlayGame}
                  title={t("visit.playRps")}
                  aria-label={t("visit.playGame")}
                  className="text-base hover:text-indigo-700 leading-none"
                >
                  🎮
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-900 text-lg leading-none"
                aria-label={t("common.close")}
              >
                ×
              </button>
            </div>
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
            {locked ? (
              <div className="text-center text-sm text-zinc-500 mt-8">
                {t("visit.chatUnlocksAtHouse")}
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center text-sm text-zinc-400 mt-8">
                {t("visit.sayHello")}
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === senderId;
                return (
                  <div
                    key={m.id}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                        mine
                          ? "bg-emerald-600 text-white"
                          : "bg-zinc-200 text-zinc-900"
                      }`}
                    >
                      {!mine && (
                        <div className="text-[11px] opacity-70 mb-0.5">
                          {m.sender_name}
                        </div>
                      )}
                      {m.content}
                    </div>
                  </div>
                );
              })
            )}
            {visibleTyping.length > 0 && !locked && (
              <div className="text-xs text-zinc-500 italic">{t("visit.typing")}</div>
            )}
          </div>
          <div className="border-t border-zinc-200 p-2 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={locked}
              placeholder={locked ? t("visit.chatIsLocked") : t("visit.typeMessage")}
              className="flex-1 px-3 py-1.5 text-sm border border-zinc-300 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-600 disabled:bg-zinc-100 disabled:text-zinc-400"
            />
            <button
              onClick={handleSend}
              disabled={locked || !input.trim()}
              className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("common.send")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
