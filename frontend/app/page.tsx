"use client";

import IslumeMap from "@/components/map/IslumeMap";
import UserSelector from "@/components/panels/UserSelector";
import ProfilePanel from "@/components/panels/ProfilePanel";
import AgentPanel from "@/components/panels/AgentPanel";
import ControlPanel from "@/components/panels/ControlPanel";
import StatusBar from "@/components/panels/StatusBar";
import ConversationViewer from "@/components/session/ConversationViewer";
import SessionListPanel from "@/components/session/SessionListPanel";
import ChatPanel from "@/components/chat/ChatPanel";
import WalletPanel from "@/components/panels/WalletPanel";
import TransferModal from "@/components/panels/TransferModal";
import WithdrawModal from "@/components/panels/WithdrawModal";
import VisitConfirmDialog from "@/components/island/VisitConfirmDialog";
import StageEditorView from "@/components/stage-editor/StageEditorView";
import { gameById } from "@/lib/games";
import VisitNotifications from "@/components/notifications/VisitNotifications";
import RpsInvitationToast from "@/components/notifications/RpsInvitationToast";
import PendingConfirmationToast from "@/components/notifications/PendingConfirmationToast";
import NotificationInbox from "@/components/notifications/NotificationInbox";
import HostRpsContainer from "@/components/visit/HostRpsContainer";
import HostChatContainer from "@/components/visit/HostChatContainer";
import { useAppStore } from "@/stores/appStore";
import { useT } from "@/lib/i18n";
import { useNearbyIslands, useUpdatePosition } from "@/hooks/useIslands";
import { useProfile } from "@/hooks/useProfile";
import { useUserSocket } from "@/hooks/useUserSocket";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

/* SVG icon for the sidebar toggle (panel layout) */
function PanelIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

/* EN/KO/JA language toggle for the UI locale */
const LOCALE_TOGGLE: { code: "en" | "ko" | "ja"; label: string; title: string }[] = [
  { code: "en", label: "EN", title: "English" },
  { code: "ko", label: "한", title: "한국어" },
  { code: "ja", label: "日", title: "日本語" },
];

function LanguageToggle() {
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  return (
    <div className="flex items-center rounded-md border border-zinc-200 overflow-hidden text-xs">
      {LOCALE_TOGGLE.map(({ code, label, title }) => (
        <button
          key={code}
          onClick={() => setLocale(code)}
          className={`px-2 py-1 transition-colors ${
            locale === code
              ? "bg-zinc-800 text-white"
              : "text-zinc-500 hover:bg-zinc-100"
          }`}
          title={title}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const t = useT();
  const selectedUserId = useAppStore((s) => s.selectedUserId);
  const selectedUserName = useAppStore((s) => s.selectedUserName);
  const userPosition = useAppStore((s) => s.userPosition);
  const setUserPosition = useAppStore((s) => s.setUserPosition);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const matchCandidates = useAppStore((s) => s.matchCandidates);
  const matchStatus = useAppStore((s) => s.matchStatus);
  const viewMode = useAppStore((s) => s.viewMode);
  const activeVisitId = useAppStore((s) => s.activeVisitId);
  const activeVisitGameId = useAppStore((s) => s.activeVisitGameId);
  const requestVisit = useAppStore((s) => s.requestVisit);
  const openChatWith = useAppStore((s) => s.openChatWith);

  const { data: nearbyData } = useNearbyIslands();
  const { data: profile } = useProfile();
  const updatePosition = useUpdatePosition();

  // ── User-channel notifications ──
  const pushVisitToast = useAppStore((s) => s.pushVisitToast);
  const setHostActiveVisit = useAppStore((s) => s.setHostActiveVisit);
  const clearHostActiveVisitIfMatches = useAppStore((s) => s.clearHostActiveVisitIfMatches);
  const setRpsInvite = useAppStore((s) => s.setRpsInvite);
  const setLastRpsReveal = useAppStore((s) => s.setLastRpsReveal);
  const setLastRpsCancelled = useAppStore((s) => s.setLastRpsCancelled);
  const setVisitorActiveRpsRound = useAppStore((s) => s.setVisitorActiveRpsRound);

  const queryClient = useQueryClient();
  const refreshLocalWallet = useCallback(() => {
    if (!selectedUserId) return;
    queryClient.invalidateQueries({ queryKey: ["wallet", selectedUserId] });
    queryClient.invalidateQueries({ queryKey: ["balance", selectedUserId] });
    queryClient.invalidateQueries({ queryKey: ["transactions", selectedUserId] });
  }, [queryClient, selectedUserId]);

  useUserSocket(selectedUserId, {
    onIncomingVisit: (e) => {
      pushVisitToast({
        id: `inc-${e.visitId}-${Date.now()}`,
        kind: "incoming",
        visitId: e.visitId,
        visitorId: e.visitorId,
        visitorName: e.visitorName,
      });
    },
    onVisitArrived: (e) => {
      pushVisitToast({
        id: `arr-${e.visitId}-${Date.now()}`,
        kind: "arrived",
        visitId: e.visitId,
        visitorId: e.visitorId,
        visitorName: e.visitorName,
      });
      // Mount host-side chat panel. Idempotent on duplicate arrivals.
      setHostActiveVisit({
        visitId: e.visitId,
        visitorId: e.visitorId,
        visitorName: e.visitorName,
      });
    },
    onVisitEnded: (e) => {
      pushVisitToast({
        id: `end-${e.visitId}-${Date.now()}`,
        kind: "ended",
        visitId: e.visitId,
      });
      clearHostActiveVisitIfMatches(e.visitId);
    },
    onDmReceived: (e) => {
      pushVisitToast({
        id: `dm-${e.visitId}-${Date.now()}`,
        kind: "dm",
        visitId: e.visitId,
        visitorId: e.senderId,
        visitorName: e.senderName,
        preview: e.preview,
      });
    },
    onRpsInvite: (e) => {
      // Initiator already has the round id locally; only the *other* side
      // needs the invitation toast/modal.
      if (e.initiatorId === selectedUserId) {
        setVisitorActiveRpsRound({
          visitId: e.visitId,
          roundId: e.roundId,
          wagerAmount: e.wagerAmount,
        });
        return;
      }
      setRpsInvite(e);
    },
    onRpsReveal: (e) => {
      setLastRpsReveal(e);
      // Server already settled the bet; React Query cache (WalletPanel)
      // needs to re-fetch to show the new balance/transactions.
      refreshLocalWallet();
    },
    onRpsCancelled: (e) => setLastRpsCancelled(e),
    onPendingConfirmation: (e) => {
      useAppStore.getState().pushPendingConfirmation({
        type: "deal:pending_confirmation",
        tool_call_id: e.toolCallId,
        plugin: e.plugin,
        tool_name: e.toolName,
        session_id: e.sessionId,
        summary: e.summary,
      });
      // A durable inbox row was written before this event was published.
      queryClient.invalidateQueries({ queryKey: ["notifications", selectedUserId] });
    },
    onEvaluationReady: (e) => {
      // Inbox row (badge) + session status changed to awaiting_review; if the
      // session is open, the final_evaluation stream marker drives the card.
      queryClient.invalidateQueries({ queryKey: ["notifications", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["sessions", selectedUserId] });
      queryClient.invalidateQueries({
        queryKey: ["evaluations", e.sessionId, selectedUserId],
      });
    },
    onChatReceived: (e) => {
      // notification_enabled is the master switch for live surfacing; when off,
      // nothing pops (the message is still stored and readable from the inbox).
      if (!(profile?.notification_enabled ?? true)) return;
      const store = useAppStore.getState();
      // Already reading this conversation — no badge, no toast.
      if (e.roomId === store.openRoomId) return;
      // chatting_enabled decides whether it surfaces as a live unread thread.
      if (profile?.chatting_enabled ?? true) {
        store.incrementUnread(e.roomId);
      }
      pushVisitToast({
        id: `chat-${e.roomId}-${Date.now()}`,
        kind: "chat",
        visitId: e.roomId,
        visitorId: e.senderId,
        visitorName: e.senderName,
        preview: e.preview,
        roomId: e.roomId,
      });
    },
  });

  const handlePositionChange = useCallback(
    (lon: number, lat: number) => {
      if (!selectedUserId) return;
      setUserPosition({ longitude: lon, latitude: lat });
      updatePosition.mutate({ userId: selectedUserId, longitude: lon, latitude: lat });
    },
    [selectedUserId, setUserPosition, updatePosition],
  );

  const handleIslandDoubleClick = useCallback(
    (userId: string, displayName: string) => {
      if (!selectedUserId) return;
      if (userId === selectedUserId) return;
      requestVisit(userId, displayName);
    },
    [selectedUserId, requestVisit],
  );

  const handleIslandClick = useCallback(
    (userId: string, displayName: string) => {
      if (!selectedUserId) return;
      if (userId === selectedUserId) return;
      openChatWith(userId, displayName);
    },
    [selectedUserId, openChatWith],
  );

  // When match results exist, filter map to only show matched users
  const displayIslands = useMemo(() => {
    const all = nearbyData?.islands ?? [];
    if (matchStatus === "found" && matchCandidates.length > 0) {
      const matchedUserIds = new Set(matchCandidates.map((c) => c.user_id));
      return all.filter((island) => matchedUserIds.has(island.user_id));
    }
    return all;
  }, [nearbyData, matchStatus, matchCandidates]);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const inIslandView =
    (viewMode === "island" || viewMode === "loading") && activeVisitId;

  // Fullscreen stage editor — author this island's platformer stages.
  if (viewMode === "editor" && selectedUserId) {
    return <StageEditorView />;
  }

  // Fullscreen island exploration — hide sidebar, modals, and chrome.
  // Which game view renders is the visitor's pick from VisitConfirmDialog.
  if (inIslandView) {
    const GameView = gameById(activeVisitGameId).component;
    return (
      <div className="flex h-screen w-screen overflow-hidden">
        <GameView visitId={activeVisitId!} />
        <VisitNotifications />
        <RpsInvitationToast />
        <PendingConfirmationToast />
        <HostRpsContainer />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <TransferModal />
      <WithdrawModal />
      <VisitConfirmDialog />
      <VisitNotifications />
      <RpsInvitationToast />
      <PendingConfirmationToast />
      <HostRpsContainer />
      <HostChatContainer />
      <div className="flex-1 relative">
        <IslumeMap
          islands={displayIslands}
          selectedUserId={selectedUserId}
          selectedUserName={selectedUserName}
          userPosition={userPosition}
          findRadiusM={profile?.find_radius_m ?? 500}
          onPositionChange={handlePositionChange}
          onIslandDoubleClick={handleIslandDoubleClick}
          onIslandClick={handleIslandClick}
        />
      </div>

      {/* Sidebar — collapsed or expanded */}
      {sidebarOpen ? (
        <div className="w-[360px] border-l border-zinc-200 bg-white flex flex-col shrink-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 shrink-0">
            <h1 className="text-lg font-semibold text-zinc-800">{t("sidebar.title")}</h1>
            <div className="flex items-center gap-2">
              <NotificationInbox />
              <LanguageToggle />
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-zinc-100 transition-colors"
                title="Close sidebar"
              >
                <PanelIcon className="text-zinc-500" />
              </button>
            </div>
          </div>

          <div className="p-4 border-b border-zinc-200 shrink-0">
            <UserSelector />
          </div>

          <div className="shrink-0">
            <StatusBar />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {selectedUserId && (
              <div className="border-b border-zinc-200">
                <WalletPanel />
              </div>
            )}

            {selectedUserId && (
              <div className="border-b border-zinc-200">
                <ProfilePanel />
              </div>
            )}

            {selectedUserId && (
              <div className="border-b border-zinc-200">
                <AgentPanel />
              </div>
            )}

            <div className="p-4 border-b border-zinc-200">
              <ControlPanel />
            </div>

            {selectedUserId && (
              <div className="border-b border-zinc-200">
                <SessionListPanel />
              </div>
            )}

            {activeSessionId && (
              <div>
                <ConversationViewer />
              </div>
            )}

            {selectedUserId && !activeSessionId && (
              <div className="border-t border-zinc-200">
                <ChatPanel />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Collapsed sidebar — icon strip */
        <div className="w-12 border-l border-zinc-200 bg-white flex flex-col items-center py-3 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-zinc-100 transition-colors"
            title="Open sidebar"
          >
            <PanelIcon className="text-zinc-500" />
          </button>
        </div>
      )}
    </div>
  );
}
