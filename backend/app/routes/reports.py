"""
Admin Report-Modul: Arbeitszeiten filtern, auswerten und als CSV/Excel exportieren.

GET /admin/reports/attendance        → JSON
GET /admin/reports/attendance.csv    → CSV-Download
GET /admin/reports/summary           → Chart-Daten (KPIs pro Standort/Monat/Mitarbeiter)
GET /admin/reports/excel             → Excel-Download (.xlsx, 4 Sheets)
"""

from __future__ import annotations

import csv
import io
import logging
import traceback
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.auth.admin_deps import require_admin
from app.config.database import get_db
from app.models.attendance import Attendance
from app.models.employee import Employee
from app.models.employee_work_location import EmployeeWorkLocation
from app.models.location import WorkplaceLocation
from app.models.work_session import WorkSession
from app.schemas.admin import (
    AttendanceReportResponse,
    EmployeeReportRow,
    EmployeeSollIstItem,
    LocationHoursItem,
    MonthlyHoursItem,
    ReportSession,
    ReportSummaryResponse,
    ReportV2EmployeeRow,
    ReportV2KPIs,
    ReportV2LocationRow,
    ReportV2PeriodSummary,
    ReportV2Response,
    ReportV2SessionRow,
    ReportV2TrendRow,
    StatusDistributionItem,
)
from app.services.employment_hours import resolved_month_target_hours
from app.services.work_session_stats import get_ws_status_by_checkin_id

router = APIRouter(prefix="/admin/reports", tags=["reports"])

_BERLIN = ZoneInfo("Europe/Berlin")
_WEEKDAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


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


# ── Summary (Chart-Daten) ─────────────────────────────────────────────────────

def _month_bounds_utc(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, 0, 0, 0, tzinfo=_BERLIN)
    if month == 12:
        end = datetime(year + 1, 1, 1, 0, 0, 0, tzinfo=_BERLIN)
    else:
        end = datetime(year, month + 1, 1, 0, 0, 0, tzinfo=_BERLIN)
    return start.astimezone(UTC), end.astimezone(UTC)


def _emp_ids_for_location(db: Session, location_id: int) -> set[int]:
    m2m = {
        r.employee_id
        for r in db.execute(
            select(EmployeeWorkLocation.employee_id).where(
                EmployeeWorkLocation.location_id == location_id
            )
        ).all()
    }
    legacy = {
        e.id
        for e in db.scalars(
            select(Employee).where(Employee.assigned_location_id == location_id)
        ).all()
    }
    return m2m | legacy


@router.get("/summary", response_model=ReportSummaryResponse)
def reports_summary(
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2020, le=2100),
    location_id: int | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    now_berlin = datetime.now(_BERLIN)
    target_year = year or now_berlin.year
    target_month = month or now_berlin.month

    # ── Mitarbeiter-Filter zusammenbauen ─────────────────────────────────────
    emp_ids: set[int] | None = None
    if location_id is not None:
        emp_ids = _emp_ids_for_location(db, location_id)
    if employee_id is not None:
        emp_ids = (emp_ids & {employee_id}) if emp_ids is not None else {employee_id}

    def _apply_emp_filter(stmt):
        if emp_ids is not None:
            return stmt.where(WorkSession.employee_id.in_(list(emp_ids) or [-1]))
        return stmt

    # ── Zeitgrenzen für soll_vs_ist / status_distribution ───────────────────
    start_utc, end_utc = _month_bounds_utc(target_year, target_month)

    # ── WorkSessions für den Zielmonat laden ─────────────────────────────────
    month_ws = db.scalars(
        _apply_emp_filter(
            select(WorkSession)
            .where(WorkSession.checkin_time >= start_utc)
            .where(WorkSession.checkin_time < end_utc)
        )
    ).all()

    # ── 1. Stunden pro Standort ───────────────────────────────────────────────
    loc_map = {loc.id: loc.name for loc in db.scalars(select(WorkplaceLocation)).all()}
    emp_to_loc: dict[int, str] = {}
    for row in db.execute(
        select(EmployeeWorkLocation.employee_id, EmployeeWorkLocation.location_id)
        .order_by(EmployeeWorkLocation.location_id)
    ).all():
        if row.employee_id not in emp_to_loc:
            emp_to_loc[row.employee_id] = loc_map.get(row.location_id, "Unbekannt")
    for emp in db.scalars(
        select(Employee).where(Employee.assigned_location_id.isnot(None))
    ).all():
        if emp.id not in emp_to_loc and emp.assigned_location_id:
            emp_to_loc[emp.id] = loc_map.get(emp.assigned_location_id, "Unbekannt")

    loc_hours: dict[str, float] = {}
    for ws in month_ws:
        if ws.status not in ("approved", "corrected"):
            continue
        loc_name = emp_to_loc.get(ws.employee_id, "Kein Standort")
        loc_hours[loc_name] = loc_hours.get(loc_name, 0.0) + ws.duration_seconds / 3600

    hours_by_location = sorted(
        [LocationHoursItem(location_name=k, official_hours=round(v, 2)) for k, v in loc_hours.items()],
        key=lambda x: x.official_hours,
        reverse=True,
    )

    # ── 2. Monatlicher Trend (letzte 6 Monate) ────────────────────────────────
    hours_by_month = []
    for i in range(5, -1, -1):
        m = now_berlin.month - i
        y = now_berlin.year
        while m < 1:
            m += 12
            y -= 1
        s_utc, e_utc = _month_bounds_utc(y, m)
        off_sec = db.scalar(
            _apply_emp_filter(
                select(
                    func.coalesce(
                        func.sum(
                            case(
                                (WorkSession.status.in_(("approved", "corrected")), WorkSession.duration_seconds),
                                else_=0,
                            )
                        ),
                        0,
                    )
                )
                .where(WorkSession.checkin_time >= s_utc)
                .where(WorkSession.checkin_time < e_utc)
            )
        ) or 0
        hours_by_month.append(
            MonthlyHoursItem(month=f"{y:04d}-{m:02d}", official_hours=round(off_sec / 3600, 2))
        )

    # ── 3. Soll vs. Ist pro Mitarbeiter ──────────────────────────────────────
    emp_stmt = select(Employee).order_by(Employee.name)
    if emp_ids is not None:
        emp_stmt = emp_stmt.where(Employee.id.in_(list(emp_ids) or [-1]))
    employees_list = db.scalars(emp_stmt).all()

    soll_vs_ist: list[EmployeeSollIstItem] = []
    for emp in employees_list:
        off_sec = db.scalar(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (WorkSession.status.in_(("approved", "corrected")), WorkSession.duration_seconds),
                            else_=0,
                        )
                    ),
                    0,
                )
            )
            .where(WorkSession.employee_id == emp.id)
            .where(WorkSession.checkin_time >= start_utc)
            .where(WorkSession.checkin_time < end_utc)
        ) or 0
        soll_vs_ist.append(
            EmployeeSollIstItem(
                employee_name=emp.name,
                target_hours=float(resolved_month_target_hours(emp)),
                official_hours=round(off_sec / 3600, 2),
            )
        )

    # ── 4. Status-Verteilung ──────────────────────────────────────────────────
    status_counts: dict[str, int] = {"approved": 0, "corrected": 0, "pending": 0, "rejected": 0}
    for ws in month_ws:
        if ws.status in status_counts:
            status_counts[ws.status] += 1

    return ReportSummaryResponse(
        hours_by_location=hours_by_location,
        hours_by_month=hours_by_month,
        soll_vs_ist=soll_vs_ist,
        status_distribution=StatusDistributionItem(**status_counts),
    )


# ── Excel-Export ──────────────────────────────────────────────────────────────

@router.get("/excel")
def reports_excel(
    month: int | None = Query(default=None, ge=1, le=12),
    year: int | None = Query(default=None, ge=2020, le=2100),
    location_id: int | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Excel-Export (.xlsx) mit 4 Sheets: Übersicht, Pro Mitarbeiter, Pro Standort, Details."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="openpyxl nicht installiert. Bitte 'pip install openpyxl' ausführen.",
        )

    now_berlin = datetime.now(_BERLIN)
    target_year = year or now_berlin.year
    target_month = month or now_berlin.month
    start_utc, end_utc = _month_bounds_utc(target_year, target_month)

    # ── Mitarbeiter-Filter ────────────────────────────────────────────────────
    emp_ids: set[int] | None = None
    if location_id is not None:
        emp_ids = _emp_ids_for_location(db, location_id)
    if employee_id is not None:
        emp_ids = (emp_ids & {employee_id}) if emp_ids is not None else {employee_id}

    emp_stmt = select(Employee).order_by(Employee.name)
    if emp_ids is not None:
        emp_stmt = emp_stmt.where(Employee.id.in_(list(emp_ids) or [-1]))
    employees_list = db.scalars(emp_stmt).all()

    # ── WorkSessions laden ────────────────────────────────────────────────────
    ws_stmt = (
        select(WorkSession)
        .where(WorkSession.checkin_time >= start_utc)
        .where(WorkSession.checkin_time < end_utc)
    )
    if emp_ids is not None:
        ws_stmt = ws_stmt.where(WorkSession.employee_id.in_(list(emp_ids) or [-1]))
    all_ws = db.scalars(ws_stmt).all()

    emp_name_map = {e.id: e.name for e in employees_list}
    emp_email_map = {e.id: e.email for e in employees_list}

    # ── Standort-Mapping ──────────────────────────────────────────────────────
    loc_map = {loc.id: loc.name for loc in db.scalars(select(WorkplaceLocation)).all()}
    emp_to_loc: dict[int, str] = {}
    for row in db.execute(
        select(EmployeeWorkLocation.employee_id, EmployeeWorkLocation.location_id)
        .order_by(EmployeeWorkLocation.location_id)
    ).all():
        if row.employee_id not in emp_to_loc:
            emp_to_loc[row.employee_id] = loc_map.get(row.location_id, "Unbekannt")
    for emp in employees_list:
        if emp.id not in emp_to_loc and emp.assigned_location_id:
            emp_to_loc[emp.id] = loc_map.get(emp.assigned_location_id, "Unbekannt")

    # ── openpyxl Styles ───────────────────────────────────────────────────────
    _HDR_FILL   = PatternFill("solid", fgColor="1E3A5F")
    _HDR_FONT   = Font(bold=True, color="FFFFFF", size=10)
    _GREEN_FILL = PatternFill("solid", fgColor="D1FAE5")
    _RED_FILL   = PatternFill("solid", fgColor="FEE2E2")
    _ORANGE_FILL= PatternFill("solid", fgColor="FEF3C7")
    _BLUE_FILL  = PatternFill("solid", fgColor="DBEAFE")
    _GRAY_FILL  = PatternFill("solid", fgColor="F1F5F9")

    def _header_row(ws_sheet, cols: list[str]) -> None:
        for ci, col in enumerate(cols, 1):
            cell = ws_sheet.cell(row=1, column=ci, value=col)
            cell.font = _HDR_FONT
            cell.fill = _HDR_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center")

    def _autofit(ws_sheet) -> None:
        for col in ws_sheet.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=0)
            ws_sheet.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 4, 50)

    _STATUS_LABEL = {
        "approved":  "Genehmigt",
        "corrected": "Korrigiert",
        "rejected":  "Abgelehnt",
        "pending":   "Ausstehend",
    }
    _STATUS_FILL = {
        "approved":  _GREEN_FILL,
        "corrected": _BLUE_FILL,
        "rejected":  _RED_FILL,
        "pending":   _ORANGE_FILL,
    }

    wb = Workbook()

    # ── Sheet 1: Übersicht ────────────────────────────────────────────────────
    ws1 = wb.active
    ws1.title = "Übersicht"
    period_label = f"{target_month:02d}/{target_year}"
    official_secs = sum(ws.duration_seconds for ws in all_ws if ws.status in ("approved", "corrected"))
    pending_secs  = sum(ws.duration_seconds for ws in all_ws if ws.status == "pending")
    ws1.append(["KPI", "Wert"])
    _header_row(ws1, ["KPI", "Wert"])
    ws1.append(["Zeitraum", period_label])
    ws1.append(["Mitarbeiter", len(employees_list)])
    ws1.append(["Sitzungen gesamt", len(all_ws)])
    ws1.append(["Offizielle Gesamtstunden", round(official_secs / 3600, 2)])
    ws1.append(["Ausstehende Stunden", round(pending_secs / 3600, 2)])
    ws1.freeze_panes = "A2"
    _autofit(ws1)

    # ── Sheet 2: Pro Mitarbeiter ──────────────────────────────────────────────
    ws2 = wb.create_sheet("Pro Mitarbeiter")
    cols2 = ["Mitarbeiter", "E-Mail", "Soll (h)", "Ist (h)", "Differenz (h)"]
    _header_row(ws2, cols2)
    ws2.freeze_panes = "A2"
    ws2.auto_filter.ref = f"A1:{get_column_letter(len(cols2))}1"

    total_target = 0.0
    total_official = 0.0
    for emp in employees_list:
        target_h = float(resolved_month_target_hours(emp))
        off_sec = sum(ws.duration_seconds for ws in all_ws if ws.employee_id == emp.id and ws.status in ("approved", "corrected"))
        off_h = round(off_sec / 3600, 2)
        diff = round(off_h - target_h, 2)
        row_idx = ws2.max_row + 1
        ws2.append([emp.name, emp.email, target_h, off_h, diff])
        fill = _GREEN_FILL if off_h >= target_h else _RED_FILL
        for ci in range(3, 6):
            ws2.cell(row=row_idx, column=ci).fill = fill
        total_target += target_h
        total_official += off_h

    # Summenzeile
    sum_row = ws2.max_row + 1
    ws2.append(["GESAMT", "", round(total_target, 2), round(total_official, 2), round(total_official - total_target, 2)])
    for ci in range(1, 6):
        ws2.cell(row=sum_row, column=ci).font = Font(bold=True)
    _autofit(ws2)

    # ── Sheet 3: Pro Standort ─────────────────────────────────────────────────
    ws3 = wb.create_sheet("Pro Standort")
    cols3 = ["Standort", "Offizielle Stunden", "Mitarbeiteranzahl"]
    _header_row(ws3, cols3)
    ws3.freeze_panes = "A2"
    ws3.auto_filter.ref = f"A1:{get_column_letter(len(cols3))}1"

    loc_agg: dict[str, dict] = {}
    for ws in all_ws:
        if ws.status not in ("approved", "corrected"):
            continue
        loc_name = emp_to_loc.get(ws.employee_id, "Kein Standort")
        if loc_name not in loc_agg:
            loc_agg[loc_name] = {"seconds": 0, "emp_ids": set()}
        loc_agg[loc_name]["seconds"] += ws.duration_seconds
        loc_agg[loc_name]["emp_ids"].add(ws.employee_id)

    for loc_name, data in sorted(loc_agg.items()):
        ws3.append([loc_name, round(data["seconds"] / 3600, 2), len(data["emp_ids"])])
    _autofit(ws3)

    # ── Sheet 4: Details ──────────────────────────────────────────────────────
    ws4 = wb.create_sheet("Details")
    cols4 = ["Mitarbeiter", "E-Mail", "Standort", "Check-in", "Check-out", "Dauer (h)", "Status", "Genehmigung"]
    _header_row(ws4, cols4)
    ws4.freeze_panes = "A2"
    ws4.auto_filter.ref = f"A1:{get_column_letter(len(cols4))}1"

    for ws in sorted(all_ws, key=lambda x: x.checkin_time):
        checkin_str  = ws.checkin_time.astimezone(_BERLIN).strftime("%d.%m.%Y %H:%M") if ws.checkin_time else ""
        checkout_str = ws.checkout_time.astimezone(_BERLIN).strftime("%d.%m.%Y %H:%M") if ws.checkout_time else "offen"
        loc_name     = emp_to_loc.get(ws.employee_id, "—")
        row_idx = ws4.max_row + 1
        ws4.append([
            emp_name_map.get(ws.employee_id, f"ID {ws.employee_id}"),
            emp_email_map.get(ws.employee_id, ""),
            loc_name,
            checkin_str,
            checkout_str,
            round(ws.duration_seconds / 3600, 2),
            ws.status,
            _STATUS_LABEL.get(ws.status, ws.status),
        ])
        fill = _STATUS_FILL.get(ws.status, _GRAY_FILL)
        for ci in range(1, 9):
            ws4.cell(row=row_idx, column=ci).fill = fill
    _autofit(ws4)

    # ── Datei in Memory speichern und streamen ────────────────────────────────
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"time_stemple_{target_year}_{target_month:02d}_{now_str}.xlsx"

    return StreamingResponse(
        iter([buf.read()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Report V2 – professionelles HR/Payroll-Reporting
# ═══════════════════════════════════════════════════════════════════════════════

def _build_v2_data(
    db: Session,
    employee_ids: list[int],
    location_ids: list[int],
    from_date: str,
    to_date: str,
    grouping: str,
) -> tuple[ReportV2Response, dict[int, str]]:
    """Returns (ReportV2Response, emp_email_map {id→email})."""
    try:
        from_d = date.fromisoformat(from_date)
        to_d   = date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Datumsformat ungültig (erwartet: YYYY-MM-DD).")
    if to_d < from_d:
        raise HTTPException(status_code=400, detail="to_date muss nach from_date liegen.")

    start_utc = datetime(from_d.year, from_d.month, from_d.day, tzinfo=_BERLIN).astimezone(UTC)
    end_utc   = (datetime(to_d.year, to_d.month, to_d.day, tzinfo=_BERLIN) + timedelta(days=1)).astimezone(UTC)

    all_emps: list[Employee] = db.scalars(
        select(Employee).where(Employee.is_active == True).order_by(Employee.name)
    ).all()
    emp_map: dict[int, Employee]  = {e.id: e for e in all_emps}
    emp_email_map: dict[int, str] = {e.id: e.email for e in all_emps}

    # Standort-Filter → zugehörige Mitarbeiter-IDs
    loc_emp_ids: set[int] | None = None
    if location_ids:
        loc_emp_ids = set()
        for lid in location_ids:
            loc_emp_ids |= _emp_ids_for_location(db, lid)

    if employee_ids and loc_emp_ids is not None:
        target_ids: set[int] = set(employee_ids) & loc_emp_ids
    elif employee_ids:
        target_ids = set(employee_ids)
    elif loc_emp_ids is not None:
        target_ids = loc_emp_ids
    else:
        target_ids = set(emp_map.keys())

    # Standort-Mapping
    loc_name_map: dict[int, str] = {
        loc.id: loc.name for loc in db.scalars(select(WorkplaceLocation)).all()
    }
    emp_to_loc: dict[int, str] = {}
    for row in db.execute(
        select(EmployeeWorkLocation.employee_id, EmployeeWorkLocation.location_id)
        .order_by(EmployeeWorkLocation.location_id)
    ).all():
        if row.employee_id not in emp_to_loc:
            emp_to_loc[row.employee_id] = loc_name_map.get(row.location_id, "Unbekannt")
    for e in all_emps:
        if e.id not in emp_to_loc and e.assigned_location_id:
            emp_to_loc[e.id] = loc_name_map.get(e.assigned_location_id, "Unbekannt")

    # WorkSessions laden
    safe_ids = list(target_ids) or [-1]
    ws_list: list[WorkSession] = db.scalars(
        select(WorkSession)
        .where(WorkSession.checkin_time >= start_utc)
        .where(WorkSession.checkin_time <  end_utc)
        .where(WorkSession.employee_id.in_(safe_ids))
        .order_by(WorkSession.checkin_time)
    ).all()

    # Session-Rows
    session_rows: list[ReportV2SessionRow] = []
    for ws in ws_list:
        emp = emp_map.get(ws.employee_id)
        if emp is None:
            continue
        ci_b    = ws.checkin_time.astimezone(_BERLIN)
        dur_min = ws.duration_seconds // 60
        session_rows.append(ReportV2SessionRow(
            employee_id=ws.employee_id,
            employee_name=emp.name,
            date=ci_b.date().isoformat(),
            weekday=_WEEKDAYS_DE[ci_b.weekday()],
            location_name=emp_to_loc.get(ws.employee_id, "Kein Standort"),
            checkin_time=ws.checkin_time,
            checkout_time=ws.checkout_time,
            break_minutes=0,
            work_minutes=dur_min,
            duration_minutes=dur_min,
            status=ws.status,
        ))

    # KPIs
    off_min  = sum(r.duration_minutes for r in session_rows if r.status in ("approved", "corrected"))
    pend_min = sum(r.duration_minutes for r in session_rows if r.status == "pending")
    tot_min  = sum(r.duration_minutes for r in session_rows)
    date_set = {r.date for r in session_rows}

    kpis = ReportV2KPIs(
        total_hours=round(tot_min / 60, 2),
        official_hours=round(off_min / 60, 2),
        pending_hours=round(pend_min / 60, 2),
        total_shifts=len(session_rows),
        location_count=len({r.location_name for r in session_rows}),
        work_days=len(date_set),
    )

    # Standort-Zusammenfassung
    loc_agg: dict[str, dict] = {}
    for r in session_rows:
        if r.location_name not in loc_agg:
            loc_agg[r.location_name] = {"cnt": 0, "min": 0}
        loc_agg[r.location_name]["cnt"] += 1
        loc_agg[r.location_name]["min"] += r.duration_minutes
    location_summary = sorted([
        ReportV2LocationRow(
            location_name=k,
            shift_count=v["cnt"],
            total_hours=round(v["min"] / 60, 2),
        ) for k, v in loc_agg.items()
    ], key=lambda x: x.total_hours, reverse=True)

    # Trend-Daten
    trend_agg: dict[str, dict] = {}
    for r in session_rows:
        ci_b = r.checkin_time.astimezone(_BERLIN)
        if grouping == "daily":
            key   = ci_b.strftime("%Y-%m-%d")
            label = ci_b.strftime("%d.%m.%Y")
        elif grouping == "weekly":
            iso   = ci_b.isocalendar()
            key   = f"{iso.year}-W{iso.week:02d}"
            label = f"KW {iso.week:02d}/{str(iso.year)[2:]}"
        else:
            key   = ci_b.strftime("%Y-%m")
            label = ci_b.strftime("%m/%Y")
        if key not in trend_agg:
            trend_agg[key] = {"label": label, "off": 0, "pend": 0}
        if r.status in ("approved", "corrected"):
            trend_agg[key]["off"]  += r.duration_minutes
        elif r.status == "pending":
            trend_agg[key]["pend"] += r.duration_minutes
    trend_data = [
        ReportV2TrendRow(
            period=k, period_label=v["label"],
            official_hours=round(v["off"] / 60, 2),
            pending_hours=round(v["pend"] / 60, 2),
        ) for k, v in sorted(trend_agg.items())
    ]

    # Mitarbeiter-Zusammenfassung
    emp_agg: dict[int, dict] = {}
    for r in session_rows:
        if r.employee_id not in emp_agg:
            emp_agg[r.employee_id] = {"name": r.employee_name, "off": 0, "pend": 0, "shifts": 0, "dates": set()}
        if r.status in ("approved", "corrected"):
            emp_agg[r.employee_id]["off"]  += r.duration_minutes
        elif r.status == "pending":
            emp_agg[r.employee_id]["pend"] += r.duration_minutes
        emp_agg[r.employee_id]["shifts"] += 1
        emp_agg[r.employee_id]["dates"].add(r.date)
    employee_summary = sorted([
        ReportV2EmployeeRow(
            employee_id=eid,
            employee_name=v["name"],
            official_hours=round(v["off"] / 60, 2),
            pending_hours=round(v["pend"] / 60, 2),
            target_hours=resolved_month_target_hours(emp_map[eid]) if eid in emp_map else 160,
            diff_hours=round(
                v["off"] / 60 - (resolved_month_target_hours(emp_map[eid]) if eid in emp_map else 160), 2
            ),
            shift_count=v["shifts"],
            work_days=len(v["dates"]),
        ) for eid, v in emp_agg.items()
    ], key=lambda x: x.employee_name)

    total_target = sum(
        resolved_month_target_hours(emp_map[eid]) for eid in target_ids if eid in emp_map
    )
    period_summary = ReportV2PeriodSummary(
        total_hours=round(tot_min / 60, 2),
        official_hours=round(off_min / 60, 2),
        pending_hours=round(pend_min / 60, 2),
        target_hours=total_target,
        diff_hours=round(off_min / 60 - total_target, 2),
        shift_count=len(session_rows),
        work_days=len(date_set),
    )

    return (
        ReportV2Response(
            kpis=kpis,
            sessions=session_rows,
            location_summary=location_summary,
            period_summary=period_summary,
            trend_data=trend_data,
            employee_summary=employee_summary,
        ),
        emp_email_map,
    )


@router.get("/v2/summary", response_model=ReportV2Response)
def reports_v2_summary(
    employee_ids: list[int] = Query(default=[]),
    location_ids: list[int] = Query(default=[]),
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date:   str = Query(..., description="YYYY-MM-DD"),
    grouping:  str = Query(default="daily"),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Professioneller V2-Arbeitszeitbericht: Multi-Filter, Trend, Standort- und Mitarbeiterauswertung."""
    data, _ = _build_v2_data(db, employee_ids, location_ids, from_date, to_date, grouping)
    return data


@router.get("/v2/excel")
def reports_v2_excel(
    employee_ids: list[int] = Query(default=[]),
    location_ids: list[int] = Query(default=[]),
    from_date: str = Query(..., description="YYYY-MM-DD"),
    to_date:   str = Query(..., description="YYYY-MM-DD"),
    grouping:  str = Query(default="daily"),
    db: Session = Depends(get_db),
    _: Employee = Depends(require_admin),
):
    """Excel-Export V2: 4 professionelle Sheets."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError as exc:
        logger.error("openpyxl not available: %s", exc)
        raise HTTPException(status_code=500, detail="openpyxl nicht installiert.")

    try:
        report, emp_email_map = _build_v2_data(
            db, employee_ids, location_ids, from_date, to_date, grouping
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("_build_v2_data failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Datenabruf fehlgeschlagen: {exc}")

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _to_berlin(dt: datetime | None) -> datetime | None:
        """Konvertiert eine datetime (naive oder aware) nach Europe/Berlin."""
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(_BERLIN)

    def _fmt_dur(minutes: float | int | None) -> str:
        """Formatiert Minuten als H:MM (auch negativ)."""
        if minutes is None:
            return "—"
        minutes = int(round(minutes))
        sign = "-" if minutes < 0 else ""
        h, m = divmod(abs(minutes), 60)
        return f"{sign}{h}:{m:02d}"

    def _hdr(ws_sheet, cols: list[str], hdr_fill, hdr_font) -> None:
        for ci, c in enumerate(cols, 1):
            cell = ws_sheet.cell(row=1, column=ci, value=c)
            cell.font      = hdr_font
            cell.fill      = hdr_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")

    def _autofit(ws_sheet) -> None:
        try:
            for col in ws_sheet.columns:
                if not col:
                    continue
                w = max((len(str(cell.value or "")) for cell in col), default=0)
                ws_sheet.column_dimensions[
                    get_column_letter(col[0].column)
                ].width = min(w + 4, 50)
        except Exception:
            pass  # Autofit ist optional – nie daran scheitern

    try:
        # ── Styles ───────────────────────────────────────────────────────────
        HDR_FILL    = PatternFill("solid", fgColor="FF1E3A5F")
        HDR_FONT    = Font(bold=True, color="FFFFFFFF", size=10)
        GREEN_FILL  = PatternFill("solid", fgColor="FFD1FAE5")
        RED_FILL    = PatternFill("solid", fgColor="FFFEE2E2")
        ORANGE_FILL = PatternFill("solid", fgColor="FFFEF3C7")
        BLUE_FILL   = PatternFill("solid", fgColor="FFDBEAFE")
        GRAY_FILL   = PatternFill("solid", fgColor="FFF8FAFC")
        BOLD        = Font(bold=True)

        STATUS_FILL = {
            "approved":  GREEN_FILL,
            "corrected": BLUE_FILL,
            "rejected":  RED_FILL,
            "pending":   ORANGE_FILL,
        }
        STATUS_DE = {
            "approved":  "Genehmigt",
            "corrected": "Korrigiert",
            "rejected":  "Abgelehnt",
            "pending":   "Ausstehend",
        }

        ps          = report.period_summary
        k           = report.kpis
        multi_emp   = len(report.employee_summary) > 1
        wb          = Workbook()

        # ── Sheet 1: Zusammenfassung ──────────────────────────────────────────
        ws1        = wb.active
        ws1.title  = "Zusammenfassung"
        emp_label  = str(len(report.employee_summary)) if report.employee_summary else "Alle"
        rows1 = [
            ("Zeitraum",                f"{from_date} – {to_date}"),
            ("Mitarbeiter",             emp_label),
            ("", ""),
            ("KPI",                     "Wert"),
            ("Gesamtstunden (h)",       _fmt_dur(k.total_hours * 60)),
            ("Offizielle Stunden (h)",  _fmt_dur(ps.official_hours * 60)),
            ("Ausstehende Stunden (h)", _fmt_dur(ps.pending_hours * 60)),
            ("Soll-Stunden (h)",        str(ps.target_hours)),
            ("Differenz (h)",           _fmt_dur(ps.diff_hours * 60)),
            ("Schichten gesamt",        str(k.total_shifts)),
            ("Arbeitstage",             str(k.work_days)),
            ("Standorte",               str(k.location_count)),
        ]
        for r in rows1:
            ws1.append(list(r))
        ws1["A4"].font = BOLD
        ws1["B4"].font = BOLD
        ws1.freeze_panes = "A2"
        _autofit(ws1)

        # ── Sheet 2: Arbeitszeiten ────────────────────────────────────────────
        ws2        = wb.create_sheet("Arbeitszeiten")
        cols2      = (["Mitarbeiter", "E-Mail"] if multi_emp else []) + [
            "Datum", "Wochentag", "Standort", "Check-In", "Check-Out",
            "Pause", "Arbeitszeit", "Status",
        ]
        _hdr(ws2, cols2, HDR_FILL, HDR_FONT)
        ws2.freeze_panes = "A2"
        ws2.auto_filter.ref = f"A1:{get_column_letter(len(cols2))}1"

        for row in report.sessions:
            ci_b = _to_berlin(row.checkin_time)
            co_b = _to_berlin(row.checkout_time)
            if ci_b is None:
                continue  # degenerate session – skip
            vals = (
                ([row.employee_name, emp_email_map.get(row.employee_id, "")] if multi_emp else [])
                + [
                    ci_b.strftime("%d.%m.%Y"),
                    row.weekday,
                    row.location_name,
                    ci_b.strftime("%H:%M"),
                    co_b.strftime("%H:%M") if co_b else "—",
                    "—",
                    _fmt_dur(row.work_minutes),
                    STATUS_DE.get(row.status, row.status),
                ]
            )
            ri = ws2.max_row + 1
            ws2.append(vals)
            fill = STATUS_FILL.get(row.status, GRAY_FILL)
            for ci in range(1, len(cols2) + 1):
                ws2.cell(row=ri, column=ci).fill = fill
        _autofit(ws2)

        # ── Sheet 3: Standortauswertung ───────────────────────────────────────
        ws3   = wb.create_sheet("Standortauswertung")
        cols3 = ["Standort", "Anzahl Schichten", "Stunden"]
        _hdr(ws3, cols3, HDR_FILL, HDR_FONT)
        ws3.freeze_panes = "A2"
        ws3.auto_filter.ref = f"A1:{get_column_letter(len(cols3))}1"

        for loc in report.location_summary:
            ws3.append([
                loc.location_name,
                loc.shift_count,
                _fmt_dur(loc.total_hours * 60),
            ])
        sum_row3 = ws3.max_row + 1
        total_shifts3 = sum(l.shift_count for l in report.location_summary)
        ws3.append(["GESAMT", total_shifts3, _fmt_dur(k.total_hours * 60)])
        for ci in range(1, 4):
            ws3.cell(row=sum_row3, column=ci).font = BOLD
        _autofit(ws3)

        # ── Sheet 4: Mitarbeiteruebersicht ────────────────────────────────────
        ws4   = wb.create_sheet("Mitarbeiteruebersicht")
        cols4 = [
            "Mitarbeiter", "E-Mail", "Offizielle Stunden", "Ausstehend",
            "Schichten", "Arbeitstage", "Soll (h)", "Differenz (h)",
        ]
        _hdr(ws4, cols4, HDR_FILL, HDR_FONT)
        ws4.freeze_panes = "A2"
        ws4.auto_filter.ref = f"A1:{get_column_letter(len(cols4))}1"

        for emp_row in report.employee_summary:
            diff = emp_row.diff_hours or 0.0
            ri   = ws4.max_row + 1
            ws4.append([
                emp_row.employee_name,
                emp_email_map.get(emp_row.employee_id, ""),
                _fmt_dur(emp_row.official_hours * 60),
                _fmt_dur(emp_row.pending_hours * 60),
                emp_row.shift_count,
                emp_row.work_days,
                str(emp_row.target_hours),
                _fmt_dur(diff * 60),
            ])
            fill = GREEN_FILL if diff >= 0 else RED_FILL
            for ci in [3, 8]:
                ws4.cell(row=ri, column=ci).fill = fill
        _autofit(ws4)

        # ── Streamen ──────────────────────────────────────────────────────────
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        data = buf.read()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Excel-Export V2 fehlgeschlagen (from=%s to=%s emps=%s locs=%s):\n%s",
            from_date, to_date, employee_ids, location_ids,
            traceback.format_exc(),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Excel-Export fehlgeschlagen: {type(exc).__name__}: {exc}",
        )

    # Dateiname
    emp_ids_set = {e.employee_id for e in report.employee_summary}
    if len(employee_ids) == 1 and employee_ids[0] in emp_ids_set:
        raw   = next(
            (e.employee_name for e in report.employee_summary if e.employee_id == employee_ids[0]),
            "Mitarbeiter",
        )
        safe  = "".join(c if c.isalnum() else "_" for c in raw)
        fname = f"Arbeitszeitbericht_{safe}_{from_date}_{to_date}.xlsx"
    else:
        label = "Alle_Mitarbeiter" if not employee_ids else "Mehrere_Mitarbeiter"
        fname = f"Arbeitszeitbericht_{label}_{from_date}_{to_date}.xlsx"

    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
