// API response types — mirrors backend Pydantic schemas

import type { Actor, Background } from "./platformer/types";

export interface NearbyIsland {
  user_id: string;
  longitude: number;
  latitude: number;
  distance_m: number | null;
  display_name: string | null;
  is_active: boolean;
}

export interface NearbyIslandsResponse {
  center: { longitude: number; latitude: number };
  radius_m: number;
  islands: NearbyIsland[];
}

export interface MatchCandidate {
  user_id: string;
  agent_id: string;
  my_agent_id: string;
  similarity_score: number;
  distance_m: number;
  display_name: string;
  agent_name: string;
}

export interface MatchResponse {
  user_id: string;
  candidates: MatchCandidate[];
  selected: MatchCandidate | null;
}

export interface CreateSessionResponse {
  session_id: string;
  status: string;
}

export interface SessionSummary {
  session_id: string;
  partner_user_id: string;
  partner_name: string;
  partner_agent_name: string;
  my_agent_name: string;
  status: string;
  turn_count: number;
  max_turns: number;
  similarity_score: number;
  started_at: string;
}

// WebSocket event types — from gateway ChatEvent

interface ConnectedEvent {
  event_type: "connected";
  session_id: string;
  stream: string;
}

interface TurnEvent {
  event_type: "turn";
  session_id: string;
  turn_number: number;
  speaker_agent_id: string;
  speaker_name: string;
  content: string;
  model_used?: string;
}

interface SessionEndedEvent {
  event_type: "session_ended";
  session_id: string;
}

interface AffinityCheckEvent {
  event_type: "affinity_check";
  session_id: string;
  content: string; // JSON string: {score, summary, recommendation}
}

interface ToolCallEvent {
  event_type: "tool_call";
  session_id: string;
  turn_number?: number;
  content: string; // JSON string: ToolCallEventPayload
}

interface DealFinalizedEvent {
  event_type: "deal_finalized";
  session_id: string;
  turn_number?: number;
  content: string; // JSON string: DealFinalizedPayload
}

interface FinalEvaluationEvent {
  event_type: "final_evaluation";
  session_id: string;
  turn_number?: number;
  content: string; // JSON string: {reason, turn_number} — content-free marker
}

export type SessionEvent =
  | ConnectedEvent
  | TurnEvent
  | SessionEndedEvent
  | AffinityCheckEvent
  | ToolCallEvent
  | DealFinalizedEvent
  | FinalEvaluationEvent;

// User profile types

export interface UserProfile {
  id: string;
  display_name: string;
  email: string;
  sex: string | null;
  age: number | null;
  job: string | null;
  suburb: string | null;
  find_radius_m: number;
  allow_1on1_chat: boolean;
  allow_group_chat: boolean;
  is_visible: boolean;
  is_active: boolean;
  notification_enabled: boolean;
  chatting_enabled: boolean;
  tier: string;
  preferred_model: string | null;
  auto_approve_affinity: boolean;
  default_max_turns: number;
  affinity_check_turns: number;
  max_concurrent_chats: number;
  search_mode: string;
  min_similarity: number;
}

export interface ProfileUpdateRequest {
  display_name?: string;
  sex?: string | null;
  age?: number | null;
  job?: string | null;
  suburb?: string | null;
  find_radius_m?: number;
  allow_1on1_chat?: boolean;
  allow_group_chat?: boolean;
  is_visible?: boolean;
  is_active?: boolean;
  notification_enabled?: boolean;
  chatting_enabled?: boolean;
  preferred_model?: string | null;
  auto_approve_affinity?: boolean;
  default_max_turns?: number;
  affinity_check_turns?: number;
  max_concurrent_chats?: number;
  search_mode?: string;
  min_similarity?: number;
}

// Agent types

export type GoalCategory =
  | "dating"
  | "networking"
  | "companionship"
  | "collaboration"
  | "casual_chat"
  | "mentorship"
  | "recruiting"
  | "job_seeking";

export type InteractionMode = "online_only" | "offline_ok" | "offline_preferred";

export type RelationshipIntent =
  | "casual"
  | "romantic"
  | "professional"
  | "friendship"
  | "open";

export type Sex = "male" | "female" | "nonbinary" | "other";

export interface Demographics {
  height_cm?: number | null;
  sex?: Sex | null;
  age?: number | null;
  race?: string | null;
  notes?: string | null;
}

export interface Preferences {
  favorite_foods?: string[];
  favorite_movies?: string[];
  favorite_novels?: string[];
  life_view?: string | null;
  religion_view?: string | null;
  work_view?: string | null;
}

// Intent plugin attachment shape — owner-policy form lives under `policy`.
export interface AttachedPlugin {
  plugin: string;
  policy: Record<string, unknown>;
}

// Per-locale persona overrides. Absent fields fall back to the base columns.
interface AgentTranslation {
  name?: string | null;
  description?: string | null;
  persona_prompt?: string | null;
  tags?: string[];
}

export interface AgentResponse {
  id: string;
  name: string;
  description: string;
  persona_prompt: string;
  tone: string;
  tags: string[];
  is_active: boolean;
  created_at: string;
  // v2 — nullable for v1 agents
  goal?: string | null;
  goal_category?: GoalCategory | null;
  interaction_mode?: InteractionMode | null;
  relationship_intent?: RelationshipIntent | null;
  compatible_intents?: RelationshipIntent[] | null;
  topics_of_interest?: string[] | null;
  schema_version?: number | null;
  revision?: number | null;
  demographics?: Demographics | null;
  preferences?: Preferences | null;
  attached_plugins?: AttachedPlugin[] | null;
  translations?: Record<string, AgentTranslation> | null;
  boundaries?: Record<string, unknown> | null;
}

export interface AgentCreate {
  name: string;
  description: string;
  persona_prompt: string;
  tone: string;
  tags: string[];
  // Optional v2 fields
  goal?: string;
  goal_category?: GoalCategory;
  interaction_mode?: InteractionMode;
  relationship_intent?: RelationshipIntent;
  compatible_intents?: RelationshipIntent[];
  topics_of_interest?: string[];
  demographics?: Demographics | null;
  preferences?: Preferences | null;
  attached_plugins?: AttachedPlugin[] | null;
  translations?: Record<string, AgentTranslation> | null;
  boundaries?: Record<string, unknown> | null;
}

export interface AgentUpdate {
  name?: string;
  description?: string;
  persona_prompt?: string;
  tone?: string;
  tags?: string[];
  goal?: string;
  goal_category?: GoalCategory;
  interaction_mode?: InteractionMode;
  relationship_intent?: RelationshipIntent;
  compatible_intents?: RelationshipIntent[];
  topics_of_interest?: string[];
  demographics?: Demographics | null;
  preferences?: Preferences | null;
  attached_plugins?: AttachedPlugin[] | null;
  translations?: Record<string, AgentTranslation> | null;
  boundaries?: Record<string, unknown> | null;
}

// Intent plugin registry — returned by GET /plugins.
export interface PluginInfo {
  id: string;
  card_kind: string;
  description: string;
  tool_names: string[];
  policy_schema: Record<string, unknown>;
}

// One agent's owner-private evaluation of its conversation partner.
export interface EvaluationItem {
  id: string;
  agent_id: string;
  evaluated_agent_id: string;
  goal_category: string | null;
  template: "hobby" | "recruiting" | "job_seeking" | "dating" | "professional";
  verdicts: Record<string, boolean | string>;
  score: number | null;
  summary: string | null;
  turn_number: number;
  trigger: "max_turns" | "session_end";
  created_at: string;
}

// Durable per-user notification (inbox row, served by the orchestrator).
export interface NotificationItem {
  id: string;
  type: string;
  session_id: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

// Bartering-specific policy shape — typed for the form.
export interface BarteringPolicy {
  role: "seller" | "buyer";
  item_name: string;
  currency: "ISL" | "USD";
  price_range: { min: number; max: number };
  auto_accept_at_or_above?: number;
  auto_reject_below?: number;
  max_rounds?: number;
  photo_url?: string;
  allowed_reference_hosts?: string[];
}

// Tool call payload that travels through session_stream ChatEvent.content (JSON).
type ToolCallStatus =
  | "auto_confirmed"
  | "pending"
  | "user_confirmed"
  | "user_rejected"
  | "auto_rejected"
  | "expired";

export interface ToolCallEventPayload {
  tool_call_id: string;
  plugin: string;
  tool_name: string;
  status: ToolCallStatus;
  arguments: Record<string, unknown>;
  agent_id: string;
  reason?: string | null;
  policy_reason?: string | null;
  proposal_id?: string | null;
  counters_proposal_id?: string | null;
  summary?: string | null;
}

export interface DealFinalizedPayload {
  plugin: string;
  proposal_id: string;
  amount: number;
  currency: string;
  item_name: string;
  summary: string;
}

// Pending owner-confirmation notification, sent over /ws/user/{user_id}.
export interface PendingConfirmationNotification {
  type: "deal:pending_confirmation";
  tool_call_id: string;
  plugin: string;
  tool_name: string;
  session_id: string;
  summary: string;
}

export interface AgentMarkdownResponse {
  agent_id: string;
  markdown: string;
  revision: number;
}

// Chat types

export interface ChatRoomResponse {
  id: string;
  room_type: string;
  name: string | null;
  created_by: string;
  created_at: string;
  members: string[];
  member_names: Record<string, string>;
}

export interface ChatMessageResponse {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string | null;
  content: string;
  created_at: string;
}

// Wallet types

export interface WalletResponse {
  id: string;
  user_id: string;
  public_key: string;
  balance: number;
  created_at: string;
}

export interface BalanceResponse {
  user_id: string;
  balance: number;
  currency: string;
}

export interface TransferRequest {
  from_user_id: string;
  to_user_id: string;
  amount: number;
  tx_type: string;
  metadata?: Record<string, unknown>;
  idempotency_key?: string;
}

export interface TransferResponse {
  tx_id: string;
  from_user_id: string;
  to_user_id: string;
  amount: number;
  tx_type: string;
  created_at: string;
  idempotent_replay: boolean;
}

export interface WithdrawalRequest {
  from_user_id: string;
  amount: number;
  destination_address: string;
  idempotency_key?: string;
}

export interface WithdrawalResponse {
  withdrawal_id: string;
  user_id: string;
  amount: number;
  destination_address: string;
  status: string;
  solana_signature: string | null;
  error: string | null;
  created_at: string;
  idempotent_replay: boolean;
}

export interface WithdrawalListResponse {
  withdrawals: WithdrawalResponse[];
  total: number;
}

interface LedgerEntry {
  id: number;
  tx_id: string;
  amount: number;
  currency: string;
  tx_type: string;
  tx_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface TransactionHistoryResponse {
  entries: LedgerEntry[];
  total: number;
  offset: number;
  limit: number;
}

// Visit types

export interface VisitResponse {
  id: string;
  visitor_id: string;
  host_id: string;
  host_name: string;
  status: "active" | "arrived" | "ended";
  visitor_x: number | null;
  visitor_y: number | null;
  started_at: string;
  arrived_at: string | null;
  ended_at: string | null;
}

export interface DMMessage {
  id: string;
  visit_session_id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

export type VisitViewMode = "world" | "loading" | "island" | "editor";

// Which game a visitor plays on the host's island. Lives here (not in
// lib/games.ts) so the app store never imports React components.
export type GameId = "platformer" | "puzzle";

// Island stage types (user-authored platformer levels) — mirrors
// services/visit/schemas.py StageLevelData / StageResponse

export interface StageLevelData {
  background: Background;
  rows: string[];
  spawn: { x: number; y: number };
  goal: { x: number; y: number };
  actors: Actor[];
  checkpoints: { x: number; y: number }[];
}

export interface IslandStage {
  slot: number;
  status: "draft" | "published";
  cleared: boolean;
  name: string;
  level_data: StageLevelData;
  updated_at: string;
}

// UI state types

export interface ConversationTurn {
  turnNumber: number;
  speakerAgentId: string;
  speakerName: string;
  content: string;
  modelUsed?: string;
}
