import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
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
from app.models.employee_work_location import EmployeeWorkLocation
from app.models.location import WorkplaceLocation
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
from app.services.employment_hours import resolved_month_target_hours
from app.services.work_session_stats import get_employee_month_ws_stats, get_employee_session_stats
from app.utils.distance import haversine_meters
from app.worked_time import compute_worked_time_payload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _auto_assign_location(
    db: Session,
    employee: Employee,
    lat: float,
    lng: float,
) -> None:
    """
    Erkennt beim ersten Check-in automatisch den Standort anhand der GPS-Koordinaten
    und speichert ihn in employee_work_locations — nur wenn noch keine Zuweisung vorhanden.
    Fehler werden geloggt aber nicht weitergegeben (Check-in soll nie daran scheitern).
    """
    try:
        # Prüfen ob bereits eine Zuweisung existiert (M2M oder legacy)
        has_m2m = db.scalars(
            select(EmployeeWorkLocation)
            .where(EmployeeWorkLocation.employee_id == employee.id)
            .limit(1)
        ).first()
        if has_m2m or employee.assigned_location_id:
            return  # Bereits zugewiesen → nichts tun

        # Alle Standorte laden und GPS-Treffer suchen (nächster innerhalb Radius)
        all_locs = db.scalars(select(WorkplaceLocation)).all()
        best_loc = None
        best_dist = float("inf")
        for loc in all_locs:
            dist = haversine_meters(lat, lng, loc.lat, loc.lng)
            if dist <= float(loc.radius_meters) and dist < best_dist:
                best_dist = dist
                best_loc = loc

        if best_loc is None:
            return  # GPS liegt in keinem Standort → keine Zuweisung

        # Zuweisung speichern
        new_assignment = EmployeeWorkLocation(
            employee_id=employee.id,
            location_id=best_loc.id,
        )
        db.add(new_assignment)
        db.commit()
        logger.info(
            "Auto-Zuweisung: Mitarbeiter %s (%d) → Standort '%s' (%d), Distanz %.0f m",
            employee.name, employee.id, best_loc.name, best_loc.id, best_dist,
        )
    except Exception:
        db.rollback()
        logger.warning("Auto-Zuweisung fehlgeschlagen für Mitarbeiter %d", employee.id, exc_info=True)


def _check_location_assignment(
    db: Session,
    lat: float,
    lng: float,
    employee: Employee,
) -> JSONResponse | None:
    """
    Wenn dem Mitarbeiter Standorte zugewiesen sind, prüft ob GPS zu einem
    dieser Standorte passt. Gibt None zurück wenn erlaubt, sonst 403-Response.
    Ohne Zuweisung wird keine Einschränkung geprüft (Fallback auf Geofence).
    """
    assigned_ids: list[int] = [
        r.location_id
        for r in db.scalars(
            select(EmployeeWorkLocation)
            .where(EmployeeWorkLocation.employee_id == employee.id)
        ).all()
    ]
    if not assigned_ids and employee.assigned_location_id:
        assigned_ids = [employee.assigned_location_id]

    if not assigned_ids:
        return None  # Keine Zuweisung → kein Zusatz-Check

    assigned_locs = db.scalars(
        select(WorkplaceLocation).where(WorkplaceLocation.id.in_(assigned_ids))
    ).all()

    for loc in assigned_locs:
        if haversine_meters(lat, lng, loc.lat, loc.lng) <= float(loc.radius_meters):
            return None  # GPS liegt in einem zugewiesenen Standort → OK

    return JSONResponse(
        status_code=403,
        content={
            "status": "error",
            "message": "Du bist nicht für diesen Standort freigegeben.",
        },
    )


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
    month_ws = get_employee_month_ws_stats(db, current_employee.id)
    month_target = resolved_month_target_hours(current_employee)
    return WorkedTimeResponse(
        **data,
        official_seconds=ws_stats["official_seconds"],
        official_hours=ws_stats["official_hours"],
        pending_seconds=ws_stats["pending_seconds"],
        pending_hours=ws_stats["pending_hours"],
        pending_count=ws_stats["pending_count"],
        month_target_hours=month_target,
        official_hours_month=month_ws["official_hours"],
        pending_hours_month=month_ws["pending_hours"],
        official_seconds_month=month_ws["official_seconds"],
        pending_seconds_month=month_ws["pending_seconds"],
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

    # Original-Attendance-Logs für korrigierte Sessions in einer Abfrage laden
    att_log_ids: list[int] = []
    for s in sessions:
        if s.status == "corrected":
            if s.checkin_log_id:
                att_log_ids.append(s.checkin_log_id)
            if s.checkout_log_id:
                att_log_ids.append(s.checkout_log_id)
    att_map: dict[int, Attendance] = {}
    if att_log_ids:
        for att in db.scalars(select(Attendance).where(Attendance.id.in_(att_log_ids))).all():
            att_map[att.id] = att

    result = []
    for s in sessions:
        original_checkin_time  = None
        original_checkout_time = None
        if s.status == "corrected":
            if s.checkin_log_id and s.checkin_log_id in att_map:
                original_checkin_time = att_map[s.checkin_log_id].created_at
            if s.checkout_log_id and s.checkout_log_id in att_map:
                original_checkout_time = att_map[s.checkout_log_id].created_at

        result.append(WorkSessionResponse(
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
            original_checkin_time=original_checkin_time,
            original_checkout_time=original_checkout_time,
            created_at=s.created_at,
            updated_at=s.updated_at,
        ))
    return result


@router.post("/checkin", response_model=CheckInResponse)
def check_in(
    body: CheckInRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    blocked = geofence_block_response(db, body.lat, body.lng, current_employee)
    if blocked is not None:
        return blocked

    assignment_blocked = _check_location_assignment(db, body.lat, body.lng, current_employee)
    if assignment_blocked is not None:
        return assignment_blocked

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

    # Auto-Zuweisung: Hat Mitarbeiter noch keinen Standort → GPS-Treffer speichern
    _auto_assign_location(db, current_employee, body.lat, body.lng)

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

    assignment_blocked = _check_location_assignment(db, body.lat, body.lng, current_employee)
    if assignment_blocked is not None:
        return assignment_blocked

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
