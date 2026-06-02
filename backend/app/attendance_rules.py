from __future__ import annotations

from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.attendance import Attendance
from app.schemas.attendance import AttendanceStatusResponse


def fetch_latest_attendance(db: Session, employee_id: int) -> Attendance | None:
    stmt = (
        select(Attendance)
        .where(Attendance.employee_id == employee_id)
        .order_by(Attendance.created_at.desc(), Attendance.id.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def build_attendance_status(db: Session, employee_id: int) -> AttendanceStatusResponse:
    latest = fetch_latest_attendance(db, employee_id)
    last_type = latest.log_type if latest else None

    if last_type == "checkin":
        lifecycle: str = "checked_in"
    else:
        lifecycle = "checked_out"

    can_checkin = last_type != "checkin"
    can_checkout = last_type == "checkin"

    message = _explain_status(last_type=last_type, lifecycle=lifecycle)

    return AttendanceStatusResponse(
        status=lifecycle,
        last_type=last_type,
        can_checkin=can_checkin,
        can_checkout=can_checkout,
        message=message,
    )


def _explain_status(*, last_type: str | None, lifecycle: str) -> str:
    if last_type is None:
        return "Checked out — no punches recorded yet. Start with Check In."

    if lifecycle == "checked_in":
        return "Checked in — Check Out ends this visit. Both actions can repeat in the same day."

    return "Checked out — you can Check In again for another visit whenever you arrive."


def action_error_response(message: str) -> JSONResponse:
    """Same JSON shape as geofencing errors so the frontend can handle them consistently."""
    return JSONResponse(status_code=400, content={"status": "error", "message": message})


def validate_checkin_allowed(db: Session, employee_id: int) -> JSONResponse | None:
    latest = fetch_latest_attendance(db, employee_id)
    if latest is not None and latest.log_type == "checkin":
        return action_error_response(
            "Cannot check in twice in a row — check out first before the next check-in.",
        )

    return None


def validate_checkout_allowed(db: Session, employee_id: int) -> JSONResponse | None:
    latest = fetch_latest_attendance(db, employee_id)

    if latest is None:
        return action_error_response(
            "Cannot check out yet — check in first to start a visit.",
        )

    if latest.log_type != "checkin":
        return action_error_response(
            "Cannot check out twice in a row — check in first.",
        )

    return None
