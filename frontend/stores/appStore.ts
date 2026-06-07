import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ConversationTurn,
  DealFinalizedPayload,
  MatchCandidate,
  PendingConfirmationNotification,
  ToolCallEventPayload,
  VisitViewMode,
} from "@/lib/types";

interface PendingVisit {
  hostId: string;
  hostName: string;
}

export type Locale = "en" | "ko" | "ja";

// Server-selected default UI language (./scripts/start_all.sh --lang <en|ko|ja>
// → NEXT_PUBLIC_DEFAULT_LOCALE). Only the initial store value; a persisted
// localStorage choice from a prior toggle takes precedence (zustand persist).
const DEFAULT_LOCALE: Locale = ((): Locale => {
  const v = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  return v === "ko" || v === "ja" ? v : "en";
})();

interface AppState {
  // UI language (persisted; agent conversation language is separate, set
  // per-agent via boundaries.language)
  locale: Locale;

  // User selection (no auth — pick from seed data)
  selectedUserId: string | null;
  selectedUserName: string | null;

  // Position
  userPosition: { longitude: number; latitude: number } | null;

  // Match
  matchCandidates: MatchCandidate[];
  selectedMatches: MatchCandidate[];
  matchStatus: "idle" | "searching" | "found" | "no_match";

  // Session
  activeSessionId: string | null;
  sessionStatus:
    | "none"
    | "creating"
    | "active"
    | "ended"
    | "awaiting_review"
    | "awaiting_owner_confirmation";
  conversationTurns: ConversationTurn[];

  // Intent plugin protocol — tool_call events surface inline in the timeline,
  // dealFinalized triggers a celebratory card, pendingConfirmations are
  // toasts the owner sees when their agent needs human approval.
  toolCallEvents: ToolCallEventPayload[];
  dealFinalized: DealFinalizedPayload | null;
  pendingConfirmations: PendingConfirmationNotification[];

  // Affinity
  affinityCheck: { score: number; summary: string; recommendation: string } | null;

  // Wallet
  showTransferModal: boolean;

  // Visit
  viewMode: VisitViewMode;
  pendingVisit: PendingVisit | null;
  activeVisitId: string | null;
  activeVisitHostId: string | null;
  activeVisitHostName: string | null;
  visitStatus: "active" | "arrived" | "ended" | null;

  // Visit notifications (host-side toasts)
  visitToasts: VisitToast[];

  // Host's currently active inbound visit (after the visitor arrives at the cabin)
  hostActiveVisit: HostActiveVisit | null;

  // RPS multiplayer
  pendingRpsInvite: RpsInvite | null;        // host receives an invitation
  acceptedHostRpsRound: RpsInvite | null;    // host accepted, dialog mounted
  visitorActiveRpsRound: VisitorRpsState | null;  // visitor's outstanding round
  lastRpsReveal: RpsReveal | null;           // last reveal event (for both sides)
  lastRpsCancelled: RpsCancelled | null;

  // Actions
  setLocale: (locale: Locale) => void;
  selectUser: (userId: string, displayName: string) => void;

  // Direct chat: the user we're actively chatting with (title = their name).
  chatTarget: { userId: string; userName: string } | null;
  openChatWith: (userId: string, userName: string) => void;
  closeChat: () => void;
  // The room currently rendered in the chat view, so incoming-message handlers
  // can skip the unread badge for the conversation already being read.
  openRoomId: string | null;
  setOpenRoom: (roomId: string | null) => void;
  // Per-room unread counts (client-session only; reset on reload).
  unreadByRoom: Record<string, number>;
  incrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;

  setUserPosition: (pos: { longitude: number; latitude: number }) => void;
  setMatchCandidates: (candidates: MatchCandidate[]) => void;
  toggleMatchSelection: (match: MatchCandidate) => void;
  clearMatchSelection: () => void;
  setMatchStatus: (status: AppState["matchStatus"]) => void;
  setActiveSession: (sessionId: string) => void;
  setSessionStatus: (status: AppState["sessionStatus"]) => void;
  addConversationTurn: (turn: ConversationTurn) => void;
  setAffinityCheck: (check: AppState["affinityCheck"]) => void;
  upsertToolCallEvent: (payload: ToolCallEventPayload) => void;
  setDealFinalized: (payload: DealFinalizedPayload | null) => void;
  pushPendingConfirmation: (n: PendingConfirmationNotification) => void;
  dismissPendingConfirmation: (toolCallId: string) => void;
  setShowTransferModal: (show: boolean) => void;
  clearSession: () => void;
  reset: () => void;

  // Visit actions
  requestVisit: (hostId: string, hostName: string) => void;
  cancelVisitRequest: () => void;
  beginVisit: (visitId: string, hostId: string, hostName: string) => void;
  setViewMode: (mode: VisitViewMode) => void;
  setVisitStatus: (status: AppState["visitStatus"]) => void;
  endVisitState: () => void;

  // Notification actions
  pushVisitToast: (t: VisitToast) => void;
  dismissVisitToast: (id: string) => void;

  // Host inbound-visit actions
  setHostActiveVisit: (v: HostActiveVisit | null) => void;
  clearHostActiveVisitIfMatches: (visitId: string) => void;

  // RPS actions
  setRpsInvite: (invite: RpsInvite | null) => void;
  setAcceptedHostRpsRound: (invite: RpsInvite | null) => void;
  setVisitorActiveRpsRound: (s: VisitorRpsState | null) => void;
  setLastRpsReveal: (r: RpsReveal | null) => void;
  setLastRpsCancelled: (c: RpsCancelled | null) => void;
}

interface HostActiveVisit {
  visitId: string;
  visitorId: string;
  visitorName: string;
}

interface VisitToast {
  id: string;
  kind: "incoming" | "arrived" | "ended" | "dm" | "chat";
  visitId: string;
  visitorId?: string;
  visitorName?: string;
  preview?: string;
  // For "chat" toasts: the direct-chat room to open when tapped.
  roomId?: string;
}

interface RpsInvite {
  visitId: string;
  roundId: string;
  wagerAmount: number;
  initiatorId: string;
  visitorId: string;
  hostId: string;
  visitorName: string;
  hostName: string;
}

interface VisitorRpsState {
  visitId: string;
  roundId: string;
  wagerAmount: number;
}

interface RpsReveal {
  visitId: string;
  roundId: string;
  visitorPick: "rock" | "paper" | "scissors";
  hostPick: "rock" | "paper" | "scissors";
  outcome: "win" | "lose" | "draw";
  winnerId?: string;
  balanceAfter?: number;
}

interface RpsCancelled {
  visitId: string;
  roundId: string;
  reason: string;
  cancelledBy?: string;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  locale: DEFAULT_LOCALE,
  selectedUserId: null,
  selectedUserName: null,
  userPosition: null,
  matchCandidates: [],
  selectedMatches: [],
  matchStatus: "idle",
  activeSessionId: null,
  sessionStatus: "none",
  conversationTurns: [],
  toolCallEvents: [],
  dealFinalized: null,
  pendingConfirmations: [],
  affinityCheck: null,
  showTransferModal: false,

  viewMode: "world",
  pendingVisit: null,
  activeVisitId: null,
  activeVisitHostId: null,
  activeVisitHostName: null,
  visitStatus: null,

  visitToasts: [],
  hostActiveVisit: null,
  pendingRpsInvite: null,
  acceptedHostRpsRound: null,
  visitorActiveRpsRound: null,
  lastRpsReveal: null,
  lastRpsCancelled: null,

  setLocale: (locale) => set({ locale }),

  selectUser: (userId, displayName) =>
    set({
      selectedUserId: userId,
      selectedUserName: displayName,
      matchCandidates: [],
      selectedMatches: [],
      matchStatus: "idle",
      activeSessionId: null,
      sessionStatus: "none",
      conversationTurns: [],
      chatTarget: null,
      unreadByRoom: {},
    }),

  // Direct chat
  chatTarget: null,
  openChatWith: (userId, userName) => set({ chatTarget: { userId, userName } }),
  closeChat: () => set({ chatTarget: null }),
  openRoomId: null,
  setOpenRoom: (roomId) => set({ openRoomId: roomId }),
  unreadByRoom: {},
  incrementUnread: (roomId) =>
    set((state) => ({
      unreadByRoom: {
        ...state.unreadByRoom,
        [roomId]: (state.unreadByRoom[roomId] ?? 0) + 1,
      },
    })),
  clearUnread: (roomId) =>
    set((state) => {
      if (!state.unreadByRoom[roomId]) return {};
      const next = { ...state.unreadByRoom };
      delete next[roomId];
      return { unreadByRoom: next };
    }),

  setUserPosition: (pos) => set({ userPosition: pos }),

  setMatchCandidates: (candidates) => set({ matchCandidates: candidates }),

  toggleMatchSelection: (match) =>
    set((state) => {
      const key = `${match.user_id}-${match.agent_id}`;
      const exists = state.selectedMatches.some(
        (m) => `${m.user_id}-${m.agent_id}` === key
      );
      return {
        selectedMatches: exists
          ? state.selectedMatches.filter(
              (m) => `${m.user_id}-${m.agent_id}` !== key
            )
          : [...state.selectedMatches, match],
      };
    }),

  clearMatchSelection: () => set({ selectedMatches: [] }),

  setMatchStatus: (status) => set({ matchStatus: status }),

  setActiveSession: (sessionId) =>
    set((state) =>
      // Re-selecting the session already being viewed must NOT wipe its loaded
      // turns. useSessionStream only reconnects (and replays history) when the
      // sessionId actually changes, so clearing turns on a same-session reselect
      // leaves the conversation permanently empty (no replay arrives). Only
      // reset when switching to a different session.
      state.activeSessionId === sessionId
        ? { activeSessionId: sessionId }
        : {
            activeSessionId: sessionId,
            sessionStatus: "active",
            conversationTurns: [],
            toolCallEvents: [],
            dealFinalized: null,
          },
    ),

  setSessionStatus: (status) => set({ sessionStatus: status }),

  addConversationTurn: (turn) =>
    set((state) => ({
      conversationTurns: [...state.conversationTurns, turn],
    })),

  setAffinityCheck: (check) => set({ affinityCheck: check }),

  upsertToolCallEvent: (payload) =>
    set((state) => {
      const idx = state.toolCallEvents.findIndex(
        (e) => e.tool_call_id === payload.tool_call_id,
      );
      if (idx >= 0) {
        const next = state.toolCallEvents.slice();
        next[idx] = { ...next[idx], ...payload };
        return { toolCallEvents: next };
      }
      return { toolCallEvents: [...state.toolCallEvents, payload] };
    }),

  setDealFinalized: (payload) => set({ dealFinalized: payload }),

  pushPendingConfirmation: (n) =>
    set((state) =>
      state.pendingConfirmations.some((x) => x.tool_call_id === n.tool_call_id)
        ? state
        : { pendingConfirmations: [...state.pendingConfirmations, n] },
    ),

  dismissPendingConfirmation: (toolCallId) =>
    set((state) => ({
      pendingConfirmations: state.pendingConfirmations.filter(
        (n) => n.tool_call_id !== toolCallId,
      ),
    })),

  setShowTransferModal: (show) => set({ showTransferModal: show }),

  clearSession: () =>
    set({
      activeSessionId: null,
      sessionStatus: "none",
      conversationTurns: [],
      toolCallEvents: [],
      dealFinalized: null,
      affinityCheck: null,
      matchCandidates: [],
      selectedMatches: [],
      matchStatus: "idle",
    }),

  reset: () =>
    set({
      selectedUserId: null,
      selectedUserName: null,
      userPosition: null,
      matchCandidates: [],
      selectedMatches: [],
      matchStatus: "idle",
      activeSessionId: null,
      sessionStatus: "none",
      conversationTurns: [],
      toolCallEvents: [],
      dealFinalized: null,
      pendingConfirmations: [],
      affinityCheck: null,
      viewMode: "world",
      pendingVisit: null,
      activeVisitId: null,
      activeVisitHostId: null,
      activeVisitHostName: null,
      visitStatus: null,
    }),

  requestVisit: (hostId, hostName) =>
    set({ pendingVisit: { hostId, hostName } }),

  cancelVisitRequest: () => set({ pendingVisit: null }),

  beginVisit: (visitId, hostId, hostName) =>
    set({
      pendingVisit: null,
      activeVisitId: visitId,
      activeVisitHostId: hostId,
      activeVisitHostName: hostName,
      visitStatus: "active",
      viewMode: "loading",
    }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setVisitStatus: (status) => set({ visitStatus: status }),

  endVisitState: () =>
    set({
      viewMode: "world",
      pendingVisit: null,
      activeVisitId: null,
      activeVisitHostId: null,
      activeVisitHostName: null,
      visitStatus: null,
    }),

  pushVisitToast: (t) =>
    set((s) => ({ visitToasts: [...s.visitToasts, t].slice(-5) })),
  dismissVisitToast: (id) =>
    set((s) => ({ visitToasts: s.visitToasts.filter((x) => x.id !== id) })),

  setHostActiveVisit: (v) => set({ hostActiveVisit: v }),
  clearHostActiveVisitIfMatches: (visitId) =>
    set((s) => ({
      hostActiveVisit:
        s.hostActiveVisit && s.hostActiveVisit.visitId === visitId
          ? null
          : s.hostActiveVisit,
    })),

  setRpsInvite: (invite) => set({ pendingRpsInvite: invite }),
  setAcceptedHostRpsRound: (invite) => set({ acceptedHostRpsRound: invite }),
  setVisitorActiveRpsRound: (r) => set({ visitorActiveRpsRound: r }),
  setLastRpsReveal: (r) => set({ lastRpsReveal: r }),
  setLastRpsCancelled: (c) => set({ lastRpsCancelled: c }),
    }),
    {
      // Persist only the durable identity bits — selected user and last
      // known position. Visit/match/session state stays ephemeral so a
      // refresh doesn't try to resume a torn-down visit or stale match.
      name: "islume-app",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        locale: state.locale,
        selectedUserId: state.selectedUserId,
        selectedUserName: state.selectedUserName,
        userPosition: state.userPosition,
      }),
    },
  ),
);

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __appStore?: unknown }).__appStore = useAppStore;
}
