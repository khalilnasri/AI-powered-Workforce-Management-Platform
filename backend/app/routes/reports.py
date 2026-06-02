"""
Admin Report-Modul: Arbeitszeiten filtern, auswerten und als CSV exportieren.

GET /admin/reports/attendance        → JSON
GET /admin/reports/attendance.csv    → CSV-Download
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.work_session import WorkSession
from app.schemas.admin import (
    AttendanceReportResponse,
    EmployeeReportRow,
    ReportSession,
)
from app.services.work_session_stats import get_ws_status_by_checkin_id

router = APIRouter(prefix="/admin/reports", tags=["reports"])


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def _ensure_utc(dt: datetime) -> datetime:
    """Stellt sicher, dass ein datetime timezone-aware (UTC) ist."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _parse_date(date_str: str, end_of_day: bool = False) -> datetime:
    """
    Wandelt 'YYYY-MM-DD' in ein UTC-datetime um.
    end_of_day=True → 23:59:59 desselben Tages (inklusiv).
    """
    try:
        dt = datetime.fromisoformat(date_str).replace(tzinfo=UTC)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ungültiges Datumsformat: '{date_str}'. Erwartet: YYYY-MM-DD",
        )
    if end_of_day:
        dt = dt + timedelta(days=1) - timedelta(seconds=1)
    return dt


def _build_sessions(
    logs: list[Attendance],
    ws_by_checkin_id: dict[int, str] | None = None,
) -> tuple[list[ReportSession], int]:
    """
    Paart checkin/checkout Zeilen zu Schichten.
    ws_by_checkin_id: checkin_log_id → work_session_status (optional).
    """
    now = datetime.now(UTC)
    sessions: list[ReportSession] = []
    total_seconds = 0
    pending_checkin: datetime | None = None
    pending_checkin_id: int | None = None

    for log in logs:
        if log.log_type == "checkin":
            pending_checkin = _ensure_utc(log.created_at)
            pending_checkin_id = log.id
        elif log.log_type == "checkout" and pending_checkin is not None:
            checkout_at = _ensure_utc(log.created_at)
            secs = max(0, int((checkout_at - pending_checkin).total_seconds()))
            total_seconds += secs
            ws_status = (ws_by_checkin_id or {}).get(pending_checkin_id) if pending_checkin_id else None
            sessions.append(ReportSession(
                checkin=pending_checkin,
                checkout=checkout_at,
                duration_seconds=secs,
                duration_hours=round(secs / 3600, 2),
                status="closed",
                work_session_status=ws_status,
            ))
            pending_checkin = None
            pending_checkin_id = None

    # Offene Schicht (noch eingestempelt)
    if pending_checkin is not None:
        secs = max(0, int((now - pending_checkin).total_seconds()))
        total_seconds += secs
        ws_status = (ws_by_checkin_id or {}).get(pending_checkin_id) if pending_checkin_id else None
        sessions.append(ReportSession(
            checkin=pending_checkin,
            checkout=None,
            duration_seconds=secs,
            duration_hours=round(secs / 3600, 2),
            status="open",
            work_session_status=ws_status,
        ))

    return sessions, total_seconds


def _load_report_data(
    db: Session,
    employee_id: int | None,
    start_date: str | None,
    end_date: str | None,
) -> AttendanceReportResponse:
    """
    Kernlogik: Lädt Attendance-Logs, filtert nach Datum und Employee,
    paart Schichten und berechnet Gesamtzeiten.
    Offizielle Stunden = WorkSessions mit status 'approved' oder 'corrected'.
    """
    # Mitarbeiter laden (alle oder einen bestimmten)
    emp_stmt = select(Employee).order_by(Employee.id)
    if employee_id is not None:
        emp_stmt = emp_stmt.where(Employee.id == employee_id)
    employees = db.scalars(emp_stmt).all()

    if employee_id is not None and not employees:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mitarbeiter nicht gefunden.")

    # Datumsgrenzen berechnen
    start_dt = _parse_date(start_date) if start_date else None
    end_dt = _parse_date(end_date, end_of_day=True) if end_date else None

    # Alle WorkSessions vorladen (für approved_hours + work_session_status)
    ws_stmt = select(WorkSession)
    if employee_id is not None:
        ws_stmt = ws_stmt.where(WorkSession.employee_id == employee_id)
    if start_dt:
        ws_stmt = ws_stmt.where(WorkSession.checkin_time >= start_dt)
    if end_dt:
        ws_stmt = ws_stmt.where(WorkSession.checkin_time <= end_dt)

    approved_secs_by_emp: dict[int, int] = {}
    # checkin_log_id → status (für alle Mitarbeiter in diesem Report)
    ws_status_by_checkin_id: dict[int, str] = {}
    for ws in db.scalars(ws_stmt).all():
        if ws.status in ("approved", "corrected"):
            approved_secs_by_emp[ws.employee_id] = (
                approved_secs_by_emp.get(ws.employee_id, 0) + ws.duration_seconds
            )
        if ws.checkin_log_id is not None:
            ws_status_by_checkin_id[ws.checkin_log_id] = ws.status

    employee_rows: list[EmployeeReportRow] = []

    for emp in employees:
        # Attendance-Logs für diesen Mitarbeiter laden (chronologisch)
        att_stmt = (
            select(Attendance)
            .where(Attendance.employee_id == emp.id)
            .order_by(Attendance.created_at.asc(), Attendance.id.asc())
        )
        if start_dt:
            att_stmt = att_stmt.where(Attendance.created_at >= start_dt)
        if end_dt:
            att_stmt = att_stmt.where(Attendance.created_at <= end_dt)

        logs = list(db.scalars(att_stmt).all())
        sessions, total_seconds = _build_sessions(logs, ws_status_by_checkin_id)

        approved_secs = approved_secs_by_emp.get(emp.id, 0)

        employee_rows.append(EmployeeReportRow(
            employee_id=emp.id,
            employee_name=emp.name,
            employee_email=emp.email,
            total_seconds=total_seconds,
            total_hours=round(total_seconds / 3600, 2),
            sessions=sessions,
            approved_seconds=approved_secs,
            approved_hours=round(approved_secs / 3600, 2),
        ))

    grand_total_seconds   = sum(r.total_seconds for r in employee_rows)
    approved_total_seconds = sum(r.approved_seconds for r in employee_rows)
    session_count = sum(len(r.sessions) for r in employee_rows)

    return AttendanceReportResponse(
        employees=employee_rows,
        total_seconds=grand_total_seconds,
        total_hours=round(grand_total_seconds / 3600, 2),
        session_count=session_count,
        start_date=start_date,
        end_date=end_date,
        approved_total_seconds=approved_total_seconds,
        approved_total_hours=round(approved_total_seconds / 3600, 2),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/attendance", response_model=AttendanceReportResponse)
def attendance_report(
    employee_id: int | None = Query(default=None, description="Nur diesen Mitarbeiter auswerten"),
    start_date: str | None = Query(default=None, description="Startdatum YYYY-MM-DD"),
    end_date: str | None = Query(default=None, description="Enddatum YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """
    JSON-Report: Arbeitszeiten aller (oder eines) Mitarbeiter(s), optional nach Datum gefiltert.
    """
    return _load_report_data(db, employee_id, start_date, end_date)


@router.get("/attendance.csv")
def attendance_report_csv(
    employee_id: int | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """
    CSV-Export: Jede Schicht als eigene Zeile.

    Spalten: Mitarbeiter, E-Mail, Check-in, Check-out, Dauer (Std.), Status
    """
    report = _load_report_data(db, employee_id, start_date, end_date)

    # CSV in-memory aufbauen
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")

    # Kopfzeile
    writer.writerow(["Mitarbeiter", "E-Mail", "Check-in", "Check-out", "Dauer (Std.)", "Status", "Genehmigung"])

    _approval_labels = {
        "approved":  "Genehmigt",
        "corrected": "Korrigiert",
        "rejected":  "Abgelehnt",
        "pending":   "Ausstehend",
    }

    for emp_row in report.employees:
        if not emp_row.sessions:
            writer.writerow([emp_row.employee_name, emp_row.employee_email, "", "", "", "", ""])
            continue
        for session in emp_row.sessions:
            checkin_str = session.checkin.strftime("%d.%m.%Y %H:%M:%S")
            checkout_str = session.checkout.strftime("%d.%m.%Y %H:%M:%S") if session.checkout else "noch offen"
            approval_label = _approval_labels.get(session.work_session_status or "", "—")
            writer.writerow([
                emp_row.employee_name,
                emp_row.employee_email,
                checkin_str,
                checkout_str,
                str(session.duration_hours).replace(".", ","),
                "offen" if session.status == "open" else "geschlossen",
                approval_label,
            ])

    # Dateiname mit Zeitstempel
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"time_stemple_report_{now_str}.csv"

    # Bytes mit BOM für Excel-Kompatibilität
    csv_bytes = ("\ufeff" + output.getvalue()).encode("utf-8")

    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
