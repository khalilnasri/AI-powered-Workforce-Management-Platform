"""Erzeugt In-App-Benachrichtigungen für Mitarbeiter (Admin-Aktionen)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.notification import Notification

_BODY_MAX_LEN = 1000


def _truncate(text: str | None, max_len: int = _BODY_MAX_LEN) -> str | None:
    if text is None:
        return None
    s = text.strip()
    if not s:
        return None
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def create_notification(
    db: Session,
    *,
    employee_id: int,
    type: str,
    title: str,
    body: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    actor_id: int | None = None,
) -> Notification:
    """
    Legt eine Notification an (nur ``db.add`` — kein eigener Commit).

    Der Aufrufer committet ohnehin bereits die auslösende Aktion (z.B. Session
    genehmigen); die Notification hängt an genau diesem Commit, damit nie eine
    Benachrichtigung ohne die zugehörige State-Änderung persistiert wird.
    """
    notification = Notification(
        employee_id=employee_id,
        type=type,
        title=title.strip()[:200],
        body=_truncate(body),
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
    )
    db.add(notification)
    return notification
