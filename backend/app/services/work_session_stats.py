"""Zentrale Berechnungslogik für WorkSession-basierte Arbeitszeiten.

Offizielle Arbeitszeit = approved + corrected.
Pending/rejected zählen NICHT als offizielle Stunden.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.work_session import WorkSession

_BERLIN = ZoneInfo("Europe/Berlin")


def current_berlin_month_bounds_utc() -> tuple[datetime, datetime]:
    """Erster Moment des Monats in Berlin bis erster Moment des Folgemonats — als aware UTC."""
    from datetime import UTC

    now = datetime.now(_BERLIN)
    y, m = now.year, now.month
    start_local = datetime(y, m, 1, 0, 0, 0, tzinfo=_BERLIN)
    if m == 12:
        end_local = datetime(y + 1, 1, 1, 0, 0, 0, tzinfo=_BERLIN)
    else:
        end_local = datetime(y, m + 1, 1, 0, 0, 0, tzinfo=_BERLIN)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def month_hours_summary_by_employee(db: Session) -> dict[int, dict[str, float]]:
    """
    Pro Mitarbeiter: genehmigte + korrigierte Stunden im laufenden Berlin-Monat,
    sowie ausstehende (pending) Stunden im gleichen Fenster.
    """
    start_utc, end_utc = current_berlin_month_bounds_utc()
    stmt = (
        select(
            WorkSession.employee_id,
            func.coalesce(
                func.sum(
                    case(
                        (
                            WorkSession.status.in_(("approved", "corrected")),
                            WorkSession.duration_seconds,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("off_sec"),
            func.coalesce(
                func.sum(
                    case((WorkSession.status == "pending", WorkSession.duration_seconds), else_=0),
                ),
                0,
            ).label("pend_sec"),
        )
        .where(WorkSession.checkin_time >= start_utc)
        .where(WorkSession.checkin_time < end_utc)
        .group_by(WorkSession.employee_id)
    )
    out: dict[int, dict[str, float]] = {}
    for row in db.execute(stmt):
        out[row.employee_id] = {
            "official_hours": round(row.off_sec / 3600, 2),
            "pending_hours": round(row.pend_sec / 3600, 2),
        }
    return out


def get_employee_month_ws_stats(db: Session, employee_id: int) -> dict[str, float]:
    """Genehmigte + korrigierte bzw. ausstehende Stunden im laufenden Berlin-Monat für einen Mitarbeiter."""
    start_utc, end_utc = current_berlin_month_bounds_utc()
    stmt = (
        select(
            func.coalesce(
                func.sum(
                    case(
                        (
                            WorkSession.status.in_(("approved", "corrected")),
                            WorkSession.duration_seconds,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("off_sec"),
            func.coalesce(
                func.sum(
                    case((WorkSession.status == "pending", WorkSession.duration_seconds), else_=0),
                ),
                0,
            ).label("pend_sec"),
        )
        .where(WorkSession.employee_id == employee_id)
        .where(WorkSession.checkin_time >= start_utc)
        .where(WorkSession.checkin_time < end_utc)
    )
    row = db.execute(stmt).one()
    off_sec = int(row.off_sec or 0)
    pend_sec = int(row.pend_sec or 0)
    return {
        "official_hours": round(off_sec / 3600, 2),
        "pending_hours": round(pend_sec / 3600, 2),
        "official_seconds": off_sec,
        "pending_seconds": pend_sec,
    }


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
    """Globale WorkSession-Statistiken über alle Mitarbeiter, laufender Berlin-Monat."""
    start_utc, end_utc = current_berlin_month_bounds_utc()
    sessions = db.scalars(
        select(WorkSession)
        .where(WorkSession.checkin_time >= start_utc)
        .where(WorkSession.checkin_time < end_utc)
    ).all()

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
