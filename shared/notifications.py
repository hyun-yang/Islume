"""Durable notification helper.

add_notification only stages a row on the session (db.add) — it never commits
and never publishes. Call sites must insert the row in the SAME transaction as
the state change it describes, commit, and only then publish_user_event. This
preserves the commit-before-publish invariant: a live toast must never refer
to a row that doesn't exist yet.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Notification


def add_notification(
    db: AsyncSession,
    user_id: UUID,
    type: str,
    payload: dict,
    session_id: UUID | None = None,
) -> Notification:
    row = Notification(
        user_id=user_id,
        type=type,
        session_id=session_id,
        payload=payload,
    )
    db.add(row)
    return row
