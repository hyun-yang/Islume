"""Message schemas for Redis Streams tasks and session events."""
from uuid import UUID

from pydantic import BaseModel


class TurnTask(BaseModel):
    """A task to generate one turn in a conversation."""
    session_id: UUID
    turn_number: int
    speaker_agent_id: UUID
    listener_agent_id: UUID
    is_opening: bool = False

    def to_redis(self) -> dict[str, str]:
        return {
            "session_id": str(self.session_id),
            "turn_number": str(self.turn_number),
            "speaker_agent_id": str(self.speaker_agent_id),
            "listener_agent_id": str(self.listener_agent_id),
            "is_opening": "1" if self.is_opening else "0",
        }

    @classmethod
    def from_redis(cls, data: dict[str, str]) -> "TurnTask":
        return cls(
            session_id=UUID(data["session_id"]),
            turn_number=int(data["turn_number"]),
            speaker_agent_id=UUID(data["speaker_agent_id"]),
            listener_agent_id=UUID(data["listener_agent_id"]),
            is_opening=data["is_opening"] == "1",
        )


class ChatEvent(BaseModel):
    """An event written to a session stream for client consumption."""
    event_type: str  # "turn", "session_ended"
    session_id: UUID
    turn_number: int | None = None
    speaker_agent_id: UUID | None = None
    speaker_name: str | None = None
    content: str | None = None
    model_used: str | None = None

    def to_redis(self) -> dict[str, str]:
        """Serialize for XADD — all values must be strings, no None."""
        out = {
            "event_type": self.event_type,
            "session_id": str(self.session_id),
        }
        if self.turn_number is not None:
            out["turn_number"] = str(self.turn_number)
        if self.speaker_agent_id is not None:
            out["speaker_agent_id"] = str(self.speaker_agent_id)
        if self.speaker_name is not None:
            out["speaker_name"] = self.speaker_name
        if self.content is not None:
            out["content"] = self.content
        if self.model_used is not None:
            out["model_used"] = self.model_used
        return out

    @classmethod
    def from_redis(cls, data: dict[str, str]) -> "ChatEvent":
        return cls(
            event_type=data["event_type"],
            session_id=UUID(data["session_id"]),
            turn_number=int(data["turn_number"]) if "turn_number" in data else None,
            speaker_agent_id=UUID(data["speaker_agent_id"]) if "speaker_agent_id" in data else None,
            speaker_name=data.get("speaker_name"),
            content=data.get("content"),
            model_used=data.get("model_used"),
        )

    def to_client_dict(self) -> dict:
        """Serialize for sending to WebSocket clients."""
        return self.model_dump(mode="json", exclude_none=True)


# Redis Streams constants
STREAM_LLM_TASKS = "stream:llm_tasks"
CONSUMER_GROUP = "llm_workers"


def session_stream(session_id: UUID) -> str:
    """Stream key for a specific session's chat events."""
    return f"stream:session:{session_id}"


def wallet_stream(user_id: UUID) -> str:
    """Stream key for wallet events for a specific user."""
    return f"stream:wallet:{user_id}"


class WalletEvent(BaseModel):
    """An event written to a wallet stream for client consumption."""
    event_type: str  # "transfer_sent", "transfer_received", "balance_update"
    user_id: UUID
    balance: int | None = None
    tx_id: UUID | None = None
    amount: int | None = None
    counterparty_id: UUID | None = None
    tx_type: str | None = None

    def to_redis(self) -> dict[str, str]:
        out: dict[str, str] = {
            "event_type": self.event_type,
            "user_id": str(self.user_id),
        }
        if self.balance is not None:
            out["balance"] = str(self.balance)
        if self.tx_id is not None:
            out["tx_id"] = str(self.tx_id)
        if self.amount is not None:
            out["amount"] = str(self.amount)
        if self.counterparty_id is not None:
            out["counterparty_id"] = str(self.counterparty_id)
        if self.tx_type is not None:
            out["tx_type"] = self.tx_type
        return out

    @classmethod
    def from_redis(cls, data: dict[str, str]) -> "WalletEvent":
        return cls(
            event_type=data["event_type"],
            user_id=UUID(data["user_id"]),
            balance=int(data["balance"]) if "balance" in data else None,
            tx_id=UUID(data["tx_id"]) if "tx_id" in data else None,
            amount=int(data["amount"]) if "amount" in data else None,
            counterparty_id=UUID(data["counterparty_id"]) if "counterparty_id" in data else None,
            tx_type=data.get("tx_type"),
        )

    def to_client_dict(self) -> dict:
        return self.model_dump(mode="json", exclude_none=True)
