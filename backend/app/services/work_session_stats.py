"""Zentrale Berechnungslogik für WorkSession-basierte Arbeitszeiten.

Offizielle Arbeitszeit = approved + corrected.
Pending/rejected zählen NICHT als offizielle Stunden.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.work_session import WorkSession


def get_employee_session_stats(db: Session, employee_id: int) -> dict:
    """WorkSession-Statistiken für einen einzelnen Mitarbeiter."""
    sessions = db.scalars(
        select(WorkSession).where(WorkSession.employee_id == employee_id)
    ).all()

    official_seconds = 0
    pending_seconds = 0
    pending_count = 0
    rejected_seconds = 0

    for s in sessions:
        if s.status in ("approved", "corrected"):
            official_seconds += s.duration_seconds
        elif s.status == "pending":
            pending_seconds += s.duration_seconds
            pending_count += 1
        elif s.status == "rejected":
            rejected_seconds += s.duration_seconds

    return {
        "official_seconds": official_seconds,
        "official_hours": round(official_seconds / 3600, 2),
        "pending_seconds": pending_seconds,
        "pending_hours": round(pending_seconds / 3600, 2),
        "pending_count": pending_count,
        "rejected_seconds": rejected_seconds,
        "rejected_hours": round(rejected_seconds / 3600, 2),
    }


def get_global_session_stats(db: Session) -> dict:
    """Globale WorkSession-Statistiken über alle Mitarbeiter."""
    sessions = db.scalars(select(WorkSession)).all()

    official_seconds = 0
    pending_seconds = 0
    pending_count = 0

    for s in sessions:
        if s.status in ("approved", "corrected"):
            official_seconds += s.duration_seconds
        elif s.status == "pending":
            pending_seconds += s.duration_seconds
            pending_count += 1

    return {
        "official_seconds": official_seconds,
        "official_hours": round(official_seconds / 3600, 2),
        "pending_seconds": pending_seconds,
        "pending_hours": round(pending_seconds / 3600, 2),
        "pending_count": pending_count,
    }


def get_ws_status_by_checkin_id(db: Session, employee_id: int | None = None) -> dict[int, str]:
    """
    Gibt ein Dict zurück: checkin_log_id → work_session_status.
    Wird in Reports genutzt, um jeder Schicht den Genehmigungsstatus zuzuordnen.
    """
    stmt = select(WorkSession.checkin_log_id, WorkSession.status).where(
        WorkSession.checkin_log_id.isnot(None)
    )
    if employee_id is not None:
        stmt = stmt.where(WorkSession.employee_id == employee_id)
    rows = db.execute(stmt).all()
    return {row.checkin_log_id: row.status for row in rows}
