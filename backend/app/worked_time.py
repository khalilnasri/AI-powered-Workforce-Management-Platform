"""Pair check-in/checkout rows chronologically and sum worked durations per employee."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.attendance import Attendance


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _duration_seconds(start: datetime, end: datetime) -> int:
    secs = int((end - start).total_seconds())
    return max(0, secs)


def compute_worked_time_payload(db: Session, employee_id: int) -> dict[str, Any]:
    stmt = (
        select(Attendance)
        .where(Attendance.employee_id == employee_id)
        .order_by(Attendance.created_at.asc(), Attendance.id.asc())
    )
    rows = list(db.scalars(stmt).all())

    now = datetime.now(UTC)
    pending_checkin_at: datetime | None = None
    sessions_out: list[dict[str, Any]] = []
    total_seconds = 0

    for row in rows:
        if row.log_type == "checkin":
            pending_checkin_at = _ensure_utc(row.created_at)
        elif row.log_type == "checkout":
            check_out_at = _ensure_utc(row.created_at)
            if pending_checkin_at is not None:
                seg = _duration_seconds(pending_checkin_at, check_out_at)
                total_seconds += seg
                sessions_out.append(
                    {
                        "checkin": pending_checkin_at,
                        "checkout": check_out_at,
                        "duration_seconds": seg,
                    }
                )
                pending_checkin_at = None

    active = pending_checkin_at is not None
    if active and pending_checkin_at is not None:
        seg = _duration_seconds(pending_checkin_at, now)
        total_seconds += seg
        sessions_out.append(
            {
                "checkin": pending_checkin_at,
                "checkout": None,
                "duration_seconds": seg,
            }
        )

    total_hours = round(total_seconds / 3600.0, 2)

    return {
        "total_seconds": total_seconds,
        "total_hours": total_hours,
        "active": active,
        "sessions": sessions_out,
        "active_checkin_at": pending_checkin_at if active else None,
    }
