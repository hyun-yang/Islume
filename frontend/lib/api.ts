import type {
  NearbyIslandsResponse,
  MatchResponse,
  CreateSessionResponse,
  SessionSummary,
  ConversationTurn,
  UserProfile,
  ProfileUpdateRequest,
  AgentResponse,
  AgentCreate,
  AgentUpdate,
  AgentMarkdownResponse,
  ChatRoomResponse,
  ChatMessageResponse,
  WalletResponse,
  BalanceResponse,
  TransferRequest,
  TransferResponse,
  TransactionHistoryResponse,
  VisitResponse,
  DMMessage,
  PluginInfo,
} from "./types";

const MATCHING = "/api/matching";
const ORCHESTRATOR = "/api/orchestrator";

export async function updatePosition(
  userId: string,
  longitude: number,
  latitude: number,
): Promise<void> {
  const res = await fetch(`${MATCHING}/islands/${userId}/position`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ longitude, latitude }),
  });
  if (!res.ok) throw new Error(`Position update failed: ${res.status}`);
}

export async function fetchNearbyIslands(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<NearbyIslandsResponse> {
  const res = await fetch(
    `${MATCHING}/islands/nearby?lat=${lat}&lon=${lon}&radius_m=${radiusM}`,
  );
  if (!res.ok) throw new Error(`Nearby fetch failed: ${res.status}`);
  return res.json();
}

export async function findMatch(
  userId: string,
  radiusM: number,
  minSimilarity?: number,
  searchMode?: string,
): Promise<MatchResponse> {
  const body: Record<string, unknown> = {
    user_id: userId,
    radius_m: radiusM,
  };
  if (minSimilarity !== undefined) body.min_similarity = minSimilarity;
  if (searchMode) body.search_mode = searchMode;

  const res = await fetch(`${MATCHING}/matches/find`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Match find failed: ${res.status}`);
  return res.json();
}

export async function createSession(
  userAId: string,
  userBId: string,
  similarityScore: number,
  matchContext: string,
  maxTurns: number,
): Promise<CreateSessionResponse> {
  const res = await fetch(`${ORCHESTRATOR}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_a_id: userAId,
      user_b_id: userBId,
      similarity_score: similarityScore,
      match_context: matchContext,
      max_turns: maxTurns,
    }),
  });
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
  return res.json();
}

export async function fetchUserSessions(userId: string): Promise<SessionSummary[]> {
  const res = await fetch(`${ORCHESTRATOR}/users/${userId}/sessions`);
  if (!res.ok) throw new Error(`Sessions fetch failed: ${res.status}`);
  return res.json();
}

/** Conversation turns from Postgres (durable history). The WS stream is only for
 *  live updates, so finished sessions load their turns from here — they stay
 *  viewable even after Redis is cleared. Maps snake_case → the camelCase
 *  ConversationTurn the store/viewer use. */
export async function fetchSessionTurns(
  sessionId: string,
): Promise<ConversationTurn[]> {
  const res = await fetch(`${ORCHESTRATOR}/sessions/${sessionId}/turns`);
  if (!res.ok) throw new Error(`Session turns fetch failed: ${res.status}`);
  const data: Array<{
    turn_number: number;
    speaker_agent_id: string;
    speaker_name: string;
    content: string;
    model_used: string | null;
  }> = await res.json();
  return data.map((t) => ({
    turnNumber: t.turn_number,
    speakerAgentId: t.speaker_agent_id,
    speakerName: t.speaker_name,
    content: t.content,
    modelUsed: t.model_used ?? undefined,
  }));
}

export async function cancelSession(
  sessionId: string,
  userId: string,
): Promise<{ status: string; detail?: string }> {
  const res = await fetch(`${ORCHESTRATOR}/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error(`Session cancel failed: ${res.status}`);
  return res.json();
}

export async function respondToAffinity(
  sessionId: string,
  userId: string,
  action: "continue" | "end",
): Promise<{ status: string }> {
  const res = await fetch(`${ORCHESTRATOR}/sessions/${sessionId}/affinity-response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, action }),
  });
  if (!res.ok) throw new Error(`Affinity response failed: ${res.status}`);
  return res.json();
}

export async function fetchPlugins(): Promise<PluginInfo[]> {
  const res = await fetch(`${ORCHESTRATOR}/plugins`);
  if (!res.ok) throw new Error(`Plugins fetch failed: ${res.status}`);
  return res.json();
}

export async function respondToToolCall(
  sessionId: string,
  toolCallId: string,
  userId: string,
  action: "approve" | "reject",
): Promise<{ status: string; action?: string }> {
  const res = await fetch(
    `${ORCHESTRATOR}/sessions/${sessionId}/tool-calls/${toolCallId}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, action }),
    },
  );
  if (!res.ok) throw new Error(`Tool-call respond failed: ${res.status}`);
  return res.json();
}

export async function fetchProfile(userId: string): Promise<UserProfile> {
  const res = await fetch(`${MATCHING}/users/${userId}/profile`);
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return res.json();
}

export async function updateProfile(
  userId: string,
  data: ProfileUpdateRequest,
): Promise<UserProfile> {
  const res = await fetch(`${MATCHING}/users/${userId}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Profile update failed: ${res.status}`);
  return res.json();
}

export async function updateStatus(
  userId: string,
  status: { is_active?: boolean; is_visible?: boolean },
): Promise<void> {
  const res = await fetch(`${MATCHING}/users/${userId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(status),
  });
  if (!res.ok) throw new Error(`Status update failed: ${res.status}`);
}

export async function fetchModels(): Promise<{ models: string[]; system_model: string }> {
  const res = await fetch(`${MATCHING}/models`);
  if (!res.ok) throw new Error(`Models fetch failed: ${res.status}`);
  return res.json();
}

// --- Agent API ---

export async function fetchAgents(userId: string): Promise<AgentResponse[]> {
  const res = await fetch(`${MATCHING}/users/${userId}/agents`);
  if (!res.ok) throw new Error(`Agents fetch failed: ${res.status}`);
  return res.json();
}

export async function createAgent(
  userId: string,
  data: AgentCreate,
): Promise<AgentResponse> {
  const res = await fetch(`${MATCHING}/users/${userId}/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Agent create failed: ${res.status}`);
  return res.json();
}

export async function updateAgent(
  agentId: string,
  userId: string,
  data: AgentUpdate,
): Promise<AgentResponse> {
  const res = await fetch(`${MATCHING}/agents/${agentId}?user_id=${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Agent update failed: ${res.status}`);
  return res.json();
}

export async function deleteAgent(agentId: string, userId: string): Promise<void> {
  const res = await fetch(`${MATCHING}/agents/${agentId}?user_id=${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Agent delete failed: ${res.status}`);
}

export async function toggleAgentActive(
  agentId: string,
  userId: string,
): Promise<AgentResponse> {
  const res = await fetch(
    `${MATCHING}/agents/${agentId}/activate?user_id=${userId}`,
    { method: "PATCH" },
  );
  if (!res.ok) throw new Error(`Agent toggle failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentMarkdown(
  agentId: string,
  userId: string,
): Promise<AgentMarkdownResponse> {
  const res = await fetch(
    `${MATCHING}/agents/${agentId}/markdown?user_id=${userId}`,
  );
  if (!res.ok) throw new Error(`Agent markdown fetch failed: ${res.status}`);
  return res.json();
}

export async function saveAgentMarkdown(
  agentId: string,
  userId: string,
  markdown: string,
): Promise<AgentMarkdownResponse> {
  const res = await fetch(
    `${MATCHING}/agents/${agentId}/markdown?user_id=${userId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    },
  );
  if (!res.ok) {
    // Surface server-side parse errors verbatim so the editor can show them.
    const text = await res.text();
    let detail = text;
    try {
      detail = (JSON.parse(text)?.detail as string) ?? text;
    } catch {
      // text already set
    }
    throw new Error(detail || `Agent markdown save failed: ${res.status}`);
  }
  return res.json();
}

// --- Chat API ---

const GATEWAY = "/api/gateway";

export async function createChatRoom(
  roomType: string,
  memberIds: string[],
  name?: string,
): Promise<ChatRoomResponse> {
  const res = await fetch(`${GATEWAY}/chat/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room_type: roomType, member_ids: memberIds, name }),
  });
  if (!res.ok) throw new Error(`Room create failed: ${res.status}`);
  return res.json();
}

export async function fetchChatRooms(userId: string): Promise<ChatRoomResponse[]> {
  const res = await fetch(`${GATEWAY}/chat/rooms?user_id=${userId}`);
  if (!res.ok) throw new Error(`Rooms fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchChatMessages(
  roomId: string,
  limit = 50,
  offset = 0,
): Promise<ChatMessageResponse[]> {
  const res = await fetch(
    `${GATEWAY}/chat/rooms/${roomId}/messages?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`Messages fetch failed: ${res.status}`);
  return res.json();
}

// --- Wallet API ---

const WALLET = "/api/wallet";

export async function fetchWallet(userId: string): Promise<WalletResponse> {
  const res = await fetch(`${WALLET}/wallets/${userId}`);
  if (!res.ok) throw new Error(`Wallet fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchBalance(userId: string): Promise<BalanceResponse> {
  const res = await fetch(`${WALLET}/wallets/${userId}/balance`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  return res.json();
}

export async function transferISL(data: TransferRequest): Promise<TransferResponse> {
  const res = await fetch(`${WALLET}/transactions/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Transfer failed: ${res.status}` }));
    throw new Error(err.detail || `Transfer failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchTransactions(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<TransactionHistoryResponse> {
  const res = await fetch(
    `${WALLET}/wallets/${userId}/transactions?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`Transactions fetch failed: ${res.status}`);
  return res.json();
}

// --- Visit API ---

const VISIT = "/api/visit";

export async function createVisit(
  visitorId: string,
  hostId: string,
): Promise<VisitResponse> {
  const res = await fetch(`${VISIT}/visits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: visitorId, host_id: hostId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `Visit create failed: ${res.status}` }));
    throw new Error(err.detail || `Visit create failed: ${res.status}`);
  }
  return res.json();
}

/** @deprecated Unused — no caller in the app; retained pending a feature decision. */
export async function fetchVisit(visitId: string): Promise<VisitResponse> {
  const res = await fetch(`${VISIT}/visits/${visitId}`);
  if (!res.ok) throw new Error(`Visit fetch failed: ${res.status}`);
  return res.json();
}

export async function endVisit(visitId: string): Promise<VisitResponse> {
  const res = await fetch(`${VISIT}/visits/${visitId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Visit end failed: ${res.status}`);
  return res.json();
}

export async function fetchVisitMessages(
  visitId: string,
): Promise<{ messages: DMMessage[]; total: number }> {
  const res = await fetch(`${VISIT}/visits/${visitId}/messages`);
  if (!res.ok) throw new Error(`Messages fetch failed: ${res.status}`);
  return res.json();
}

// ── RPS multiplayer endpoints ──

export interface RpsRoundResponse {
  round_id: string;
  visit_id: string;
  visitor_id: string;
  host_id: string;
  wager_amount: number;
  visitor_pick: string | null;
  host_pick: string | null;
  status: "pending" | "revealed" | "cancelled";
  outcome: "win" | "lose" | "draw" | null;
  winner_id: string | null;
  cancel_reason: string | null;
  created_at: string;
  revealed_at: string | null;
}

async function rpsRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function createRpsRound(
  visitId: string, initiatorId: string,
): Promise<RpsRoundResponse> {
  return rpsRequest(`${VISIT}/visits/${visitId}/rps/rounds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initiator_id: initiatorId }),
  });
}

export async function submitRpsPick(
  visitId: string, roundId: string, senderId: string, pick: string,
): Promise<RpsRoundResponse> {
  return rpsRequest(`${VISIT}/visits/${visitId}/rps/rounds/${roundId}/pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender_id: senderId, pick }),
  });
}

export async function declineRpsRound(
  visitId: string, roundId: string, senderId: string,
): Promise<RpsRoundResponse> {
  return rpsRequest(`${VISIT}/visits/${visitId}/rps/rounds/${roundId}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender_id: senderId }),
  });
}

/** @deprecated Unused — no caller in the app; retained pending a feature decision. */
export async function fetchRpsRound(
  visitId: string, roundId: string,
): Promise<RpsRoundResponse> {
  return rpsRequest(`${VISIT}/visits/${visitId}/rps/rounds/${roundId}`);
}
