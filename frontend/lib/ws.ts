import type { SessionEvent } from "./types";
import { getWsBaseUrl } from "./constants";

type EventHandler = (event: SessionEvent) => void;
type StatusHandler = (status: "connecting" | "connected" | "disconnected" | "ended") => void;

export class SessionWebSocket {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private onEvent: EventHandler;
  private onStatusChange: StatusHandler;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private ended = false;

  constructor(sessionId: string, onEvent: EventHandler, onStatusChange: StatusHandler) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;
    this.onStatusChange = onStatusChange;
  }

  connect(): void {
    this.onStatusChange("connecting");
    const base = getWsBaseUrl();
    const url = `${base}/ws/sessions/${this.sessionId}`;

    this.ws = new WebSocket(url);

    this.ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as SessionEvent;
      this.onEvent(event);

      if (event.event_type === "connected") {
        this.onStatusChange("connected");
        this.reconnectAttempts = 0;
      } else if (event.event_type === "session_ended") {
        this.ended = true;
        this.onStatusChange("ended");
        this.ws?.close();
      }
    };

    this.ws.onclose = () => {
      if (!this.ended && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.onStatusChange("disconnected");
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts++;
    this.reconnectTimeoutId = setTimeout(() => this.connect(), delay);
  }

  disconnect(): void {
    this.ended = true;
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    this.ws?.close();
    this.ws = null;
  }
}
