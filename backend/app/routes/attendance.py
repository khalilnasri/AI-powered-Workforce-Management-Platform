import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.attendance_rules import (
    build_attendance_status,
    validate_checkin_allowed,
    validate_checkout_allowed,
)
from app.auth.deps import get_current_employee
from app.config.database import get_db
from app.geofence import geofence_block_response
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.work_session import WorkSession
from app.schemas.attendance import (
    AttendanceLogEntry,
    AttendanceStatusResponse,
    CheckInRequest,
    CheckInResponse,
    CheckoutResponse,
    WorkedTimeResponse,
)
from app.schemas.approvals import WorkSessionResponse
from app.services.work_session_stats import get_employee_session_stats
from app.worked_time import compute_worked_time_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


@router.get("/status", response_model=AttendanceStatusResponse)
def attendance_status(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    return build_attendance_status(db, current_employee.id)


@router.get("/worked-time", response_model=WorkedTimeResponse)
def worked_time_summary(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    data = compute_worked_time_payload(db, current_employee.id)
    ws_stats = get_employee_session_stats(db, current_employee.id)
    return WorkedTimeResponse(
        **data,
        official_seconds=ws_stats["official_seconds"],
        official_hours=ws_stats["official_hours"],
        pending_seconds=ws_stats["pending_seconds"],
        pending_hours=ws_stats["pending_hours"],
        pending_count=ws_stats["pending_count"],
    )


@router.get("/logs", response_model=list[AttendanceLogEntry])
def list_attendance_logs(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    stmt = (
        select(Attendance)
        .where(Attendance.employee_id == current_employee.id)
        .order_by(Attendance.created_at.desc())
        .limit(20)
    )
    rows = db.scalars(stmt).all()
    return [
        AttendanceLogEntry(
            id=row.id,
            type=row.log_type,
            lat=row.lat,
            lng=row.lng,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/my-sessions", response_model=list[WorkSessionResponse])
def my_sessions(
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    """Eigene WorkSessions des eingeloggten Mitarbeiters (mit Genehmigungsstatus)."""
    sessions = db.scalars(
        select(WorkSession)
        .where(WorkSession.employee_id == current_employee.id)
        .order_by(WorkSession.checkin_time.desc())
        .limit(50)
    ).all()
    return [
        WorkSessionResponse(
            id=s.id,
            employee_id=s.employee_id,
            checkin_log_id=s.checkin_log_id,
            checkout_log_id=s.checkout_log_id,
            checkin_time=s.checkin_time,
            checkout_time=s.checkout_time,
            duration_seconds=s.duration_seconds,
            status=s.status,
            approved_by_id=s.approved_by_id,
            approved_at=s.approved_at,
            rejection_reason=s.rejection_reason,
            admin_note=s.admin_note,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in sessions
    ]


@router.post("/checkin", response_model=CheckInResponse)
def check_in(
    body: CheckInRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    blocked = geofence_block_response(db, body.lat, body.lng, current_employee)
    if blocked is not None:
        return blocked

    denied_checkin = validate_checkin_allowed(db, current_employee.id)
    if denied_checkin is not None:
        return denied_checkin

    entry = Attendance(
        employee_id=current_employee.id,
        lat=body.lat,
        lng=body.lng,
    )
    try:
        db.add(entry)
        db.commit()
        db.refresh(entry)
    except Exception:
        db.rollback()
        raise

    return CheckInResponse(
        status="success",
        message="Check-in received",
        id=entry.id,
        lat=entry.lat,
        lng=entry.lng,
        created_at=entry.created_at,
    )


@router.post("/checkout", response_model=CheckoutResponse)
def check_out(
    body: CheckInRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    blocked = geofence_block_response(db, body.lat, body.lng, current_employee)
    if blocked is not None:
        return blocked

    denied_checkout = validate_checkout_allowed(db, current_employee.id)
    if denied_checkout is not None:
        return denied_checkout

    entry = Attendance(
        employee_id=current_employee.id,
        log_type="checkout",
        lat=body.lat,
        lng=body.lng,
    )
    try:
        db.add(entry)
        db.commit()
        db.refresh(entry)
    except Exception:
        db.rollback()
        raise

    # WorkSession automatisch erstellen (Fehler blocken nicht den Checkout)
    try:
        last_checkin = db.scalars(
            select(Attendance)
            .where(Attendance.employee_id == current_employee.id)
            .where(Attendance.log_type == "checkin")
            .order_by(Attendance.created_at.desc())
            .limit(1)
        ).first()

        if last_checkin is not None:
            checkin_time  = _ensure_utc(last_checkin.created_at)
            checkout_time = _ensure_utc(entry.created_at)
            duration      = max(0, int((checkout_time - checkin_time).total_seconds()))

            ws = WorkSession(
                employee_id=current_employee.id,
                checkin_log_id=last_checkin.id,
                checkout_log_id=entry.id,
                checkin_time=checkin_time,
                checkout_time=checkout_time,
                duration_seconds=duration,
                status="pending",
                updated_at=datetime.now(UTC),
            )
            db.add(ws)
            db.commit()
    except Exception:
        db.rollback()
        logger.warning("WorkSession-Erstellung nach Checkout fehlgeschlagen.", exc_info=True)

    return CheckoutResponse(
        status="success",
        message="Check-out saved",
        id=entry.id,
        type="checkout",
        lat=entry.lat,
        lng=entry.lng,
        created_at=entry.created_at,
    )
